import * as THREE from 'three';
import { sfx } from '../audio.js';
import { ambushSfx } from '../audio/ambush.js';
import { settings } from '../ui/settings.js';
import { Zombie } from './zombie.js';
import { forceVariant } from './model.js';
import { LURK, PERCH, BURST, DROP, POSE, isPerch, makeAmb } from './ambush.pose.js';
import { createAmbushProps } from './ambush.props.js';
import { precompile } from '../sys/warmup.js';

// 埋伏(殭屍躲在角落/門後/家具旁裝死,玩家經過時衝出來)與天花板掉落(趴在天花板夾層、通風格柵上方,玩家經過時破板掉下來)。
// game.ambush(flow.js 第一次 updateRound 時建立):
//  - 出怪時(flow.spawnZombie → onSpawn)把部分殭屍改放到埋伏點(仍算在回合數量裡);只有房主決定,連線時代理殭屍照狀態播放
//  - 埋伏點:導航圖驗證過、玩家「可能經過」(路徑距離 8~34m、前進方向加權、暗處加權)而且當下沒有任何玩家看得到
//  - 觸發(每 0.25 秒檢查一次:距離 + 一條視線):靠近 3~5m 且沒有正眼盯著(或轉身背對)、在附近開槍、被打到;天花板:從下方經過
//  - 節奏:有靈異導演(game.horror.director)就先 request 再放;沒有時自己的冷卻(約 40~60 秒一次、第一回合開場 45 秒內不放);
//    驚嚇強度(設定 scare:off/low/normal/high)調整數量與冷卻;不允許時維持裝死,玩家硬是貼上來才「安靜地」起身
//  - 回合不會卡住:場上只剩埋伏的殭屍時,2.5 秒後全部醒來找人(flow.updateRound 呼叫 hunt());埋伏太久也會自己醒
//  - 假屍體:每回合散布幾具真的不會動的屍體(同樣的模型與姿勢,可以被射中、只會抽搐),讓玩家不敢相信任何一具屍體
// 除錯:__game.ambush.stats、.debug()、.force('lurk'|'drop', dist)、.wakeAll()
const INT = { off: { n: 0, cd: 99 }, low: { n: 0.5, cd: 1.8 }, normal: { n: 1, cd: 1 }, high: { n: 1.5, cd: 0.65 } };
const NO_THEME = new Set(['shop', 'lobby', 'rooftop', 'fire_escape', 'courtyard', 'cemetery', 'plaza', 'parking', 'alley', 'yard', 'playground', 'ambulance_bay', 'ramp']);
const KIND_W = { corner: 1, door: 1.45, tall: 1.15, bed: 1.05, floor: 0.6 };
const CORNERS = [[-1, -1], [1, -1], [-1, 1], [1, 1]];
const POSE_H = { [POSE.slump]: 0.75, [POSE.lie]: 0.3, [POSE.supine]: 0.3, [POSE.crouch]: 0.9, [POSE.stand]: 1.5 };
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const rand = (a, b) => a + Math.random() * (b - a);
const _v = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0), _down = new THREE.Vector3(0, -1, 0), _o = new THREE.Vector3(), _d = new THREE.Vector3();
const _snap = { x: 0, y: 0, z: 0 };

function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// ======================================================================
// 埋伏點(建一次;只看格子、碰撞盒與導航圖,不打射線)
//  corner 房間/走廊的牆角、door 門洞旁的牆後、bed/tall 家具旁(矮的:病床/推床/桌子;高的:櫃子)、floor 房間地上
//  ceil:天花板破洞(K.ceilings 的 hole/sag)+ 散布的通風格柵(固定種子,各端位置一致)
// ======================================================================
function buildSpots(W, K, fixtures) {
  const L = W.layout, out = [], ceil = [], grilles = [];
  const ch = (li, c, r) => L.charAt(li, c, r);
  const solid = (li, c, r) => { const x = ch(li, c, r); return x === '#' || x === 'E'; };
  const plain = (li, c, r) => { const x = ch(li, c, r); return x === '.' || x === 'Z' || x === 'a' || x === 'h'; };
  const zoneOk = (li, c, r) => { const z = L.zoneAt(li, c, r); return z && !NO_THEME.has(z.theme) && !/outdoor/.test(z.mood) ? z : null; };
  const fixNear = (li, x, z, r) => { for (const f of fixtures) if (f.li === li && Math.abs(f.x - x) < r && Math.abs(f.z - z) < r) return true; return false; };
  const lit = (li, x, z) => { let s = 0; for (const f of fixtures) { if (f.li !== li || f.state === 2) continue; const d = Math.hypot(f.x - x, f.z - z); if (d < 4.5) s += (1 - d / 4.5) * (f.state === 1 ? 0.5 : 1); } return s; };
  const nodeOk = (li, x, z) => {
    const y = L.levels[li].y;
    if (W.isNode(x, y, z)) return true;
    return !!W.navSnap(x, y, z, _snap) && Math.hypot(_snap.x - x, _snap.z - z) < 0.65 && Math.abs(_snap.y - y) < 0.3;
  };
  const add = (li, x, z, yaw, kind, zn) => {
    if (!nodeOk(li, x, z)) return;
    out.push({ li, x, y: L.levels[li].y, z, yaw, kind, zone: zn.id, dark: lit(li, x, z) < 0.55, busy: null, usedT: -1e9, decoy: null });
  };
  const R = rng(4417);
  for (let li = 0; li < L.levels.length; li++) {
    for (let r = 0; r < L.H; r++) for (let c = 0; c < L.W; c++) {
      const x = ch(li, c, r);
      if (x === '+') { // 門洞兩側、牆後的位置(進門的人背後/身旁)
        const hz = solid(li, c - 1, r) && solid(li, c + 1, r), vt = solid(li, c, r - 1) && solid(li, c, r + 1);
        for (const s of [-1, 1]) for (const l of [-1, 1]) {
          if (hz) {
            const cc = c + l, rr = r + s, zn = plain(li, cc, rr) && solid(li, cc, r) ? zoneOk(li, cc, rr) : null;
            if (zn) add(li, l > 0 ? (c + 1) * 2 + 0.55 : c * 2 - 0.55, s > 0 ? (r + 1) * 2 + 0.55 : r * 2 - 0.55, Math.atan2(-l, s * 0.35), 'door', zn);
          } else if (vt) {
            const cc = c + s, rr = r + l, zn = plain(li, cc, rr) && solid(li, c, rr) ? zoneOk(li, cc, rr) : null;
            if (zn) add(li, s > 0 ? (c + 1) * 2 + 0.55 : c * 2 - 0.55, l > 0 ? (r + 1) * 2 + 0.55 : r * 2 - 0.55, Math.atan2(s * 0.35, -l), 'door', zn);
          }
        }
        continue;
      }
      if (!plain(li, c, r)) continue;
      const zn = zoneOk(li, c, r);
      if (!zn) continue;
      const cx = (c + 0.5) * 2, cz = (r + 0.5) * 2;
      for (const [dc, dr] of CORNERS) if (solid(li, c + dc, r) && solid(li, c, r + dr)) add(li, cx + dc * 0.5, cz + dr * 0.5, Math.atan2(-dc, -dr), 'corner', zn);
      if (zn.theme !== 'corridor' && R() < 0.12) add(li, cx + (R() - 0.5) * 0.8, cz + (R() - 0.5) * 0.8, R() * Math.PI * 2, 'floor', zn);
    }
  }
  // 家具旁:每個碰撞盒挑一面(盒子在地上、0.4~2.4m 高、不是超大件)
  for (const b of W.boxes) {
    const h = b.maxY - b.minY, sx = b.maxX - b.minX, sz = b.maxZ - b.minZ;
    if (h < 0.4 || h > 2.4 || sx * sz < 0.25 || sx > 3.2 || sz > 3.2) continue;
    const li = L.levelOfY(b.minY + 0.2), fy = L.levels[li].y;
    if (b.minY - fy > 0.35 || b.minY < fy - 0.2) continue;
    const side = (R() * 4) | 0, nx = side === 0 ? 1 : side === 1 ? -1 : 0, nz = side === 2 ? 1 : side === 3 ? -1 : 0;
    const x = nx ? (nx > 0 ? b.maxX + 0.5 : b.minX - 0.5) : (b.minX + b.maxX) / 2, z = nz ? (nz > 0 ? b.maxZ + 0.5 : b.minZ - 0.5) : (b.minZ + b.maxZ) / 2;
    const c = Math.floor(x / 2), r = Math.floor(z / 2);
    if (!plain(li, c, r)) continue;
    const zn = zoneOk(li, c, r);
    if (!zn || zn.theme === 'corridor') continue;
    const low = h < 1.15;
    add(li, x, z, low ? Math.atan2(-nz, nx) + (R() < 0.5 ? Math.PI : 0) : Math.atan2(nx, nz), low ? 'bed' : 'tall', zn);
  }
  // 天花板:破洞 / 下垂的板(夾層是黑的,看得到垂下來的手)
  const ceilOk = (li, x, z) => {
    const c = Math.floor(x / 2), r = Math.floor(z / 2);
    if (!plain(li, c, r)) return null;
    const zn = zoneOk(li, c, r);
    if (!zn || zn.ceil === 'vault' || zn.theme === 'stairwell') return null;
    const fy = L.levels[li].y, h = W.ceilAt(x, z, fy) - fy;
    if (!(h > 3.0 && h < 3.65) || !nodeOk(li, x, z)) return null;
    return { zn, h };
  };
  for (const k of (K && K.ceilings) || []) {
    if (k.kind !== 'hole' && k.kind !== 'sag') continue;
    const q = ceilOk(k.li, k.x, k.z);
    if (!q || Math.abs(k.y - L.levels[k.li].y - q.h) > 0.1) continue;
    ceil.push({ li: k.li, x: k.x, y: L.levels[k.li].y, z: k.z, ceilH: q.h, kind: k.kind, code: k.kind === 'hole' ? POSE.prone : POSE.hidden, gi: -1, busy: null, usedT: -1e9, dark: lit(k.li, k.x, k.z) < 0.55, yaw: R() * Math.PI * 2 });
  }
  // 通風格柵:走廊每段、房間偶爾一個;對齊天花板分格中心,避開燈具、破洞
  const T3 = 2 / 3;
  for (let li = 0; li < L.levels.length; li++) for (let r = 0; r < L.H; r++) for (let c = 0; c < L.W; c++) {
    if (!plain(li, c, r)) continue;
    const zn = zoneOk(li, c, r);
    if (!zn || R() > (zn.theme === 'corridor' ? 0.075 : 0.1)) continue;
    const o = [[1, 1], [0, 1], [2, 1], [1, 0], [1, 2]][(R() * 5) | 0];
    const x = c * 2 + (o[0] + 0.5) * T3, z = r * 2 + (o[1] + 0.5) * T3;
    if (fixNear(li, x, z, 0.95)) continue;
    let far = true;
    for (const g of grilles) if (g.li === li && Math.abs(g.x - x) + Math.abs(g.z - z) < 6) { far = false; break; }
    if (far) for (const k of ceil) if (k.li === li && Math.abs(k.x - x) + Math.abs(k.z - z) < 1.4) { far = false; break; }
    if (!far) continue;
    const q = ceilOk(li, x, z);
    if (!q) continue;
    const gi = grilles.length;
    grilles.push({ li, x, y: L.levels[li].y + q.h, z, rot: ((R() * 2) | 0) * (Math.PI / 2) });
    ceil.push({ li, x, y: L.levels[li].y, z, ceilH: q.h, kind: 'grille', code: POSE.hidden, gi, busy: null, usedT: -1e9, dark: lit(li, x, z) < 0.55, yaw: R() * Math.PI * 2 });
  }
  return { spots: out, ceil, grilles };
}

// 姿勢:依位置種類與殭屍種類
function poseFor(kind, type) {
  if (type === 'crawler') return POSE.lie;
  const r = Math.random();
  switch (kind) {
    case 'corner': return r < 0.55 ? POSE.slump : r < 0.8 ? POSE.stand : POSE.crouch;
    case 'door': return r < 0.5 ? POSE.stand : POSE.crouch;
    case 'tall': return r < 0.7 ? POSE.crouch : POSE.stand;
    default: return r < 0.55 ? POSE.lie : POSE.supine;
  }
}

class Ambush {
  constructor(g) {
    this.g = g;
    this.world = null;
    this.ready = false;
    this.stats = { lurk: 0, drop: 0, scares: 0, quiet: 0, hunts: 0, denied: 0, timeouts: 0, relocated: 0, decoys: 0, spots: 0, ceil: 0, grilles: 0 };
    this.lastTrig = -1e9; this.blockT = -1e9; this.round = -1; this.roundT0 = 0; this.per = { lurk: 0, drop: 0 };
    this.acc = 0; this.hintAcc = 0; this.relT = 0; this._huntAt = 0; this._huntReq = -9;
    this.shot = { t: -9, o: new THREE.Vector3(), d: new THREE.Vector3() };
    this.mv = { x: 0, z: 0 };
    this.decoys = []; this.flick = []; this._tl = []; this._cand = []; this._pl = []; this.nPerch = 0;
    this._hookCombat();
    try { this._build(); } catch (e) { console.warn('[ambush] 埋伏點建立失敗', e); }
  }

  // ---- 射線目標:藏在天花板上的不算(打不到、刀也砍不到),假屍體算(會流血、抽搐);開槍記下來(槍聲/彈道驚醒) ----
  _hookCombat() {
    const g = this.g, A = this, tg = g._targets;
    if (typeof tg === 'function' && !g._ambTargets) {
      g._ambTargets = true;
      g._targets = function () {
        const base = tg.call(this);
        if (!A.decoys.length && !A.nPerch) return base;
        const out = A._tl;
        out.length = 0;
        for (let i = 0; i < base.length; i++) { const z = base[i]; if (!(z.amb && z.state === PERCH)) out.push(z); }
        for (let i = 0; i < A.decoys.length; i++) out.push(A.decoys[i]);
        return out;
      };
    }
    const w = g.weapons;
    if (w && typeof w.onFire === 'function' && !w._ambShot) {
      const of = w.onFire;
      w.onFire = (...a) => { A._onShot(); return of(...a); };
      w._ambShot = true;
    }
  }
  _onShot() {
    const cam = this.g.camera, s = this.shot;
    cam.updateMatrixWorld();
    cam.getWorldPosition(s.o);
    s.d.set(0, 0, -1).applyQuaternion(cam.quaternion);
    s.t = this.g.time;
  }

  _build() {
    const g = this.g, W = g.world;
    this.world = W;
    const fixtures = g.hospital?.lights?.fixtures || [];
    this.fixtures = fixtures;
    const r = buildSpots(W, g.hospital?.K, fixtures);
    this.spots = r.spots; this.ceil = r.ceil; this.grilles = r.grilles;
    this.props = createAmbushProps(g, W.layout, r.grilles, W.layout.vents || []);
    this.props.onDrip = (key, p) => { this.props.splat(key, 0.014); const lp = g.player.pos; if (Math.abs(lp.x - p.x) + Math.abs(lp.z - p.z) < 9) ambushSfx('drip', p); };
    Object.assign(this.stats, { spots: r.spots.length, ceil: r.ceil.length, grilles: r.grilles.length });
    // 第一次在建構時就加進場景(開機預編譯會一起編);之後換地圖重建時自己在背景預編譯
    if (this._built) precompile(g, this.props.group).catch(() => {});
    this._built = true;
    this.ready = true;
  }

  // ---- 設定 / 節奏 ----
  level() {
    let s = null;
    try { s = this.g.horror?.director?.level || null; } catch { s = null; }
    if (!s) { try { s = settings.get('scare') ?? null; } catch { s = null; } }
    return INT[s] ? s : 'normal';
  }
  I() { return INT[this.level()]; }
  cd() { const n = Math.max(1, this.g.round | 0); return (60 - 20 * clamp((n - 1) / 8, 0, 1)) * this.I().cd; }
  _host() { const n = this.g.net; return !n || !!n.isHost; }
  _players() {
    const out = this._pl;
    out.length = 0;
    for (const p of this.g.players) if (p && p.pos && p.alive !== false && !p.downed) out.push(p);
    if (!out.length) out.push(this.g.player);
    return out;
  }

  // ======================= 每幀(flow.updateRound 開頭呼叫,遊戲中、各端都跑) =======================
  update(dt) {
    const g = this.g;
    if (g.world !== this.world || !this.ready) { if (this.ready) this.dispose(); try { this._build(); } catch (e) { console.warn('[ambush]', e); return; } }
    if (g.round !== this.round) this._newRound();
    const p = g.player, k = Math.min(1, dt * 0.9);
    this.mv.x += ((p.vx || 0) - this.mv.x) * k; this.mv.z += ((p.vz || 0) - this.mv.z) * k; // 玩家最近的前進方向(「可能經過」)
    this.props.update(dt);
    this._tickFlick(dt);
    this._tickDecoys(dt);
    if (this.decoys.length < (this.decoyWant || 0) && (this._dT -= dt) <= 0) {
      this._dT = 0.35;
      const s = this._decoySpot();
      if (s) this._addDecoy(s); else if (++this._dFail > 8) this.decoyWant = this.decoys.length;
    }
    this.hintAcc += dt;
    if (this.hintAcc >= 0.08) { this._hints(this.hintAcc); this.hintAcc = 0; }
    if (!this._host()) return;
    this.acc += dt;
    if (this.acc < 0.25) return;
    const step = this.acc;
    this.acc = 0;
    this._tick(step);
  }

  // 房主:每 0.25 秒檢查觸發、回合收尾、逾時、搬家
  _tick(step) {
    const g = this.g, W = g.world, t = g.time;
    let nPerch = 0;
    const list = this._cand;
    list.length = 0;
    for (const z of g.zombies) if (z.alive && z.amb && z.amb.dormant && !z._proxy && !z.amb.decoy) { list.push(z); if (isPerch(z.amb.code)) nPerch++; }
    this.nPerch = nPerch;
    if (!list.length) { this._huntAt = 0; return; }
    if (g.phase !== 'fighting' || g.state !== 'playing') return;
    // 場上只剩埋伏的(flow 呼叫 hunt()):全部醒來找人,回合不會卡住
    if (this._huntAt && t - this._huntReq > 0.4) this._huntAt = 0;
    if (this._huntAt && t >= this._huntAt) {
      for (const z of list) z._ambWake(true);
      this.stats.hunts++;
      this._huntAt = 0;
      return;
    }
    const pl = this._players(), sh = this.shot, shot = t - sh.t < 0.35 ? sh : null;
    for (const z of list) {
      const a = z.amb;
      if (!a || !a.dormant) continue;
      if (a.hurt) { this._fire(z, true, null); continue; }
      if (t - a.t0 > a.maxT) { z._ambWake(true); this.stats.timeouts++; continue; }
      const perch = isPerch(a.code), hy = perch ? a.ceilH - 0.25 : POSE_H[a.code] || 0.8;
      const cx = z.pos.x, cy = z.pos.y + hy, cz = z.pos.z;
      // 槍聲 / 子彈從旁邊飛過
      if (shot) {
        const ox = cx - sh.o.x, oy = cy - sh.o.y, oz = cz - sh.o.z, along = ox * sh.d.x + oy * sh.d.y + oz * sh.d.z;
        const near = ox * ox + oy * oy + oz * oz < 4.5 * 4.5;
        const miss = along > 0 && along < 45 ? Math.sqrt(Math.max(0, ox * ox + oy * oy + oz * oz - along * along)) : 99;
        if ((near || miss < 1.5) && W.hasLineOfSight(sh.o.x, sh.o.y, sh.o.z, cx, cy, cz)) { this._fire(z, true, g.player); continue; }
      }
      // 最近的玩家(同一層)
      let best = null, bd = 1e9;
      for (const p of pl) {
        if (Math.abs(p.pos.y - z.pos.y) > 1.8) continue;
        const d = Math.hypot(p.pos.x - cx, p.pos.z - cz);
        if (d < bd) { bd = d; best = p; }
      }
      if (!best || bd > a.R + 0.8) { a.stare = Math.max(0, a.stare - step); continue; }
      const p = best, ey = p.pos.y + (p.eyeH || 1.6);
      if (perch) {
        if (bd > a.R || !W.hasLineOfSight(cx, cy, cz, p.pos.x, p.pos.y + 1.2, p.pos.z)) continue;
        this._fire(z, bd < 0.9, p);
        continue;
      }
      if (!W.hasLineOfSight(p.pos.x, ey, p.pos.z, cx, cy, cz)) continue; // 互相看不到(隔著牆):繼續等
      if (bd < 1.35) { this._fire(z, true, p); continue; } // 貼上來了:不管節奏都得起來
      const dx = cx - p.pos.x, dz = cz - p.pos.z, dl = Math.hypot(dx, dz) || 1;
      const look = (-dx * Math.sin(p.yaw || 0) - dz * Math.cos(p.yaw || 0)) / dl; // 1 = 正眼看著牠
      if (look > 0.9 && bd > 2) { a.stare += step; if (a.stare < 4) continue; } // 被盯著:繼續裝死(盯太久也會撲過來)
      if (bd <= a.R || (look < -0.2 && bd <= a.R + 0.8)) this._fire(z, false, p); // 經過、轉身背對
    }
    // 離戰場太遠的埋伏:沒人看得到時搬到玩家前方(每秒最多一隻)
    this.relT += step;
    if (this.relT >= 1) { this.relT = 0; this._relocate(list); }
  }

  // 觸發:節奏允許 → 跳嚇版本;不允許時 force 才安靜地醒來,否則繼續裝死
  _fire(z, force, p) {
    const loud = this._allow(z, p);
    if (!loud && !force) return false;
    z._ambWake(!loud);
    if (loud) { this.lastTrig = this.g.time; this.stats.scares++; } else this.stats.quiet++;
    this.blockT = this.g.time + 8; // 不會兩隻同時衝出來
    return true;
  }
  _allow(z, p) {
    const g = this.g, t = g.time, I = this.I();
    if (!I.n || t < this.blockT) return false;
    if ((g.round | 0) <= 1 && t - this.roundT0 < 45) return false;
    const D = g.horror?.director;
    if (D && typeof D.request === 'function' && (!p || p === g.player || !g.net)) {
      let ok = false;
      try { ok = D.request(isPerch(z.amb.code) ? 'ceilingDrop' : 'ambush', { weight: 1, pos: z.pos }) === true; } catch { ok = false; }
      if (!ok) this.stats.denied++;
      return ok;
    }
    if (t - this.lastTrig < this.cd()) { this.stats.denied++; return false; }
    return true;
  }

  // flow.updateRound:這一回合已經沒有要出的、場上只剩埋伏的 → 2.5 秒後全部醒來
  hunt() {
    if (!this._host()) return;
    const t = this.g.time;
    if (!this._huntAt || t - this._huntReq > 0.4) this._huntAt = t + 2.5;
    this._huntReq = t;
  }
  wakeAll(quiet = true) { for (const z of this.g.zombies) if (z.alive && z.amb && z.amb.dormant && !z._proxy) z._ambWake(quiet); }

  // ======================= 出怪時改放到埋伏點(flow.spawnZombie) =======================
  onSpawn(z) {
    if (!z || !this.ready || z._proxy || !this._host()) return;
    const g = this.g;
    if (g.net?.pvp || g.phase !== 'fighting' || g.state !== 'playing') return;
    if (z.type === 'brute' || z.type === 'bloater') return;
    const I = this.I();
    if (!I.n) return;
    const n = Math.max(1, g.round | 0), t = g.time;
    if (n === 1 && t - this.roundT0 < 20) return;
    if (t - this.lastTrig < this.cd() * 0.3) return;
    let armed = 0;
    for (const o of g.zombies) if (o.alive && o.amb && o.amb.dormant) armed++;
    if (armed >= Math.min(5, (n <= 3 ? 2 : n <= 8 ? 3 : 4) + (I.n > 1.2 ? 1 : 0))) return;
    const lb = Math.round(I.n * (n <= 1 ? 1 : n <= 3 ? 2 : n <= 6 ? 3 : 4)), db = Math.round(I.n * (n <= 1 ? 0.4 : n <= 4 ? 1 : n <= 8 ? 2 : 3));
    const canL = this.per.lurk < lb, canD = this.per.drop < db;
    if ((!canL && !canD) || Math.random() > 0.45 + 0.02 * Math.min(10, n)) return;
    const dropFirst = canD && Math.random() < (z.type !== 'walker' ? 0.65 : 0.25);
    let ok = dropFirst && this._armPerch(z);
    if (!ok && canL) ok = this._armLurk(z);
    if (!ok && canD && !dropFirst) this._armPerch(z);
  }
  _armLurk(z, opt) {
    const s = this._pick(this.spots, false, opt);
    if (!s) return false;
    const code = poseFor(s.kind, z.type);
    this._place(z, s, code, code === POSE.stand && s.kind === 'corner' ? s.yaw + Math.PI : s.yaw);
    this.per.lurk++; this.stats.lurk++;
    return true;
  }
  _armPerch(z, opt) {
    const s = this._pick(this.ceil, true, opt);
    if (!s) return false;
    this._place(z, s, s.code, s.yaw);
    this.per.drop++; this.stats.drop++;
    return true;
  }
  _place(z, s, code, yaw) {
    const g = this.g, old = z.amb;
    if (old) { if (old.frozen) z._ambThaw(); if (old.spot && old.spot.busy === z) old.spot.busy = null; }
    z.pos.set(s.x, s.y, s.z);
    z.vel.set(0, 0, 0);
    z.heading = yaw;
    z.root.position.copy(z.pos);
    const perch = isPerch(code);
    z.amb = makeAmb(z, code, g.world, { spot: s, t0: old ? old.t0 : g.time, R: perch ? rand(1.7, 3.0) : rand(3.0, 4.8), fx: perch ? PERCH : LURK });
    z.amb.g = g;
    z.amb.maxT = rand(100, 150);
    s.busy = z;
    z.go(perch ? PERCH : LURK);
    z._ambFreeze();
    z.vp.x = s.x; z.vp.y = s.y + (perch ? s.ceilH : 0.6); z.vp.z = s.z;
    z._sx = s.x; z._sy = s.y; z._sz = s.z; z._noProg = 0; z._farT = 0;
  }

  // 挑埋伏點:路徑距離 8~34m、同層優先、玩家前進方向、暗處、門後;前幾名裡第一個沒人看得到的
  _pick(list, perch, opt = {}) {
    const g = this.g, W = g.world, L = W.layout, pl = this._players(), lp = g.player, mv = this.mv, ml = Math.hypot(mv.x, mv.z);
    const lo = opt.lo ?? 8, hi = opt.hi ?? 34;
    const cand = [];
    const pli = pl.map((p) => L.levelOfY(p.pos.y + 0.3));
    for (const s of list) {
      if (s.busy || s.decoy || g.time - s.usedT < 75 || (opt.kind && s.kind !== opt.kind)) continue;
      let ed = Infinity, dl = 9;
      for (let i = 0; i < pl.length; i++) { const p = pl[i], d = Math.hypot(s.x - p.pos.x, s.z - p.pos.z); if (d < ed) ed = d; const q = Math.abs(s.li - pli[i]); if (q < dl) dl = q; }
      if (dl > 1 || ed < (opt.minE ?? 6) || ed > hi + 4) continue;
      if (this._nearArmed(s, 9)) continue;
      const fd = W.flowDistance(s.x, s.y + 0.1, s.z);
      if (!Number.isFinite(fd) || fd < lo || fd > hi) continue;
      let w = (dl === 0 ? 3 : 0.5) * (perch ? (s.kind === 'hole' ? 1.3 : 1) : KIND_W[s.kind] || 1) * (s.dark ? 1.6 : 1);
      w *= fd < 12 ? 0.8 : fd > 26 ? 0.6 : 1.2;
      if (ml > 0.3) { const dx = s.x - lp.pos.x, dz = s.z - lp.pos.z, d = Math.hypot(dx, dz) || 1, f = (dx * mv.x + dz * mv.z) / (d * ml); w *= 0.35 + 0.65 * Math.max(0, f) + (f > 0.7 ? 0.5 : 0); }
      s._w = w * (0.6 + Math.random() * 0.8);
      cand.push(s);
    }
    cand.sort((a, b) => b._w - a._w);
    for (let i = 0; i < Math.min(14, cand.length); i++) if (!this._seen(cand[i], perch)) return cand[i];
    return null;
  }
  _seen(s, perch) {
    const W = this.g.world;
    for (const p of this._players()) {
      const ex = p.pos.x, ey = p.pos.y + (p.eyeH || 1.6), ez = p.pos.z;
      if (Math.hypot(s.x - ex, s.z - ez) > 50) continue;
      if (perch) { if (W.hasLineOfSight(ex, ey, ez, s.x, s.y + s.ceilH - 0.12, s.z)) return true; continue; }
      if (W.hasLineOfSight(ex, ey, ez, s.x, s.y + 0.35, s.z) || W.hasLineOfSight(ex, ey, ez, s.x, s.y + 1.3, s.z)) return true;
    }
    return false;
  }
  _nearArmed(s, r) {
    for (const z of this.g.zombies) {
      const a = z.amb;
      if (!z.alive || !a || !a.dormant || !a.spot || a.spot === s) continue;
      if (Math.abs(a.spot.li - s.li) <= 0 && Math.abs(z.pos.x - s.x) + Math.abs(z.pos.z - s.z) < r) return true;
    }
    for (const d of this.decoys) if (Math.abs(d.pos.x - s.x) + Math.abs(d.pos.z - s.z) < 1.5 && Math.abs(d.pos.y - s.y) < 1) return true;
    return false;
  }
  // 搬家:埋伏超過 20 秒、離所有玩家路徑 40m 以上、原地與新位置都沒人看得到
  _relocate(list) {
    const g = this.g, W = g.world;
    for (const z of list) {
      const a = z.amb;
      if (g.time - (a.relT || a.t0) < 20) continue;
      const fd = W.flowDistance(z.pos.x, z.pos.y + 0.1, z.pos.z);
      if (Number.isFinite(fd) && fd < 40) continue;
      a.relT = g.time;
      const perch = isPerch(a.code);
      if (this._seen(a.spot || { x: z.pos.x, y: z.pos.y, z: z.pos.z, ceilH: a.ceilH }, perch)) continue;
      const s = this._pick(perch ? this.ceil : this.spots, perch);
      if (!s) continue;
      const t0 = a.t0;
      this._place(z, s, perch ? s.code : poseFor(s.kind, z.type), s.yaw);
      z.amb.t0 = t0; z.amb.relT = g.time;
      this.stats.relocated++;
      return;
    }
  }

  // ======================= 狀態切換的特效(兩端都跑;只影響本機玩家的畫面/聲音) =======================
  fx(z, kind, a) {
    const g = this.g, lp = g.player, W = g.world;
    if (!a || !lp) return;
    const x = z.pos.x, fy = z.pos.y, zz = z.pos.z, ceilY = fy + a.ceilH;
    const d = Math.hypot(lp.pos.x - x, lp.pos.z - zz), same = Math.abs(lp.pos.y - fy) < 2.6;
    const lvl = this.I(), near = same && d < 12 && lvl.n > 0, k = clamp(1.15 - d / 11, 0.2, 1) * Math.min(1.15, 0.55 + 0.45 * lvl.n);
    const vp = z.vp;
    vp.x = x; vp.z = zz;
    const loudVoice = (pos) => { if (z.type === 'runner' || z.type === 'crawler') sfx.shriek(pos); else sfx.zAttack(z.type, pos); };
    const notify = (kd) => { try { g.horror?.director?.notify?.(kd, { weight: 1, pos: z.pos }); } catch { /* 導演可有可無 */ } };
    if (kind === 'burst') {
      vp.y = fy + 0.9;
      if (a.quiet) { sfx.zAlert(z.type, vp); return; }
      loudVoice(vp);
      if (!near) return;
      ambushSfx('sting', null, k);
      if (d < 8 && W.hasLineOfSight(lp.pos.x, lp.pos.y + 1.6, lp.pos.z, x, fy + 1, zz)) { lp.kick?.(0.025 + 0.03 * k, 0.06); lp.addShake?.(0.22 + 0.22 * k); }
      this._flicker(x, fy, zz, 0.7);
      notify('ambush');
    } else if (kind === 'drop') {
      vp.y = ceilY;
      const gi = a.gi ?? (a.gi = this._grilleAt(x, ceilY, zz));
      if (gi >= 0) { if (!this.props.isOpen(gi)) this.props.breakGrille(gi); }
      else this.props.breakTiles(x, ceilY, zz);
      ambushSfx('crash', { x, y: ceilY - 0.2, z: zz });
      g.burst?.(_v.set(x, ceilY - 0.08, zz), _down, 'dust', 14, fy);
      if (a.quiet || !near) return;
      ambushSfx('sting', null, k * 0.85);
      this._flicker(x, fy, zz, 0.45);
      notify('ceilingDrop');
    } else if (kind === 'land') {
      vp.y = fy + 0.6;
      sfx.thud(vp, false);
      g.burst?.(_v.set(x, fy + 0.06, zz), _up, 'dust', 12, fy);
      if (same && d < 9) lp.addShake?.(0.4 * (1 - d / 9));
      if (!a.quiet) loudVoice(vp); else sfx.zAlert(z.type, vp);
    }
  }
  _grilleAt(x, y, z) {
    const G = this.grilles || [];
    for (let i = 0; i < G.length; i++) { const q = G[i]; if (Math.abs(q.x - x) < 0.3 && Math.abs(q.z - z) < 0.3 && Math.abs(q.y - y) < 0.6) return i; }
    return -1;
  }
  // 附近的燈一陣狂閃(燈具的 ov 倍率,結束時還原)
  _flicker(x, y, z, dur) {
    let best = null, bd = 49;
    for (const f of this.fixtures || []) {
      if (f.state === 2 || Math.abs(f.y - y - 2.5) > 2) continue;
      const q = (f.x - x) ** 2 + (f.z - z) ** 2;
      if (q < bd) { bd = q; best = f; }
    }
    if (best && !this.flick.some((q) => q.f === best)) this.flick.push({ f: best, t1: this.g.time + dur });
  }
  _tickFlick() {
    const t = this.g.time;
    for (let i = this.flick.length - 1; i >= 0; i--) {
      const q = this.flick[i];
      if (t >= q.t1) { q.f.ov = 1; this.flick.splice(i, 1); continue; }
      q.f.ov = Math.random() < 0.55 ? 0.05 : 0.35 + Math.random() * 0.6;
    }
  }

  // ======================= 線索(本機):天花板上的滴血、抓刮、格柵晃動、垂下的手在晃;屍體的呼吸 =======================
  _hints(dt) {
    const g = this.g, lp = g.player.pos;
    for (const z of g.zombies) {
      const a = z.amb;
      if (!a || !a.dormant || !z.alive || a.decoy) continue;
      const dx = z.pos.x - lp.x, dz = z.pos.z - lp.z, d = Math.hypot(dx, dz);
      if (Math.abs(z.pos.y - lp.y) > 2.5 || d > 16) { if (a.jig > 0) { a.jig = 0; this.props.jiggle(a.gi ?? -1, 0); } continue; }
      if (isPerch(a.code)) {
        const cy = z.pos.y + a.ceilH;
        if (a.gi === undefined) a.gi = this._grilleAt(z.pos.x, cy, z.pos.z);
        a.dripT = (a.dripT ?? rand(0.2, 1)) - dt;
        if (a.dripT <= 0) {
          a.dripT = rand(0.7, 1.7);
          const key = a.key || (a.key = { x: z.pos.x, y: z.pos.y, z: z.pos.z });
          this.props.drip(key, z.pos.x + rand(-0.12, 0.12), cy - 0.04, z.pos.z + rand(-0.12, 0.12));
        }
        a.scrT = (a.scrT ?? rand(1.5, 4)) - dt;
        if (a.scrT <= 0 && d < 12) {
          a.scrT = rand(4, 9);
          ambushSfx(a.gi >= 0 && Math.random() < 0.5 ? 'rattle' : 'scratch', { x: z.pos.x + rand(-0.5, 0.5), y: cy + 0.25, z: z.pos.z + rand(-0.5, 0.5) });
          if (a.gi >= 0) a.jig = 0.5;
          if (Math.random() < 0.5) g.burst?.(_v.set(z.pos.x, cy - 0.04, z.pos.z), _down, 'dust', 3, z.pos.y);
        }
        if (a.jig > 0) { a.jig -= dt; this.props.jiggle(a.gi, a.jig > 0 ? 1 : 0); }
        if (a.code === POSE.prone && d < 14 && a.frozen) { z._resetPose(); z._ambStatic(a.code, z.t); z._ambBake(); } // 垂下的手慢慢晃
      } else if (d < 4.2) {
        a.brT = (a.brT ?? rand(0.5, 2.5)) - dt;
        if (a.brT <= 0) { a.brT = rand(3.5, 6.5); ambushSfx('breath', { x: z.pos.x, y: z.pos.y + 0.5, z: z.pos.z }); }
      }
    }
  }

  // ======================= 假屍體 =======================
  _newRound() {
    const g = this.g;
    const prev = this.round;
    this.round = g.round;
    this.roundT0 = g.time;
    this.per.lurk = 0; this.per.drop = 0;
    this._huntAt = 0;
    if (!(g.round > 0) || g.net?.pvp) return;
    if (prev > g.round || prev <= 0) this._clearDecoys();
    this.decoyWant = Math.min(6, 1 + Math.ceil(g.round / 2)); // 一幀最多建一具(每具約 3~4ms),分散在回合開始的前幾秒
    this._dT = 0; this._dFail = 0;
  }
  _decoySpot() {
    const S = this.spots, pl = this._players();
    for (let tries = 0; tries < 40; tries++) {
      const s = S[(Math.random() * S.length) | 0];
      if (!s || s.busy || s.decoy || s.kind === 'door') continue;
      let ok = true;
      for (const p of pl) if (Math.hypot(s.x - p.pos.x, s.z - p.pos.z) < 15 && Math.abs(s.y - p.pos.y) < 3) ok = false;
      for (const d of this.decoys) if (Math.abs(d.pos.x - s.x) + Math.abs(d.pos.z - s.z) < 12 && Math.abs(d.pos.y - s.y) < 1) ok = false;
      if (ok && !this._seen(s, false)) return s;
    }
    return null;
  }
  _addDecoy(s) {
    const g = this.g, A = this;
    const type = Math.random() < 0.8 ? 'walker' : 'runner';
    forceVariant(type, (Math.random() * 8) | 0);
    let d;
    try { d = new Zombie(g.scene, { x: s.x, y: s.y, z: s.z }, 1, type); } catch { return; }
    const code = s.kind === 'corner' ? (Math.random() < 0.75 ? POSE.slump : POSE.crouch) : s.kind === 'tall' ? POSE.slump : Math.random() < 0.55 ? POSE.lie : POSE.supine;
    d.heading = s.yaw;
    d.amb = makeAmb(d, code, g.world, { spot: s });
    d.amb.decoy = true;
    d._ambFreeze();
    d._decoy = true;
    d._tw = 0;
    // 被打到:只會抽搐、流血(不會死、不會起來)
    d.damage = function (amount, part) {
      const k = Math.min(2, amount / 30);
      this.flinchV += (part === 'head' ? 7 : 4.5) * k * 0.6;
      this.rollV += (Math.random() - 0.5) * 6 * k;
      if (part === 'head') this.headKick = Math.min(1.2, this.headKick + 0.5);
      this._tw = 0.7;
      if (!A.decoys.includes(this)) return false;
      return false;
    };
    s.decoy = d;
    this.decoys.push(d);
    this.stats.decoys++;
  }
  _tickDecoys(dt) {
    for (const d of this.decoys) {
      if (!(d._tw > 0)) continue;
      d._tw -= dt;
      d.t += dt;
      d._resetPose();
      d._ambStatic(d.amb.code, d.t);
      if (d._tw > 0) d._reactions(dt);
      d._applyRoot();
      d._ambBake();
    }
  }
  _clearDecoys() {
    for (const d of this.decoys) { if (d.amb?.spot) d.amb.spot.decoy = null; d.dispose(); }
    this.decoys.length = 0;
  }

  // ======================= 新的一局 / 換地圖 =======================
  reset() {
    this._clearDecoys();
    this.props?.reset();
    for (const s of this.spots || []) { s.busy = null; s.usedT = -1e9; }
    for (const s of this.ceil || []) { s.busy = null; s.usedT = -1e9; }
    for (const q of this.flick) q.f.ov = 1;
    this.flick.length = 0;
    this.decoyWant = 0;
    this.round = -1; this.lastTrig = -1e9; this.blockT = -1e9; this._huntAt = 0; this.nPerch = 0;
  }
  dispose() {
    this.reset();
    this.props?.dispose();
    this.props = null;
    this.ready = false;
  }

  // ======================= 除錯 / 測試 =======================
  debug() {
    const g = this.g, out = [];
    for (const z of g.zombies) if (z.alive && z.amb) out.push({ type: z.type, state: z.state, code: z.amb.code, dormant: z.amb.dormant, x: +z.pos.x.toFixed(1), y: +z.pos.y.toFixed(1), z: +z.pos.z.toFixed(1), R: +z.amb.R.toFixed(1) });
    return { level: this.level(), cd: +this.cd().toFixed(0), per: { ...this.per }, stats: { ...this.stats }, armed: out, decoys: this.decoys.map((d) => [+d.pos.x.toFixed(1), +d.pos.y.toFixed(1), +d.pos.z.toFixed(1), d.amb.code]) };
  }
  // 強制把一隻新的殭屍放到埋伏點(測試用):kind 'lurk' | 'drop';opt { type, lo, hi, minE }
  force(kind = 'lurk', opt = {}) {
    const g = this.g;
    if (!this.ready) this._build();
    const type = opt.type || (kind === 'drop' ? 'runner' : 'walker');
    const before = g.toSpawn;
    const z = g.spawnZombie(type);
    g.toSpawn = before;
    if (!z) return null;
    if (z.amb) return z;
    if (kind === 'drop') this._armPerch(z, opt); else this._armLurk(z, opt);
    return z;
  }
}

export function createAmbush(game) { return new Ambush(game); }
