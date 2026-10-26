import { Zombie } from '../zombies/zombie.js';
import { roster } from '../zombies/types.js';
import { Shop } from '../shop.js';
import { sfx, resume as resumeAudio } from '../audio.js';

// 回合流程:重開、開始/結束回合、出怪、商店、死亡。以 mixin 方式掛到 Game 上
export const flowMethods = {
  resetRun() {
    for (const z of this.zombies) z.dispose();
    this.zombies.length = 0;
    this.coins.clear();
    this.clearPools();
    this.hazards.clear();
    if (this.shop) { this.shop.dispose(); this.shop = null; }
    const p = this.player, st = this.world.start;
    p.hp = p.maxHp;
    p.alive = true;
    p.downed = false;
    p.armor = p.maxArmor = 0;
    p.grenades = 0;
    p.medkits = 0;
    p.coins = 0;
    if (p.place) p.place(st.x, st.y || 0, st.z, st.yaw || 0); // 位置 + 清掉速度/跳躍/蹲姿
    else { p.pos.set(st.x, st.y || 0, st.z); p.yaw = st.yaw || 0; p.pitch = 0; p.vx = p.vz = 0; }
    // 重新給武器(只剩手槍)
    this.weapons.inv = {};
    this.weapons.give('pistol');
    this.weapons.switchTo('pistol', true);
    this.round = 0;
    this.kills = 0;
    this.ui.setCoins(0);
    this.ui.setHP(p.hp, p.maxHp);
  },

  setMood(m) {
    if (this.mood === m) return;
    this.mood = m;
    sfx.setMood(m);
  },

  begin() {
    resumeAudio();
    if (!this.ambientStarted) { sfx.ambient(); this.ambientStarted = true; }
    this.resetRun();
    this.state = 'playing';
    this.startRound(1);
  },

  startRound(n) {
    this.round = n;
    this.queue = roster(n);
    this.toSpawn = this.queue.length;
    this.spawnTimer = 3;
    this.maxAlive = Math.min(14, 6 + Math.floor(n / 2));
    this.phase = 'fighting';
    this.weapons.resupply();
    if (this.shop) { this.shop.dispose(); this.shop = null; }
    this.clearPools();
    this.ui.setRound(n);
    this.ui.banner(`第 ${n} 回合`, `殭屍 ${this.toSpawn} 隻`, 3000);
    this.ui.prompt(null);
    sfx.roundStart();
    this.updateAmmoHud();
  },

  zombiesLeft() {
    return this.toSpawn + this.zombies.filter((z) => z.alive).length;
  },

  // 出生點:優先「沿導航路徑 18~50m、玩家看不到」的點(3D 視線;35m 外有霧遮擋不算看得到);
  // 符合的少於 3 個時,依路徑距離由近到遠補到 3 個(最遠 80m),都沒有再逐步放寬
  pickSpawn() {
    const w = this.world;
    const players = this.players.filter((p) => p.alive !== false);
    const scored = w.spawns.map((s) => {
      const sy = s.y || 0;
      const ed = Math.min(...players.map((p) => Math.hypot(s.x - p.pos.x, s.z - p.pos.z) + Math.abs(sy - p.pos.y) * 2));
      const fdRaw = w.flowDistance ? w.flowDistance(s.x, sy, s.z) : Infinity;
      const fd = Number.isFinite(fdRaw) ? fdRaw : ed;
      const seen = players.some((p) => Math.hypot(s.x - p.pos.x, sy - p.pos.y, s.z - p.pos.z) < 35 && w.hasLineOfSight(s.x, sy + 1.5, s.z, p.pos.x, p.pos.y + 1.6, p.pos.z));
      return { s, ed, fd, seen, reach: Number.isFinite(fdRaw) };
    });
    const pool = scored.filter((q) => q.reach && q.ed > 12 && q.fd >= 18 && !q.seen).sort((a, b) => a.fd - b.fd);
    let near = pool.filter((q) => q.fd <= 50);
    if (near.length < 3) near = pool.slice(0, 3).filter((q) => q.fd <= 80);
    if (near.length) return near[(Math.random() * near.length) | 0].s;
    const tiers = [
      (q) => q.ed > 10 && !q.seen,
      (q) => q.ed > 8,
      () => true,
    ];
    for (const ok of tiers) {
      const cand = scored.filter(ok);
      if (cand.length) return cand[(Math.random() * cand.length) | 0].s;
    }
    return w.spawns[0];
  },

  spawnZombie(type = this.queue.shift() || 'walker') {
    const s = this.pickSpawn();
    const pos = { x: s.x + (Math.random() - 0.5) * 1.2, y: s.y || 0, z: s.z + (Math.random() - 0.5) * 1.2 };
    const z = new Zombie(this.scene, pos, this.round, type);
    this.zombies.push(z);
    this.toSpawn = Math.max(0, this.toSpawn - 1);
    if (type === 'brute') this.ui.banner('巨屍出現', '牠會咆哮後衝鋒 · 引牠撞牆再攻擊頭部', 3500);
    return z;
  },

  endRound() {
    this.phase = 'collecting';
    this.ui.banner(`第 ${this.round} 回合結束`, '收集金幣中…', 3000);
    this.setMood('break');
    sfx.roundEnd();
    const p = this.player;
    p.hp = Math.min(p.maxHp, p.hp + 25);
    this.ui.setHP(p.hp, p.maxHp);
    const after = () => {
      if (this.state !== 'playing') return;
      if (this.round % 5 === 0) {
        this.phase = 'shop';
        this.setMood('shop');
        this.shop = new Shop(this.scene, this.world);
        this.ui.banner('武器商店開放', '前往補給站購買武器', 5000);
      } else {
        this.phase = 'break';
        this.breakTimer = 6;
      }
    };
    if (this.coins.piles.length) {
      this.coins.collectAll();
      this.coins.pendingDone = after;
    } else setTimeout(after, 1500);
  },

  openShop() {
    this.shopUIOpen = true;
    this.ui.renderShop(this.player, this.weapons, (id, price) => this.buy(id, price));
    this.ui.overlay('shop', true);
    document.exitPointerLock();
    this.input.fireHeld = false;
  },

  closeShop(relock = true) {
    this.shopUIOpen = false;
    this.ui.overlay('shop', false);
    if (relock && this.state === 'playing') this.canvas.requestPointerLock();
  },

  buy(id, price) {
    if (this.player.coins < price) { sfx.deny(); return; }
    this.player.coins -= price;
    if (id === 'ammo') this.weapons.refillAll();
    else {
      const owned = this.weapons.has(id);
      this.weapons.give(id);
      if (!owned) this.weapons.switchTo(id);
    }
    sfx.buy();
    this.ui.setCoins(this.player.coins);
    this.updateAmmoHud();
    this.ui.renderShop(this.player, this.weapons, (i, p) => this.buy(i, p));
  },

  nextRound() {
    if (this.shopUIOpen) this.closeShop();
    this.startRound(this.round + 1);
  },

  updateAmmoHud() {
    const w = this.weapons;
    this.ui.setAmmo(w.def.name, w.ammo.mag, w.ammo.reserve, w.reloading > 0);
  },

  die() {
    this.state = 'dead';
    this.player.alive = false;
    this.setMood('dead');
    document.exitPointerLock();
    this.input.fireHeld = false;
    document.getElementById('deadinfo').innerHTML = `你撐到了第 <b>${this.round}</b> 回合<br />擊殺 ${this.kills} · 累積金幣 ${this.player.coins}`;
    this.ui.overlay('dead', true);
  },
};
