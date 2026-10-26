import * as THREE from 'three';
import { sfx } from '../audio.js';
import { F, NONE } from './protocol.js';

// 合作生存:房主跑回合/出怪,廣播回合開始('rs')與結束('re');其他人照著切換階段。
// 回合間(休息/商店)所有人按 N 準備,全員準備或倒數結束就開始下一回合。
// 血量歸零先倒地 30 秒(坐地持手槍、可以開槍),隊友靠近按住 E 3 秒救起;流血至死則觀戰到下一回合重生;全員倒地才結束。
const BREAK_MP = 20, SHOP_MP = 60, BLEED = 30, REVIVE_TIME = 3, REVIVE_DIST = 1.8;
const _v = new THREE.Vector3();

export class CoopMode {
  constructor(s) {
    this.s = s;
    this.g = s.game;
    this.pvp = false;
    this.votes = new Set();
    this.voted = false;
    this.timer = -1;
    this.lastPhase = null;
    this.allowNext = false;
    this.allowEnd = false;
    this.downT = 0;
    this.dead = false;
    this.spectating = false;
    this.specIdx = 0;
    this.reviveSlot = NONE;
    this.reviveP = 0;
    this.reviving = false;
    this.downB = 0;
    this.overT = 0;
    this.over = false;
    this.shieldT = 0;
    this.stats = { kills: 0, downs: 0, revives: 0 };
    this.team = new Map(); // slot → 統計(房主彙整,用於結算)
  }

  install() {
    const s = this.s, g = this.g, m = this;
    s.hook(g, 'startRound', (orig) => function (n) {
      orig.call(this, n);
      if (s.isHost) {
        s.send('rs', { n, c: g.toSpawn, m: g.maxAlive, q: (g.queue || []).map((t) => t[0]).join('') });
        m.onRoundStart(n);
      }
    });
    s.hook(g, 'endRound', (orig) => function () {
      if (s.isHost) { orig.call(this); s.send('re', { n: g.round }); m.onRoundEnd(); }
      else if (m.allowEnd) orig.call(this);
    });
    s.hook(g, 'nextRound', (orig) => function () {
      if (s.isHost && m.allowNext) return orig.call(this);
      m.vote(true);
    });
    // N:準備 / 取消準備(攔在遊戲本身的按鍵處理之前)
    this.onKey = (e) => {
      if (e.code !== 'KeyN' || g.state !== 'playing' || s.hud.chatOpen) return;
      e.stopImmediatePropagation();
      if (g.phase === 'break' || g.phase === 'shop') this.vote(!this.voted);
    };
    this.onClick = (e) => {
      if (e.target?.closest?.('#shopNext')) { e.stopImmediatePropagation(); e.preventDefault(); this.vote(true); }
    };
    window.addEventListener('keydown', this.onKey, true);
    window.addEventListener('click', this.onClick, true);
  }
  stop() {
    window.removeEventListener('keydown', this.onKey, true);
    window.removeEventListener('click', this.onClick, true);
  }

  listen() {
    const s = this.s, g = this.g;
    s.on('rs', (d, f) => {
      if (f !== s.hostSlot) return;
      if (g.shopUIOpen) g.closeShop();
      g.startRound(d.n);
      g.queue = [];
      g.toSpawn = d.c;
      this.onRoundStart(d.n);
    });
    s.on('re', (d, f) => {
      if (f !== s.hostSlot) return;
      if (g.phase === 'fighting') { this.allowEnd = true; g.endRound(); this.allowEnd = false; }
      this.onRoundEnd();
    });
    s.on('vote', (d, f) => { if (s.isHost) { if (d) this.votes.add(f); else this.votes.delete(f); this.sendVotes(); } });
    s.on('rv', (d, f) => { if (f === s.hostSlot) { this.votes = new Set(d); this.voted = this.votes.has(s.me); } });
    s.on('down', (d, f) => {
      const rp = s.remotes.get(f);
      if (!rp) return;
      rp.downed = true;
      s.hud.feed(`${rp.name} 倒地了!靠近按住 E 救援`, 'down');
      sfx.downed?.();
      this.bump(f, 'downs');
    });
    s.on('up', (d, f) => {
      const rp = s.remotes.get(f);
      if (rp) rp.downed = false;
      if (!(d?.by >= 0)) { if (rp) s.hud.feed(`${rp.name} 撐過了這一回合`, 'revive'); return; }
      const by = d.by === s.me ? '你' : s.nameOf(d.by);
      if (rp) s.hud.feed(`${by} 救起了 ${rp.name}`, 'revive');
      if (d.by === s.me) { this.stats.revives++; s.hud.center('救援成功', 1500); }
      this.bump(d.by, 'revives');
    });
    s.on('bleed', (d, f) => { const rp = s.remotes.get(f); if (rp) s.hud.feed(`${rp.name} 失血過多死亡,下一回合復活`, 'dead'); });
    s.on('rev', (d, f) => { if (this.g.player.downed && !this.dead) this.revive(f); });
    s.on('go', (d, f) => { if (f === s.hostSlot) this.gameOver(d); });
    s.on('sync', (d, f) => {
      if (f !== s.hostSlot) return;
      g.round = d.n;
      g.toSpawn = d.c;
      if (d.phase === 'fighting') { g.startRound(d.n); g.queue = []; g.toSpawn = d.c; }
      else { g.phase = d.phase === 'shop' ? 'break' : d.phase; g.ui.setRound?.(d.n); }
      if (d.coins > 0) { g.player.coins += d.coins; g.ui.setCoins(g.player.coins); s.hud.feed(`中途加入:獲得 ${d.coins} 金幣`, 'coin'); }
    });
  }

  hostTimer() { return this.g.phase === 'break' || this.g.phase === 'shop' ? Math.max(0, this.timer) : -1; }

  begin() {
    const s = this.s, g = this.g;
    if (s.isHost) {
      g.startRound(1);
    } else {
      g.phase = 'break';
      g.round = 0;
      g.breakTimer = 99;
      s.hud.center(s.late ? '中途加入:同步中…' : '等待房主開始…', 3000);
    }
    this.pos0();
  }
  // 出生位置:起點附近依座位錯開
  pos0() {
    const g = this.g, st = g.world.start, k = this.s.me;
    const a = k * 1.3;
    const p = g.player.pos;
    p.set(st.x + Math.cos(a) * (k ? 1.2 : 0), st.y || 0, st.z + Math.sin(a) * (k ? 1.2 : 0));
    g.world.resolve?.(p, 0.35);
  }

  // 新玩家加入(房主):補送殭屍與回合狀態
  onJoin(rp, back = false) {
    const s = this.s, g = this.g;
    s.zs.sendAllTo(rp.id);
    s.send('sync', { n: g.round, c: g.toSpawn, phase: g.phase, coins: back ? 0 : Math.max(0, (g.round - 1) * 40) }, rp.id);
    this.sendVotes();
  }
  onLeave(rp) { if (this.s.isHost) { this.votes.delete(rp.id); this.sendVotes(); } }
  becomeHost() {
    const g = this.g;
    // 從最後一張快照接手回合狀態
    const H = this.s.zs.host;
    if (H.round) g.round = H.round;
    if (g.phase === 'fighting') {
      g.toSpawn = H.toSpawn;
      g.queue = Array.from({ length: g.toSpawn }, () => 'walker');
      g.maxAlive = Math.min(14, 6 + Math.floor(g.round / 2));
      g.spawnTimer = 2;
    } else if (g.phase === 'collecting') {
      g.phase = 'break';
      this.timer = 8;
    } else this.timer = Math.max(5, H.timer > 0 ? H.timer : 10);
    this.votes = new Set(this.voted ? [this.s.me] : []);
    this.sendVotes();
  }

  vote(on) {
    const s = this.s, g = this.g;
    if (g.phase !== 'break' && g.phase !== 'shop') return;
    this.voted = on;
    if (s.isHost) { if (on) this.votes.add(s.me); else this.votes.delete(s.me); this.sendVotes(); }
    else s.send('vote', on ? 1 : 0, s.hostSlot);
    sfx.uiClick?.();
  }
  sendVotes() { if (this.s.isHost) this.s.send('rv', [...this.votes]); }
  needed() {
    let n = 1;
    for (const rp of this.s.remotes.values()) if (rp.connected) n++;
    return n;
  }
  allReady() {
    if (!this.votes.has(this.s.me)) return false;
    for (const rp of this.s.remotes.values()) if (rp.connected && !this.votes.has(rp.id)) return false;
    return true;
  }

  onRoundStart(n) {
    this.votes.clear();
    this.voted = false;
    this.timer = -1;
    if (this.dead) this.respawn();
    this.over = false;
  }
  onRoundEnd() {
    const p = this.g.player;
    if (p.downed && !this.dead) this.revive(null, 25); // 回合結束自動起身
  }
  onZombieKilled(z, slot) {
    if (slot === this.s.me) this.stats.kills++;
    this.bump(slot, 'kills');
  }
  bump(slot, key) {
    if (slot === undefined || slot === null || slot === NONE) return;
    const t = this.team.get(slot) || { kills: 0, downs: 0, revives: 0 };
    t[key]++;
    this.team.set(slot, t);
  }

  // ---- 倒地 / 救援 / 觀戰 ----
  onLocalDeath() {
    const g = this.g, p = g.player, s = this.s;
    if (p.downed || this.dead || this.over) return;
    p.downed = true;
    p.hp = 0;
    this.downT = BLEED;
    this.stats.downs++;
    this.bump(s.me, 'downs');
    if (g.weapons.has('pistol') && g.weapons.current !== 'pistol') g.weapons.switchTo('pistol');
    if (g.shopUIOpen) g.closeShop();
    s.send('down', 1);
    sfx.downed?.();
    s.hud.center('你倒地了!撐住,等隊友救援', 2500);
    s.sendState(true);
  }
  revive(by, hp = 35) {
    const g = this.g, p = g.player, s = this.s;
    p.downed = false;
    p.alive = true;
    p.hp = Math.min(p.maxHp, hp);
    g.ui.setHP(p.hp, p.maxHp);
    this.downT = 0;
    this.shieldT = 1.5;
    s.send('up', { by: by ?? -1 });
    sfx.revive?.();
    if (by !== null && by !== undefined) s.hud.center(`${s.nameOf(by)} 把你救起來了`, 2000);
    s.sendState(true);
  }
  bleedOut() {
    const g = this.g, p = g.player, s = this.s;
    p.downed = false;
    p.alive = false;
    p.hp = 0;
    this.dead = true;
    this.spectating = true;
    s.send('bleed', 1);
    s.hud.center('你失血過多……下一回合開始時復活', 3500);
    s.sendState(true);
  }
  respawn() {
    const g = this.g, p = g.player;
    this.dead = false;
    this.spectating = false;
    p.alive = true;
    p.downed = false;
    p.hp = p.maxHp;
    g.ui.setHP(p.hp, p.maxHp);
    this.pos0();
    p.vx = p.vz = 0;
    g.weaponScene.visible = true;
    this.shieldT = 2;
    this.s.hud.center('你復活了', 1800);
    this.s.sendState(true);
  }

  gameOver(d) {
    const g = this.g, s = this.s;
    if (this.over) return;
    this.over = true;
    g.state = 'dead';
    g.setMood?.('dead');
    document.exitPointerLock?.();
    g.input.fireHeld = false;
    s.hud.results({
      title: '全員陣亡', sub: `撐到了第 ${d.n} 回合`,
      cols: ['玩家', '擊殺', '倒地', '救援'],
      rows: d.t.map(([id, k, dn, rv]) => [s.nameOf(id) + (id === s.me ? '(你)' : ''), k, dn, rv]),
    });
  }

  // 房主:每幀檢查全員倒地、回合間倒數
  update(dt) {
    const s = this.s, g = this.g, p = g.player;
    this.shieldT = Math.max(0, this.shieldT - dt);
    if (g.state !== 'playing') return;
    // 倒地流血
    if (p.downed && !this.dead) {
      this.downT -= dt;
      if (this.downT <= 0) this.bleedOut();
    }
    if (s.isHost) {
      // 回合間:多人版的休息/商店倒數(全員準備就提早開始)
      if (g.phase !== this.lastPhase) {
        if (g.phase === 'break') this.timer = BREAK_MP;
        else if (g.phase === 'shop') this.timer = SHOP_MP;
        this.lastPhase = g.phase;
      }
      if (g.phase === 'break' || g.phase === 'shop') {
        this.timer -= dt;
        if (this.allReady() && this.timer > 3) this.timer = 3;
        g.breakTimer = Math.max(0.5, this.timer + 0.5); // 不讓原本 6 秒的計時器自己開始
        if (this.timer <= 0) { this.allowNext = true; g.nextRound(); this.allowNext = false; }
      }
      // 全員倒地 → 結束
      let standing = p.alive !== false && !p.downed && !this.dead ? 1 : 0;
      for (const rp of s.remotes.values()) if (rp.connected && rp.up && !rp.downed) standing++;
      if (!standing && g.phase === 'fighting') {
        this.overT += dt;
        if (this.overT > 0.8 && !this.over) {
          const rows = [[s.me, ...this.tally(s.me)]];
          for (const rp of s.remotes.values()) rows.push([rp.id, ...this.tally(rp.id)]);
          const d = { n: g.round, t: rows };
          s.send('go', d);
          this.gameOver(d);
        }
      } else this.overT = 0;
    } else if (g.phase === 'break' || g.phase === 'shop') {
      const H = s.zs.host;
      if (H.timer >= 0) g.breakTimer = Math.max(0.5, H.timer + 0.5);
      else g.breakTimer = 99;
    }
    this.lastPhase = g.phase;
  }
  tally(slot) { const t = this.team.get(slot) || { kills: 0, downs: 0, revives: 0 }; return [t.kills, t.downs, t.revives]; }

  // 本機玩家更新後:倒地鏡頭、觀戰鏡頭、救援
  afterPlayer(dt) {
    const s = this.s, g = this.g, p = g.player, cam = g.camera;
    this.downB += ((p.downed ? 1 : 0) - this.downB) * Math.min(1, dt * 5);
    if (this.downB > 0.01 && !this.dead) {
      cam.position.y -= 1.0 * this.downB;
      cam.rotation.z += 0.12 * this.downB;
      if (p.downed && g.weapons.current !== 'pistol' && g.weapons.has('pistol')) g.weapons.switchTo('pistol', true);
    }
    // 觀戰:跟在活著的隊友後上方
    if (this.dead) {
      g.weaponScene.visible = false;
      g.input.fireHeld = false;
      if (g.input.firePressed) { this.specIdx++; g.input.firePressed = false; }
      const alive = [...s.remotes.values()].filter((r) => r.alive && r.avatar);
      if (alive.length) {
        const t = alive[this.specIdx % alive.length];
        const a = t.avatar.root.position;
        const back = _v.set(Math.sin(t.yaw), 0, Math.cos(t.yaw)).multiplyScalar(2.6);
        cam.position.set(a.x + back.x, a.y + 2.1, a.z + back.z);
        cam.lookAt(a.x, a.y + 1.4, a.z);
        s.hud.spectate(t.name);
      } else s.hud.spectate(null);
    } else {
      if (!g.weaponScene.visible) g.weaponScene.visible = true;
      s.hud.spectate(null);
    }
    // 救援:靠近倒地隊友,按住 E
    this.reviving = false;
    let cand = null, cd = REVIVE_DIST;
    if (!p.downed && !this.dead && p.alive !== false) {
      for (const rp of s.remotes.values()) {
        if (!rp.downed || !rp.connected) continue;
        const d = Math.hypot(rp.pos.x - p.pos.x, rp.pos.z - p.pos.z) + Math.abs(rp.pos.y - p.pos.y);
        if (d < cd) { cd = d; cand = rp; }
      }
    }
    if (cand && p.keys.KeyE && !g.shopUIOpen && !g.paused) {
      if (this.reviveSlot !== cand.id) { this.reviveSlot = cand.id; this.reviveP = 0; }
      this.reviveP += dt / REVIVE_TIME;
      this.reviving = true;
      if (this.reviveP >= 1) { s.send('rev', 1, cand.id); this.reviveP = 0; this.reviveSlot = NONE; this.reviving = false; }
    } else { this.reviveP = Math.max(0, this.reviveP - dt * 2); if (this.reviveP <= 0) this.reviveSlot = NONE; }
    s.hud.revive(cand, this.reviving ? this.reviveP : 0, p.downed && !this.dead ? this.downT : -1, this.helper());
  }
  // 倒地時:誰正在救我
  helper() {
    for (const rp of this.s.remotes.values()) if ((rp.flags & F.REVIVE) && rp.rt === this.s.me) return { name: rp.name, p: rp.rp };
    return null;
  }
  plateExtra(rp) { return rp.downed && rp.connected ? '倒地 · 按住 E 救援' : ''; }
}
