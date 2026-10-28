import * as THREE from 'three';
import { Zombie } from './zombie.js';
import { TYPES } from './types.js';
import { sfx } from '../audio.js';

// 追逐戰:殺不死的「追獵者」從玩家背後的黑暗裡現身,玩家必須逃到安全點(閃著綠色緊急燈的補給點/商店)、
// 甩開他躲 7 秒,或撐過 50 秒。被抓到 = 重傷 + 擊倒(不會直接死),追獵者隨即退回黑暗。之後有一段喘息。
//
// 觸發:
//  - 靈異導演(src/horror/director.js 的 'chase' 種類;有冷卻、要夠安靜才給):大約每一幕一次,只在回合進行中(不在商店/休息)
//  - 劇情:打開上鎖的門(interact 'unlock'):追獵者從門後的房間衝出來;接起電話後(horror 'phone:answer')電話那頭說「快跑」
//  - 測試/劇情 API:game.chase.start({ target, from, safe, reason, force })
// 多人:房主決定與結算(追獵者是一般的同步殭屍,類型 'pursuer');'zch' 訊息告訴其他人追逐開始/結束、被追的是誰、安全點在哪,
//      各端自己做畫面與聲音(心跳、暗角、視角、配樂、指引燈)。對戰模式停用。
// 介面:game.chase.active / .stats() / .start(o) / .stop(reason) / .reset()

const SAFE_R = 2.4, LOST_T = 7, MAX_T = 50, CALM = 10, CHECK = 2, FADE_T = 3;
const REASON = ['safe', 'hid', 'timer', 'caught', 'target', 'gone', 'reset'];
const _snap = { x: 0, y: 0, z: 0 };
const alive = (p) => p && p.alive !== false && !p.downed && (p.hp == null || p.hp > 0);

function glowTex() {
  const c = document.createElement('canvas');
  c.width = 64; c.height = 128;
  const x = c.getContext('2d'), g = x.createRadialGradient(32, 64, 2, 32, 64, 60);
  g.addColorStop(0, 'rgba(210,255,215,1)'); g.addColorStop(0.18, 'rgba(70,255,120,0.75)'); g.addColorStop(0.55, 'rgba(20,200,70,0.18)'); g.addColorStop(1, 'rgba(0,120,40,0)');
  x.fillStyle = g; x.fillRect(0, 0, 64, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function createChase(game) { return new Chase(game); }

class Chase {
  constructor(g) {
    this.g = g;
    this.active = false; // 房主:追逐進行中(收尾淡出期間為 false)
    this.z = null; this.tgt = null; this.safe = null; this.t = 0; this.lost = 0; this.fade = 0; this.reason = '';
    this.acts = new Set(); this.checkT = 6; this.pending = null; this.count = 0; this.log = [];
    // 畫面/聲音(每一端自己做)
    this.P = { on: false, me: false, safe: null, k: 0, heartT: 0, beaconT: 0, fov0: null, nearT: 0, grabSeen: false };
    this.netBound = null; this.ixBound = null; this.hBound = null;
    this.beacon = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex(), color: 0x7dffa0, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.beacon.scale.set(1.3, 2.6, 1);
    this.beacon.visible = false;
    this.beacon.renderOrder = 4;
    g.scene.add(this.beacon);
    this.vig = null;
    // 追逐中把戰鬥配樂換成最緊張的那一套(game.update 每幀依巨屍在不在場設定 'fight'/'boss')
    const setMood = g.setMood;
    g.setMood = (m) => setMood.call(g, this.P.on && m === 'fight' ? 'boss' : m);
  }
  get host() { const n = this.g.net; return !n || n.isHost; }

  // ======================= 每幀 =======================
  update(dt) {
    this._bind();
    if (this.host) this._host(dt);
    this._present(dt);
  }

  // 事件來源(門、電話)與連線訊息:第一次可用時綁定
  _bind() {
    const g = this.g, s = g.net, ix = g.interact, H = g.horror;
    if (s && s !== this.netBound && s.on) {
      this.netBound = s;
      s.on('zch', (d, f) => {
        if (s.isHost || f !== s.hostSlot || !Array.isArray(d)) return;
        if (d[0] === 1) this._presStart(d[1] === s.me, { x: +d[2], y: +d[3], z: +d[4] });
        else this._presStop(REASON[d[1]] || 'gone', d[2] === s.me);
      });
    }
    if (ix && ix !== this.ixBound && ix.on) {
      this.ixBound = ix;
      ix.on('door', (w, st) => { // 門在追獵者面前被甩上:撞個正著,暈一下(之後照樣把門推開)
        const z = this.z;
        if (st !== 'closed' || !z || !this.active || !this.host || z.state === 'stun') return;
        if (Math.hypot(z.pos.x - w.cx, z.pos.z - w.cz) < 2.6 && Math.abs(z.pos.y - w.y) < 1.6) { z.go('stun'); this.slams = (this.slams || 0) + 1; }
      });
      ix.on('unlock', (w) => { // 打開上鎖的門:追獵者從門後衝出來
        if (!this.host || this.active || this.pending || !this._can(true)) return;
        const p = g.player, dx = w.cx - p.pos.x, dz = w.cz - p.pos.z, d = Math.hypot(dx, dz) || 1;
        const y = g.world.layout.levels[w.li]?.y ?? p.pos.y;
        if (g.world.navSnap && g.world.navSnap(w.cx + (dx / d) * 3.5, y, w.cz + (dz / d) * 3.5, _snap)) this.pending = { t: 1.2, reason: 'door', from: { x: _snap.x, y: _snap.y, z: _snap.z } };
      });
    }
    if (H && H !== this.hBound && H.on) {
      this.hBound = H;
      H.on('phone:answer', () => { // 接起電話:第二幕起,電話那頭的人叫你快跑
        const d = H.director;
        if (!this.host || this.active || this.pending || !this._can(true) || (d && d.act < 2) || this.acts.has('phone')) return;
        this.acts.add('phone');
        this.pending = { t: 7, reason: 'phone', line: '……快跑。他在你後面。' };
      });
    }
  }

  _can(story = false) {
    const g = this.g;
    if (g.state !== 'playing' || g.phase !== 'fighting' || g.net?.pvp || g.spawnHeld || !alive(g.player)) return false;
    const d = g.horror?.director;
    if (!story && d && d.roundT < 20) return false; // 回合開始 20 秒內不追
    if (g.player.hp < g.player.maxHp * 0.35) return false; // 快死了不追(那是殺人,不是嚇人)
    return true;
  }

  _host(dt) {
    const g = this.g;
    if (this.z) { this._run(dt); return; }
    if (this.pending) {
      this.pending.t -= dt;
      if (this.pending.t <= 0) { const o = this.pending; this.pending = null; if (this._can(true)) this.start({ ...o, force: true }); }
      return;
    }
    if ((this.checkT -= dt) > 0) return;
    this.checkT = CHECK;
    if (!this._can()) return;
    const d = g.horror?.director, act = d ? d.act : 1;
    if (this.acts.has(act)) return; // 大約每一幕一次
    if (d ? !d.request('chase') : g.time < 120) return;
    if (this.start({ reason: 'director' })) this.acts.add(act);
  }

  // ======================= 開始 =======================
  start(o = {}) {
    const g = this.g;
    if (this.z || !this.host || g.net?.pvp) return false;
    const tgt = o.target || this._pickTarget();
    if (!alive(tgt)) return false;
    const from = o.from || this._spawnSpot(tgt);
    if (!from) return false;
    const safe = o.safe || this._safeSpot(tgt, from);
    if (!safe) return false;
    const z = new Zombie(g.scene, from, g.round || 1, 'pursuer');
    z._chase = true;
    z.speed = TYPES.pursuer.speed[0]; // 不隨回合加速(比衝刺慢是對策的一部分)
    z.heading = Math.atan2(tgt.pos.x - from.x, tgt.pos.z - from.z);
    z.pickTarget = (ctx) => (alive(tgt) ? tgt : Zombie.prototype.pickTarget.call(z, ctx)); // 一次只追一個人
    z._warp = () => false; // 不會被「卡住瞬移」搬走
    z.go('roar');
    z._born = g.time;
    g.zombies.push(z);
    Object.assign(this, { z, tgt, safe, active: true, t: 0, lost: 0, fade: 0, reason: o.reason || 'api' });
    this.count++;
    this.log.push(`${(g.time || 0).toFixed(1)}:start:${this.reason}`);
    g.horror?.director?.notify?.('chase', { pos: z.pos, dur: MAX_T + 5 }); // 整段追逐都鎖住其他驚嚇(結束時 chaseEnd 解鎖)
    const s = g.net;
    if (s && s.isHost && s.send) try { s.send('zch', [1, tgt === g.player ? s.me : tgt.id, +safe.x.toFixed(2), +safe.y.toFixed(2), +safe.z.toFixed(2)]); } catch { /* 連線中斷 */ }
    this._presStart(tgt === g.player, safe, o.line);
    return true;
  }
  _pickTarget() {
    const g = this.g, list = (g.players || [g.player]).filter(alive);
    return list.length ? list[(Math.random() * list.length) | 0] : null;
  }
  // 現身地點:玩家背後 9~24m(沿導航路徑)、所有人都看不到、同一層;優先暗處。先在背後撒點,再退回地圖的出生點
  _spawnSpot(tgt) {
    const g = this.g, w = g.world, p = tgt.pos;
    const fx = -Math.sin(tgt.yaw || 0), fz = -Math.cos(tgt.yaw || 0);
    const seen = (x, y, z) => { for (const q of g.players || [g.player]) { if (!alive(q)) continue; const e = q.pos.y + (q.eyeH || 1.6); if (Math.hypot(q.pos.x - x, q.pos.z - z) < 40 && w.hasLineOfSight(q.pos.x, e, q.pos.z, x, y + 1.6, z)) return true; } return false; };
    let best = null, bs = -Infinity;
    const consider = (x, y, z, bonus) => {
      if (Math.abs(y - p.y) > 1.5) return;
      const fd = w.flowDistance ? w.flowDistance(x, y, z) : Math.hypot(x - p.x, z - p.z);
      if (!(fd >= 9 && fd <= 24)) return;
      const dx = x - p.x, dz = z - p.z, d = Math.hypot(dx, dz) || 1, behind = -(dx * fx + dz * fz) / d;
      if (behind < 0.15 || seen(x, y, z)) return;
      const sc = behind * 2 + bonus - Math.abs(fd - 14) / 14 + Math.random() * 0.3;
      if (sc > bs) { bs = sc; best = { x, y, z }; }
    };
    for (let i = 0; i < 28; i++) {
      const a = (Math.random() - 0.5) * 1.8, r = 9 + Math.random() * 12;
      const dx = -(fx * Math.cos(a) - fz * Math.sin(a)), dz = -(fz * Math.cos(a) + fx * Math.sin(a));
      if (w.navSnap && w.navSnap(p.x + dx * r, p.y, p.z + dz * r, _snap)) consider(_snap.x, _snap.y, _snap.z, 0);
    }
    for (const s of w.spawns || []) if (!s.vent && !s.bad) consider(s.x, s.y || 0, s.z, s.dark ? 0.8 : 0.3);
    return best;
  }
  // 安全點:補給點/商店櫃台,沿路徑 14~70m,優先「遠離追獵者那一邊」
  _safeSpot(tgt, from) {
    const g = this.g, w = g.world, p = tgt.pos;
    const cands = [...(w.supplies || [])];
    if (w.shop) cands.push({ x: w.shop.stand?.x ?? w.shop.x, y: w.shop.y, z: w.shop.stand?.z ?? w.shop.z });
    const ax = p.x - from.x, az = p.z - from.z, al = Math.hypot(ax, az) || 1;
    let best = null, bs = -Infinity, near = null, nd = Infinity;
    for (const c of cands) {
      const y = c.y || 0;
      if (!w.navSnap || !w.navSnap(c.x, y, c.z, _snap)) continue;
      const fd = w.flowDistance ? w.flowDistance(_snap.x, _snap.y, _snap.z) : Math.hypot(c.x - p.x, c.z - p.z);
      if (!Number.isFinite(fd)) continue;
      const pt = { x: _snap.x, y: _snap.y, z: _snap.z };
      if (fd >= 10 && fd < nd) { nd = fd; near = pt; }
      if (fd < 14 || fd > 70) continue;
      const dx = c.x - p.x, dz = c.z - p.z, d = Math.hypot(dx, dz) || 1, away = (dx * ax + dz * az) / (d * al);
      const sc = away * 2 - Math.abs(fd - 32) / 30;
      if (sc > bs) { bs = sc; best = pt; }
    }
    return best || near;
  }

  // ======================= 進行中(房主) =======================
  _run(dt) {
    const g = this.g, z = this.z;
    this.t += dt;
    if (!this.active) { // 收尾:追獵者退開,沒人看著(或 3 秒後)就消失
      this.fade -= dt;
      if (z.state !== 'spawn' && (this.fade <= 0 || !z.los || z.dist > 14)) z.go('spawn');
      else if (z.state === 'spawn' && z.st > 0.4) this._remove();
      return;
    }
    if (!z.alive) { this.stop('gone'); return; }
    if (this.caughtT > 0) { if ((this.caughtT -= dt) <= 0) this.stop('caught'); return; }
    const tgt = this.tgt;
    if (!alive(tgt)) { this.stop('target'); return; }
    const p = tgt.pos, S = this.safe;
    if (Math.hypot(p.x - S.x, p.z - S.z) < SAFE_R && Math.abs(p.y - S.y) < 1.6) { this.stop('safe'); return; }
    if (z.state === 'chase' && !z.los && z.dist > 9) this.lost += dt; else this.lost = Math.max(0, this.lost - dt * 2);
    if (this.lost > LOST_T) { this.stop('hid'); return; }
    if (this.t > MAX_T) this.stop('timer');
  }
  // 被抓到(追獵者的 think 呼叫):重傷 + 擊倒,不會直接打死;回傳要扣的血
  caught(z, p) {
    const g = this.g;
    if (!this.active || this.caughtT > 0) return 0;
    p = p || this.tgt;
    this.caughtT = 1.2;
    const dmg = Math.max(0, Math.min(TYPES.pursuer.catchDmg, (p.hp ?? 100) - 8));
    const dx = p.pos.x - z.pos.x, dz = p.pos.z - z.pos.z, d = Math.hypot(dx, dz) || 1;
    p.knock?.((dx / d) * 9, (dz / d) * 9);
    if (p === g.player) { p.addShake?.(1.1); sfx.zGrab?.(p.pos); }
    this.log.push(`${(g.time || 0).toFixed(1)}:caught:${dmg}`);
    return dmg;
  }
  stop(reason = 'gone') {
    const g = this.g, z = this.z;
    if (!z || !this.active) return;
    this.active = false;
    this.reason = reason;
    this.caughtT = 0;
    this.fade = reason === 'safe' || reason === 'caught' ? 1.4 : FADE_T;
    this.log.push(`${(g.time || 0).toFixed(1)}:end:${reason}`);
    if (z.alive) { z._retreat = true; z.go('recover'); }
    // 喘息:暫緩出怪與其他驚嚇
    g.spawnTimer = Math.max(g.spawnTimer || 0, CALM);
    const dr = g.horror?.director;
    if (dr?.chaseEnd) dr.chaseEnd({ calm: CALM }); else dr?.hold?.(CALM);
    const s = g.net;
    if (s && s.isHost && s.send) try { s.send('zch', [0, REASON.indexOf(reason), this.tgt === g.player ? s.me : this.tgt?.id ?? 255]); } catch { /* 連線中斷 */ }
    this._presStop(reason, this.tgt === g.player);
    if (reason === 'reset' || !z.alive) this._remove();
  }
  _remove() {
    const z = this.z;
    if (z) { z._dsent = true; z.alive = false; z.corpse = 0.01; z.root.visible = false; } // 不送死亡訊息、不留屍體;代理端停止收到快照後自行移除
    this.z = null; this.tgt = null; this.safe = null;
  }
  reset() {
    if (this.z) this.stop('reset');
    this._remove();
    this.pending = null; this.acts.clear(); this.checkT = 6;
    this._presStop('reset', false);
  }
  stats() { return { active: this.active, count: this.count, slams: this.slams || 0, reason: this.reason, t: +this.t.toFixed(1), lost: +this.lost.toFixed(1), pursuer: this.z ? this.z.state : null, safe: this.safe, log: this.log.slice(-8) }; }

  // ======================= 畫面與聲音(每一端) =======================
  _presStart(me, safe, line) {
    const g = this.g, P = this.P;
    P.on = true; P.me = me; P.safe = safe; P.heartT = 0.6; P.beaconT = 0.8; P.grabSeen = false;
    if (P.fov0 == null && g.baseFov) P.fov0 = g.baseFov;
    sfx.zChase?.(true);
    if (safe) { this.beacon.position.set(safe.x, safe.y + 1.5, safe.z); this.beacon.visible = true; }
    if (me) {
      g.motion?.beat('chase'); // [motion] 邊緣一口紅 + 暗角收緊(追逐結束時放開)
      g.ui?.banner?.('快逃！', '他殺不死 · 跑向閃著綠光的金水商行，或甩掉他躲起來', 3200, 'red');
      const H = g.horror;
      H?.subs?.show?.({ text: line || '快跑！往綠燈那邊——金水伯的店！', tag: line ? '電話' : 'AM 1207 · 小鈴', cap: true, hold: 2.4 });
      sfx.radio?.(true);
      setTimeout(() => sfx.radio?.(false), 2800);
    } else g.ui?.feed?.('追獵者出現了 · 他在追你的隊友', { icon: 'skull', color: '#ff6a5a', ms: 3500 });
  }
  _presStop(reason, me) {
    const g = this.g, P = this.P;
    if (!P.on) return;
    P.on = false; P.safe = null;
    this.beacon.visible = false;
    if (reason !== 'reset') sfx.zChase?.(false);
    g.motion?.beat('chase-end');
    if (me && reason !== 'reset') {
      const msg = { safe: ['安全了……暫時', '#7dffa0'], hid: ['他跟丟你了', '#9ad0ff'], timer: ['他退回黑暗裡了', '#d0d0c0'], caught: ['你被抓住了', '#ff5a4a'] }[reason];
      if (msg) g.ui?.feed?.(msg[0], { icon: reason === 'caught' ? 'skull' : 'heal', color: msg[1], ms: 3200 });
    }
  }
  _present(dt) {
    const g = this.g, P = this.P, me = g.player;
    let z = null;
    if (P.on) for (const q of g.zombies) if (q.alive && q.type === 'pursuer' && q.state !== 'spawn') { z = q; break; }
    let want = 0, d = 99;
    if (P.on && g.state === 'playing' && me) {
      if (z) d = Math.hypot(z.pos.x - me.pos.x, z.pos.z - me.pos.z) + Math.abs(z.pos.y - me.pos.y) * 2;
      want = Math.max(0.25, Math.min(1, 1 - (d - 3) / 22)) * (P.me ? 1 : 0.5);
    }
    P.k += (want - P.k) * Math.min(1, dt * (want > P.k ? 3 : 1.2));
    const k = P.k;
    // 暗角(DOM,便宜)、視角拉寬、心跳、近身鏡頭震動
    if (k > 0.01 || this.vig) {
      if (!this.vig) {
        const v = (this.vig = document.createElement('div'));
        v.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:5;opacity:0;background:radial-gradient(ellipse at center, rgba(0,0,0,0) 42%, rgba(30,0,0,0.55) 72%, rgba(10,0,0,0.92) 100%)';
        document.body.appendChild(v);
      }
      this.vig.style.opacity = (k * 0.8).toFixed(3);
    }
    if (P.fov0 != null && g.baseFov != null) {
      g.baseFov = P.fov0 + 6 * k;
      if (!P.on && k < 0.01) { g.baseFov = P.fov0; P.fov0 = null; }
    }
    if (k > 0.05 && (P.heartT -= dt) <= 0) { P.heartT = 1.0 - 0.55 * k; sfx.zHeart?.(k); }
    if (P.on && P.safe) {
      if ((P.beaconT -= dt) <= 0) { P.beaconT = 1.5; sfx.zBeacon?.(P.safe); }
      const s = 1 + 0.25 * Math.sin((g.time || 0) * 5.5);
      this.beacon.scale.set(1.3 * s, 2.6 * s, 1);
      this.beacon.material.opacity = 0.65 + 0.35 * Math.max(0, Math.sin((g.time || 0) * 7.3)); // 緊急燈的閃爍
    }
    if (z && me && d < 2.4 && (P.nearT -= dt) <= 0) { P.nearT = 0.35; me.addShake?.(0.18); }
    if (z && z.state === 'grab' && d < 2.2 && !P.grabSeen && !this.host) { P.grabSeen = true; me.addShake?.(1); sfx.zGrab?.(me.pos); } // 代理端:被抓的畫面回饋
    if (z && z.state !== 'grab') P.grabSeen = false;
  }
}
