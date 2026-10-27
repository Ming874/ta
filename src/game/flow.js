import { Zombie } from '../zombies/zombie.js';
import { TYPES } from '../zombies/types.js';
import { Shop, shopTabs, purchase, modTotal } from '../shop.js';
import { Pickups, Supplies } from '../pickups.js';
import { sfx, resume as resumeAudio } from '../audio.js';
import { settings } from '../ui/settings.js';
import { waveRoster, wavePace, waveKind, hpMul, SPECIAL, restTime, roundBonus, cleanBonus, POINTS, HOW_MUL, streakMul, streakTier, roundScore, saveBest } from './waves.js';

// 回合流程:重開、開始/結束回合、出怪、休息與商店、補給、醫療包、擊殺獎勵、計分、死亡結算。以 mixin 方式掛到 Game 上
// 難度曲線與計分數值在 src/game/waves.js
export const REST_TIME = 30; // 每回合結束後的休息(商店開放)秒數(首領回合前 40 秒,見 waves.js restTime)
const HEAL = { time: 2, amount: 50 }; // 醫療包:2 秒內回 50
const STREAK_GAP = 4; // 連殺:兩次擊殺間隔 4 秒內
const BONUS = { head: 0.5, melee: 1 }; // 爆頭 / 近戰額外金幣(基礎金幣倍率)
const TYPE_NAME = { walker: '行屍', runner: '狂奔者', crawler: '爬行者', bloater: '膿腫者', brute: '巨屍' };
const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

export const flowMethods = {
  // 世界建構時呼叫(在 world.buildNav 之前):店面與補給點都會登記碰撞盒
  buildGameplayWorld() {
    this.shop = new Shop(this.scene, this.world, { game: this });
    this.supplies = new Supplies(this.scene, this.world);
  },

  // 建構子最後呼叫一次:掉落物、按鍵、統計掛鉤、設定
  initGameplay() {
    if (this._gpInit) return;
    this._gpInit = true;
    if (!this.shop) this.buildGameplayWorld(); // 舊的建構流程沒呼叫時的保險
    this.pickups = new Pickups(this.scene, this.world);
    try { this.pickups._warm(this); } catch { /* 預先編譯掉落物 shader(載入時就做,避免第一次掉落卡頓) */ }
    this.ui.attach(this);
    settings.attach(this);
    // 射擊統計(命中率):包住 onFire,同一次開火裡出現命中標記(準心的 hit/head/kill)才算命中;霰彈任一彈丸命中即算
    const fire = this.weapons.onFire;
    this.weapons.onFire = (...a) => {
      if (this.state === 'playing') this.stats.shots++;
      this._inFire = true;
      this._shotHit = false;
      try { return fire(...a); } finally { this._inFire = false; }
    };
    const markHit = () => {
      if (this._inFire && !this._shotHit && this.state === 'playing') { this._shotHit = true; this.stats.hits++; }
    };
    this.ui.onHit = markHit; // 舊版 ui.hitMarker
    this.initCombat?.(); // 準心 HUD(combat.js)先建好,才能掛命中統計
    const ch = this.chud;
    if (ch && typeof ch.marker === 'function') {
      const mk = ch.marker.bind(ch);
      ch.marker = (...a) => { markHit(); return mk(...a); };
    }
    // 生成後套用回合血量倍率(waves.js);不改出生點挑選與生成本身(AI 模組負責)
    const spawn = this.spawnZombie;
    this.spawnZombie = (...a) => {
      const z = spawn.apply(this, a);
      if (z && !z._hpScaled) {
        z._hpScaled = true;
        const k = hpMul(this.round || 1, z.type);
        if (k !== 1) { z.maxHp = Math.round(z.maxHp * k); z.hp = z.maxHp; }
      }
      return z;
    };
    // 擊殺:在原本的 onKill(金幣、血池)之後加上獎勵、掉落與統計
    const kill = this.onKill;
    this.onKill = (...a) => { kill.apply(this, a); this.afterKill(...a); };
    // 爆炸造成的擊殺不算近戰
    for (const k of ['explode', 'explodeAt']) {
      const f = this[k];
      if (typeof f !== 'function') continue;
      this[k] = (...a) => { const prev = this._killHow; this._killHow = 'explosion'; try { return f.apply(this, a); } finally { this._killHow = prev; } };
    }
    for (const k of ['melee', 'knife', 'meleeAttack', 'stab']) {
      const f = this[k];
      if (typeof f !== 'function') continue;
      this[k] = (...a) => { const prev = this._killHow; this._killHow = 'melee'; try { return f.apply(this, a); } finally { this._killHow = prev; } };
    }
    window.addEventListener('keydown', (e) => this.onGameplayKey(e), true); // 捕獲階段:比 input.js 先處理
    this.weaponScene.visible = false; // 標題畫面不顯示手持武器
    document.addEventListener('pointerlockchange', () => {
      if (document.pointerLockElement !== this.canvas && this.ui.map.isOpen) this.ui.map.close();
    });
  },

  resetRun() {
    for (const z of this.zombies) z.dispose();
    this.zombies.length = 0;
    this.coins.clear();
    this.clearPools();
    this.hazards.clear();
    this.pickups?.clear();
    this.supplies?.reset();
    this.shop?.setOpen(false, true);
    if (this.shopUIOpen) this.closeShop(false);
    this.physics?.reset(); // 物理:道具回原位、清掉布娃娃與碎片
    const p = this.player, st = this.world.start;
    p.hp = p.maxHp;
    p.alive = true;
    p.downed = false;
    p.armor = p.maxArmor = 0;
    p.grenades = 0;
    p.medkits = 0;
    p.coins = 0;
    p.lastHurtFrom = null;
    if (p.place) p.place(st.x, st.y || 0, st.z, st.yaw || 0); // 位置 + 清掉速度/跳躍/蹲姿
    else { p.pos.set(st.x, st.y || 0, st.z); p.yaw = st.yaw || 0; p.pitch = 0; p.vx = p.vz = 0; }
    // 重新給武器(只剩手槍),清除改裝
    this.weapons.inv = {};
    this.weapons.mods = {};
    this.upgrades = {};
    this.weapons.give('pistol');
    this.weapons.switchTo('pistol', true);
    this.round = 0;
    this.kills = 0;
    this.phase = 'fighting';
    this.restT = 0;
    this.healT = 0;
    this.stats = { kills: 0, headshots: 0, melee: 0, shots: 0, hits: 0, time: 0, streak: 0, bestStreak: 0, lastKill: -99, earned: 0, pickups: 0, byType: {}, score: 0, clean: 0, spent: 0 };
    this.rstats = null; // 本回合統計(startRound 建立)
    this.ui.resetRun?.();
    this.ui.setCoins(0, true);
    this.ui.setScore?.(0, true);
    this.ui.setHP(p.hp, p.maxHp);
    this.ui.setArmor?.(0, 0);
  },

  setMood(m) {
    if (this.mood === m) return;
    this.mood = m;
    sfx.setMood(m);
  },

  begin() {
    resumeAudio();
    if (!this.ambientStarted) { sfx.ambient(); this.ambientStarted = true; }
    settings.apply(); // AudioContext 建立後才能套用音量
    this.resetRun();
    this.state = 'playing';
    this.paused = false;
    this.weaponScene.visible = true;
    this.startRound(1);
  },

  startRound(n) {
    this.round = n;
    this.queue = waveRoster(n);
    this.toSpawn = this.queue.length;
    const P = wavePace(n);
    this.maxAlive = P.maxAlive;
    this.spawnEvery = P.interval;
    this.spawnBurst = P.burst;
    this.spawnTimer = P.delay;
    this.phase = 'fighting';
    this.weapons.resupply();
    this.shop?.setOpen(false);
    this.supplies?.newRound();
    if (this.shopUIOpen) this.closeShop(false);
    this.clearPools();
    // 本回合統計(回合結束的小結、無傷獎勵)
    const S = this.stats;
    this.rstats = { t0: this.time, kills: S.kills, heads: S.headshots, shots: S.shots, hits: S.hits, score: S.score, earned: S.earned };
    this.ui.setRound(n);
    const kind = waveKind(n), sp = SPECIAL[kind];
    const tail = this.queue.includes('brute') ? ` · 巨屍 ${this.queue.filter((t) => t === 'brute').length}` : '';
    if (sp) this.ui.banner(`第 ${n} 回合`, `${sp.name} · 殭屍 ${this.toSpawn} 隻${tail}`, 3600, sp.cls);
    else this.ui.banner(`第 ${n} 回合`, `殭屍 ${this.toSpawn} 隻${tail}`, 3000, '');
    if (sp && kind !== 'boss') this.ui.feed(`${sp.name}:${sp.sub}`, { icon: 'skull', color: sp.cls === 'gold' ? '#e8c860' : '#ff6a5a', ms: 6500 });
    this.ui.prompt(null);
    sfx.roundStart();
    this.updateAmmoHud();
    this.tutorial?.('round', n);
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
    // 記下最後命中的部位(爆頭獎勵/統計用);不改變原本行為
    const dmg = z.damage;
    z.damage = (amount, part, ...rest) => { z._lastPart = part; z._lastHitT = this.time; return dmg.call(z, amount, part, ...rest); };
    z._born = this.time;
    z._farT = 0;
    this.zombies.push(z);
    this.toSpawn = Math.max(0, this.toSpawn - 1);
    if (type === 'brute') this.ui.banner('巨屍出現', '牠會咆哮後衝鋒 · 引牠撞牆再攻擊頭部', 3500, 'red');
    return z;
  },

  // 每幀:出怪、回合結束、休息倒數(取代 game.update 裡原本的出怪/回合區塊)
  updateRound(dt) {
    if (this.phase === 'fighting') {
      let alive = 0;
      for (const z of this.zombies) if (z.alive) alive++;
      this.spawnTimer -= dt;
      if (this.toSpawn > 0 && alive < this.maxAlive && this.spawnTimer <= 0) {
        this.spawnZombie();
        if (this.spawnBurst > 0) { this.spawnBurst--; this.spawnTimer = 0.45; } else this.spawnTimer = this.spawnEvery * (0.7 + Math.random() * 0.6);
      }
      this._relocateStragglers(dt);
      if (this.toSpawn === 0 && alive === 0) this.endRound();
    } else if (this.phase === 'collecting') {
      this.collectT -= dt;
      if (this.collectT <= 0 && !this.coins.collecting) this.openRest();
    } else if (this.phase === 'shop' || this.phase === 'break') {
      if (this.net) { // [net] 多人:休息倒數與開始下一回合由連線層控制(g.breakTimer),這裡只同步顯示
        if (Number.isFinite(this.breakTimer)) this.restT = Math.max(0, this.breakTimer - 0.5);
        return;
      }
      const prev = Math.ceil(this.restT);
      this.restT -= dt;
      const now = Math.ceil(this.restT);
      if (now !== prev && now <= 5 && now > 0) sfx.countdown(now);
      if (this.restT <= 0) this.nextRound();
    }
  },

  // 卡住或離所有玩家太遠的殭屍:看不到玩家一段時間後移到較近的出生點(大地圖保持節奏)
  _relocateStragglers(dt) {
    const w = this.world;
    this._strT = (this._strT || 0) - dt;
    if (this._strT > 0) return;
    this._strT = 1;
    for (const z of this.zombies) {
      if (!z.alive || z.type === 'brute') continue;
      const fd = w.flowDistance ? w.flowDistance(z.pos.x, z.pos.y, z.pos.z) : z.dist;
      const far = !Number.isFinite(fd) || fd > 55;
      z._farT = far && !z.los ? z._farT + 1 : 0;
      if (z._farT >= (Number.isFinite(fd) ? 20 : 8) && this.time - z._born > 10) {
        const s = this.pickSpawn();
        z.pos.set(s.x + (Math.random() - 0.5), s.y || 0, s.z + (Math.random() - 0.5));
        z.vel?.set?.(0, 0, 0);
        z.root?.position.copy(z.pos);
        z._farT = 0;
        z._born = this.time;
      }
    }
  },

  endRound() {
    this.phase = 'collecting';
    this.collectT = 1.4;
    const n = this.round, p = this.player, S = this.stats, R = this.rstats;
    // 回合小結:擊殺、爆頭、命中率、用時;整回合沒受傷 → 無傷獎勵
    this.roundClean = !!R && !(p.lastHurt >= R.t0);
    let sub = '收集金幣中…';
    if (R) {
      const k = S.kills - R.kills, h = S.headshots - R.heads, sh = S.shots - R.shots, acc = sh ? Math.round(((S.hits - R.hits) / sh) * 100) : 0;
      sub = `擊殺 ${k} · 爆頭 ${h} · 命中率 ${acc}% · 用時 ${mmss(this.time - R.t0)}`;
      R.dur = this.time - R.t0;
    }
    this.ui.banner(`第 ${n} 回合結束`, sub, 3200, this.roundClean ? 'gold' : '');
    // 回合分數
    const pts = roundScore(n, this.roundClean);
    this._addScore(pts);
    this.setMood('break');
    sfx.roundEnd();
    p.hp = Math.min(p.maxHp, p.hp + 20);
    this.ui.setHP(p.hp, p.maxHp);
    this.coins.collectAll();
    this.pickups?.collectAll?.(this); // 地上用得到的彈匣/醫療包也一起收
  },

  // 休息時間:商店捲門拉起、補給站開放;發回合獎勵
  openRest() {
    if (this.state !== 'playing') return;
    const n = this.round;
    this.phase = 'shop';
    this.restT = restTime(n + 1);
    this.setMood('shop');
    this.shop?.setOpen(true);
    const bonus = roundBonus(n);
    const clean = this.roundClean ? cleanBonus(n) : 0;
    this.player.coins += bonus + clean;
    this.stats.earned += bonus + clean;
    if (clean) this.stats.clean++;
    this.ui.setCoins(this.player.coins);
    this.ui.coinGain(bonus + clean);
    this.ui.feed(`清場獎勵 <b>+${bonus}</b>`, { icon: 'coin', color: '#f2c84b', html: true });
    if (clean) this.ui.feed(`毫髮無傷 <b>+${clean}</b>`, { icon: 'heal', color: '#7fe08f', html: true });
    const where = this.shop?.levelId ? `${this.shop.levelId} 便利商店` : '補給站';
    const next = waveKind(n + 1), sp = SPECIAL[next];
    const warn = sp ? ` · 下一回合:${sp.name}` : '';
    this.ui.banner('商店開放', `休息 ${this.restT} 秒 · 前往 ${where} 按 [E] 開啟商店 · [N] 立即開始${warn}`, 5200, 'gold');
    this.ui.feed('商店已開放', { icon: 'cart', color: '#ffb347' });
    this.tutorial?.('shop');
  },

  // ---------- 商店 ----------
  openShop() {
    if (this.shopUIOpen || !this.shop?.open || this.state !== 'playing') return;
    this.shopUIOpen = true;
    this.input.fireHeld = false;
    this.ui.prompt(null);
    this.ui.shop.open(this);
    if (document.pointerLockElement) document.exitPointerLock();
    sfx.shopOpen();
  },

  closeShop(relock = true) {
    if (!this.shopUIOpen) return;
    this.shopUIOpen = false;
    this.ui.shop.close();
    sfx.shopClose();
    if (relock && this.state === 'playing') {
      try { const r = this.canvas.requestPointerLock(); if (r?.catch) r.catch(() => {}); } catch { /* 需要使用者手勢 */ }
    }
  },

  shopTabs() { return shopTabs(this); },

  // 購買(UI 呼叫,傳商品或商品 key);回傳 purchase 的結果並處理音效與 HUD
  buy(item) {
    const r = purchase(this, item);
    if (r.ok) {
      if (r.equip) sfx.switch();
      else {
        sfx.cashRegister();
        if (r.sound === 'upgrade') sfx.upgrade();
        else if (r.sound === 'armor') sfx.armorEquip();
        else if (r.sound === 'ammo') sfx.pickupAmmo();
        else if (r.sound === 'heal') sfx.heal();
        else if (r.sound === 'item') sfx.pickupItem();
        else sfx.buy();
        this.ui.spend?.(r.price);
      }
      this.ui.setCoins(this.player.coins);
      this.ui.setHP(this.player.hp, this.player.maxHp);
      this.ui.setArmor?.(this.player.armor, this.player.maxArmor);
      this.updateAmmoHud();
    } else sfx.deny();
    return r;
  },

  nextRound() {
    if (this.state !== 'playing' || (this.phase !== 'shop' && this.phase !== 'break')) return;
    if (this.shopUIOpen) this.closeShop();
    this.startRound(this.round + 1);
  },

  // ---------- 醫療包(H) ----------
  useMedkit() {
    const p = this.player;
    if (this.state !== 'playing' || this.healT > 0 || p.hp <= 0 || p.downed) return false;
    if (!(p.medkits > 0)) { this.ui.pickup('沒有醫療包', '#a3a39a'); sfx.pickupDeny(); return false; }
    if (p.hp >= p.maxHp) { this.ui.pickup('生命已滿', '#a3a39a'); sfx.pickupDeny(); return false; }
    p.medkits--;
    this.healT = HEAL.time;
    this.healLeft = HEAL.amount;
    sfx.heal();
    return true;
  },

  _updateHeal(dt) {
    if (!(this.healT > 0)) { this.ui.healing(null); return; }
    const p = this.player;
    const step = Math.min(this.healLeft, (HEAL.amount / HEAL.time) * dt);
    this.healLeft -= step;
    this.healT -= dt;
    p.hp = Math.min(p.maxHp, p.hp + step);
    this.ui.setHP(p.hp, p.maxHp);
    this.ui.healing(1 - Math.max(0, this.healT) / HEAL.time);
    // 治療中放下武器、不能射擊
    const w = this.weapons;
    if (typeof w.raise === 'number') w.raise = Math.max(w.raise, 0.9);
    this.input.fireHeld = false;
    this.input.firePressed = false;
    if (this.healT <= 0 || p.hp >= p.maxHp) {
      this.healT = 0;
      this.ui.healing(null);
      this.ui.pickup(`治療完成 · 生命 ${Math.ceil(p.hp)}`, '#7dffae', { icon: 'heal', panel: 'health' });
    }
  },

  // ---------- 擊殺獎勵 ----------
  // 第三個參數:'melee'/'explosion' 字串,或 onKill 的命中資料(物理布娃娃用的 { point, dir, force, melee } / { blast })
  afterKill(z, killer = this.player, hit = null) {
    if (killer && killer !== this.player) return; // 隊友的擊殺由連線層處理
    let how = typeof hit === 'string' ? hit : hit?.melee ? 'melee' : hit?.blast ? 'explosion' : null;
    how = how || this._killHow || (z._lastPart === 'melee' ? 'melee' : null);
    const near = Math.hypot(z.pos.x - this.player.pos.x, z.pos.z - this.player.pos.z) < 2.6;
    if (!how && near && this.weapons.sinceShot > 0.35) how = 'melee'; // 沒開槍的近距離擊殺 = 近戰
    const head = how !== 'explosion' && how !== 'melee' && z._lastPart === 'head';
    const base = z.T?.coins ?? TYPES[z.type]?.coins ?? 5;
    const bonus = Math.round(base * ((head ? BONUS.head : 0) + (how === 'melee' ? BONUS.melee : 0)));
    if (bonus > 0) this.coins.drop(z.pos.x, z.pos.y, z.pos.z, bonus);
    const S = this.stats;
    S.kills++;
    if (head) S.headshots++;
    if (how === 'melee') S.melee++;
    S.earned += base + bonus;
    S.byType[z.type] = (S.byType[z.type] || 0) + 1;
    S.streak = this.time - S.lastKill <= STREAK_GAP ? S.streak + 1 : 1;
    S.lastKill = this.time;
    S.bestStreak = Math.max(S.bestStreak, S.streak);
    // 分數:類型基本分 × 爆頭/近戰/爆炸 × 連殺倍率
    const mul = streakMul(S.streak) * (head ? HOW_MUL.head : how === 'melee' ? HOW_MUL.melee : how === 'explosion' ? HOW_MUL.explosion : 1);
    this._addScore(Math.round((POINTS[z.type] || 100) * mul));
    const tag = how === 'melee' ? '近戰' : head ? '爆頭' : how === 'explosion' ? '爆炸' : '';
    this.ui.killPop(base + bonus, tag, how === 'melee' ? 'melee' : head ? 'head' : '');
    this.ui.streak?.(S.streak, streakMul(S.streak), STREAK_GAP, this.time);
    const name = TYPES[z.type]?.name || TYPE_NAME[z.type] || '殭屍';
    const tier = streakTier(S.streak);
    if (z.type === 'brute' || how === 'melee' || (head && z.type === 'bloater')) { // 一般爆頭只在準心旁跳字,不洗訊息列
      this.ui.feed(`${tag ? `${tag} · ` : ''}擊殺 ${name} <b>+${base + bonus}</b>`, { icon: how === 'melee' ? 'knife' : head ? 'head' : 'skull', color: z.type === 'brute' ? '#ff6a5a' : head ? '#ff9a6a' : '#e8e3d6', html: true });
    }
    if (tier) { // 連殺門檻:訊息 + 金幣獎勵(掉在屍體上,回合結束一起收)
      const [, label, coins] = tier;
      if (coins > 0) { this.coins.drop(z.pos.x, z.pos.y, z.pos.z, coins); S.earned += coins; }
      this.ui.feed(`${label}${coins ? ` <b>+${coins}</b>` : ''} · 分數 ×${streakMul(S.streak).toFixed(1)}`, { icon: 'bolt', color: '#ffcf5a', html: true, ms: 3600 });
      if (S.streak >= 5) sfx.killConfirm();
    }
    this.pickups?.roll(z, this);
  },

  // 加分(HUD 跳動)
  _addScore(n) {
    if (!(n > 0)) return;
    this.stats.score += n;
    this.ui.setScore?.(this.stats.score);
  },

  // ---------- 按鍵(E 互動、N 下一回合、H 醫療包、M 地圖) ----------
  onGameplayKey(e) {
    if (this.state !== 'playing') return;
    if (this.shopUIOpen) { // 商店介面吃掉所有按鍵
      e.stopPropagation();
      if (!e.repeat || /Arrow/.test(e.code)) this.ui.shop.onKey(e);
      return;
    }
    if (this.ui.map.isOpen) {
      if (['KeyM', 'Escape', 'PageUp', 'PageDown', 'Tab'].includes(e.code)) {
        e.stopPropagation();
        e.preventDefault();
        if (e.code === 'PageUp') this.ui.map.floor(1);
        else if (e.code === 'PageDown') this.ui.map.floor(-1);
        else this.ui.map.close();
        return;
      }
    }
    if (this.paused || e.repeat) return;
    switch (e.code) {
      case 'KeyE': {
        e.stopPropagation();
        const s = this.shop?.interact(this.player);
        if (s === 'open') { this.openShop(); return; }
        if (s === 'closed') { this.ui.pickup('商店只在回合間的休息時間開放', '#a3a39a'); sfx.pickupDeny(); return; }
        const st = this.supplies?.nearest(this.player);
        if (st) this.supplies.use(st, this);
        return;
      }
      case 'KeyN':
        e.stopPropagation();
        this.nextRound();
        return;
      case 'KeyH':
        this.useMedkit();
        return;
      case 'KeyM':
        e.preventDefault();
        this.ui.map.open(this);
        return;
      default:
    }
  },

  // 標題畫面/死亡畫面:鏡頭緩慢飄移(game.update 在非遊戲狀態時呼叫)
  updateIdle(dt) {
    if (this.state === 'playing') return;
    this._idleT = (this._idleT || 0) + dt;
    const t = this._idleT, cam = this.camera, st = this.world.start, p = this.player;
    if (this.state === 'menu') {
      cam.position.set(st.x + Math.sin(t * 0.05) * 0.35, (st.y || 0) + 1.65 + Math.sin(t * 0.37) * 0.025, st.z + Math.cos(t * 0.04) * 0.25);
      cam.rotation.order = 'YXZ';
      cam.rotation.set(0.06 + Math.sin(t * 0.11) * 0.035, (st.yaw || 0) + Math.sin(t * 0.07) * 0.28, Math.sin(t * 0.13) * 0.012);
    } else if (this.state === 'dead') { // 倒在地上慢慢往旁邊傾
      const k = Math.min(1, t / 1.2);
      cam.position.y += ((p.pos.y || 0) + 0.35 - cam.position.y) * Math.min(1, dt * 2.5);
      cam.rotation.z += (0.9 * k - cam.rotation.z) * Math.min(1, dt * 2);
    }
  },

  // ---------- 新手提示(src/ui/tips.js;每張只出現一次) ----------
  tutorial(id, n) {
    const T = this.ui.tips;
    if (!T || this.state !== 'playing') return;
    if (id === 'round') {
      if (n === 1) { T.show('move', 1.5); T.show('shoot', 4); }
      else if (n === 2) T.show('map', 5);
    } else T.show(id, id === 'shop' ? 2.5 : 0);
  },
  // 每 0.5 秒檢查一次情境(都是便宜的判斷)
  updateTutorial(dt) {
    const T = this.ui.tips;
    if (!T?.enabled || (this._tutT = (this._tutT || 0) - dt) > 0) return;
    this._tutT = 0.5;
    const p = this.player, w = this.weapons;
    const cap = w.magSize || 1;
    if (w.ammo && w.ammo.mag <= Math.max(1, Math.floor(cap * 0.25)) && !(w.reloading > 0)) T.show('reload');
    if (this.pickups?.items.some((it) => it.state === 'idle')) T.show('drop', 1);
    if ((p.grenades || 0) > 0) T.show('grenade');
    if ((p.medkits || 0) > 0) T.show('medkit');
    if (p.hp > 0 && p.hp < p.maxHp * 0.4) T.show('lowhp');
    if (p.exhausted) T.show('stamina');
    if (this.supplies?.nearest(p)) T.show('supply');
    for (const z of this.zombies) {
      if (!z.alive || !(z.dist < 18)) continue;
      if (z.type === 'brute') T.show('brute');
      else if (z.type === 'bloater') T.show('bloater');
      else if (z.los && z.dist < 14 && this.round >= 1) T.show('head', 0.5);
    }
  },

  // ---------- 每幀(game.update 在暫停檢查之後呼叫) ----------
  updateGameplay(dt) {
    const p = this.player;
    this.stats.time += dt;
    this.updateTutorial(dt);
    this._updateHeal(dt);
    this.pickups?.update(dt, this);
    this.supplies?.update(dt, this);
    this.shop?.update(dt, this.time, p);
    // 互動提示
    let prompt = null, dim = false;
    if (!(this.healT > 0)) {
      const s = this.shop?.interact(p);
      if (s === 'open') prompt = '按 [E] 開啟商店';
      else if (s === 'closed') { prompt = '商店 · 回合結束後的休息時間才會開放'; dim = true; }
      else {
        const st = this.supplies?.nearest(p);
        if (st) ({ text: prompt, dim } = this.supplies.promptFor(st, p));
      }
    }
    this.ui.prompt(prompt, dim);
    // 回合資訊
    if (this.phase === 'fighting') this.ui.setZombies(this.zombiesLeft());
    else if (this.phase === 'shop' || this.phase === 'break') this.ui.setRest(this.restT);
    else if (this.phase === 'collecting') this.ui.setRoundText('收集金幣中…');
    this.ui.update(this, dt);
  },

  updateAmmoHud() {
    const w = this.weapons;
    const cap = typeof w.stat === 'function' ? Math.round(w.stat(w.current, 'mag')) : Math.round(w.def.mag * (w.mods?.[w.current]?.mag ?? 1));
    const prev = this._ammoLow;
    this.ui.setAmmo(w.def.name, w.ammo.mag, w.ammo.reserve, w.reloading > 0, cap, modTotal(this, w.current));
    const low = w.ammo.mag <= Math.max(1, Math.floor(cap * 0.25)) && w.ammo.mag > 0;
    if (low && !prev && this.state === 'playing') sfx.lowAmmo();
    this._ammoLow = low;
  },

  die() {
    this.state = 'dead';
    this.weaponScene.visible = false;
    this.player.alive = false;
    this.healT = 0;
    this.setMood('dead');
    if (this.shopUIOpen) this.closeShop(false);
    this.ui.map.close();
    if (document.pointerLockElement) document.exitPointerLock();
    this.input.fireHeld = false;
    this._idleT = 0;
    this.ui.showDeath(this.deathSummary());
  },

  deathSummary() {
    const S = this.stats;
    const run = {
      round: this.round, kills: S.kills, headshots: S.headshots, melee: S.melee, score: S.score, clean: S.clean,
      accuracy: S.shots ? S.hits / S.shots : 0, shots: S.shots, hits: S.hits, time: S.time, bestStreak: S.bestStreak, streak: S.bestStreak, earned: S.earned, byType: S.byType, pickups: S.pickups || 0,
    };
    // 本機最佳紀錄(多人模式不記)
    if (!this.net) Object.assign(run, saveBest(run));
    return run;
  },

  // 回主選單
  quitToMenu() {
    if (this.shopUIOpen) this.closeShop(false);
    this.ui.map.close();
    this.resetRun();
    this.state = 'menu';
    this.paused = false;
    this.weaponScene.visible = false;
    this.setMood('menu');
    this.ui.showHud(false);
    this.ui.overlay('pause', false);
    this.ui.overlay('dead', false);
    this.ui.overlay('menu', true);
    if (document.pointerLockElement) document.exitPointerLock();
  },
};
