// 驚嚇導演(本機,每位玩家各自一套):依張力、回合階段、冷卻與「驚嚇強度」設定決定什麼時候可以嚇人。
// 原則:
//  - 安靜的時間累積「恐懼值」(dread),累積夠了才放事件;戰鬥中只允許極輕的東西(耳語、聲音)。
//  - 大場面(停電、燈一盞盞熄滅、身後的人影)保留給回合間休息與探索,不在打鬥中;大場面進行中拒絕所有其他驚嚇。
//  - 跳嚇(jump)之間有全域冷卻,不連發;大場面之後有一段「喘息」。
//  - 開局 60 秒內不閃燈、不放大場面(只有耳語與環境音)。
//
// 給其他模組的穩定介面(ambush 代理等;呼叫端請用 game.horror?.director 防護):
//   director.request(kind, { weight = 1, pos }) → true = 現在可以放這種驚嚇(已套用全域冷卻、張力節奏、大場面鎖)
//   director.notify(kind, { weight, pos })      → 記錄「剛剛嚇過了」(request 回傳 true 後真的放了就呼叫)
//   kind:'ambush' | 'ceilingDrop'(伏擊代理)、以及本模組自己的種類(見 KINDS)
//   director.level      → 'off' | 'low' | 'normal' | 'high'(設定 驚嚇強度)
//   director.tension    → 0..1(戰鬥張力:最近殭屍距離、場上數量、血量、剛受傷)
//   director.dread      → 0..100(安靜累積的恐懼值)
//   director.bigActive  → 大場面進行中
// 驚嚇強度 'off' 時 request 一律回傳 false(呼叫端應退回一般行為,例如伏擊改成普通出怪)。

// 每種驚嚇的層級:small 背景(耳語、聲音、單燈閃)/ medium 看得見的事件或伏擊 / big 演出
// cd:這種本身的冷卻(秒,normal 強度);jump:算不算「跳嚇」(跳嚇之間有全域間隔)
export const KINDS = {
  // 外部(伏擊代理)
  ambush: { tier: 'medium', cd: 28, jump: true, ext: true },
  ceilingDrop: { tier: 'medium', cd: 40, jump: true, ext: true },
  // 本模組
  whisper: { tier: 'small', cd: 14 },
  ambient: { tier: 'small', cd: 35 },
  flicker: { tier: 'small', cd: 60 },
  signal: { tier: 'small', cd: 40 }, // 殭屍靠近時附近的燈閃一下
  crawl: { tier: 'small', cd: 70 },
  silence: { tier: 'small', cd: 90 },
  lullaby: { tier: 'small', cd: 120 },
  radioOn: { tier: 'small', cd: 100 },
  phoneRing: { tier: 'small', cd: 110 },
  underDoor: { tier: 'small', cd: 80 },
  door: { tier: 'medium', cd: 50, jump: true },
  doorCreep: { tier: 'medium', cd: 60 },
  cart: { tier: 'medium', cd: 60 },
  rollToward: { tier: 'medium', cd: 80 },
  moveBehind: { tier: 'medium', cd: 70 },
  footprints: { tier: 'medium', cd: 90 },
  handprints: { tier: 'medium', cd: 90 },
  writing: { tier: 'medium', cd: 100 },
  coldBreath: { tier: 'medium', cd: 90 },
  tvFace: { tier: 'medium', cd: 110 },
  elevator: { tier: 'medium', cd: 140 },
  anchor: { tier: 'medium', cd: 40 },
  fall: { tier: 'medium', cd: 70, jump: true },
  figure: { tier: 'medium', cd: 80 },
  window: { tier: 'medium', cd: 90 },
  child: { tier: 'medium', cd: 100 },
  nurse: { tier: 'medium', cd: 120 },
  curtain: { tier: 'medium', cd: 90 },
  mirror: { tier: 'medium', cd: 90 },
  apparition: { tier: 'medium', cd: 80 }, // 劇情組用的通稱(STORY.md §12)
  behind: { tier: 'big', cd: 150, jump: true },
  lightsDie: { tier: 'big', cd: 170 },
  blackout: { tier: 'big', cd: 200 },
};
const TIER = {
  small: { dread: 16, cost: 12, gap: 22 },
  medium: { dread: 40, cost: 34, gap: 45 },
  big: { dread: 75, cost: 100, gap: 150 },
};
// 驚嚇強度:rate 恐懼累積倍率、cd 冷卻倍率、big 允許大場面、medium 允許看得見的事件
export const INTENSITY = {
  off: { rate: 0, cd: 99, medium: false, big: false },
  low: { rate: 0.5, cd: 1.8, medium: true, big: false },
  normal: { rate: 1, cd: 1, medium: true, big: true },
  high: { rate: 1.6, cd: 0.65, medium: true, big: true },
};
export const LEVELS = ['off', 'low', 'normal', 'high'];
const CALM_START = 60; // 開局多少秒內不放 medium/big 與閃燈
const LIGHT_KINDS = new Set(['flicker', 'signal', 'lightsDie', 'blackout']);
// 誘集期間(回合進行中)也可以有的:不是鬼的東西(宿主、伏擊、殭屍靠近的閃燈、天花板裡的爬行)。
// 其他全部是「鬼」:只在靜默期(回合之間的休息)出現(STORY.md §1.9、§4.2、§12)
export const FIGHT_OK = new Set(['ambient', 'signal', 'crawl', 'ambush', 'ceilingDrop']);

export class Director {
  constructor(horror) {
    this.h = horror;
    this.t = 0; // 本局經過時間(遊戲時間,暫停不走)
    this.dread = 0;
    this.tension = 0;
    this.calm = 0; // 連續多少秒沒有殭屍在 14m 內
    this.bigUntil = 0;
    this.last = {}; // kind → 上次時間
    this.lastTier = { small: -1e9, medium: -1e9, big: -1e9 };
    this.lastJump = -1e9;
    this.roundT = 0; // 本回合(或本次休息)開始後的秒數
    this.phase = 'fighting';
    this.log = [];
    this.fired = 0;
    this.denied = 0;
  }
  get level() {
    const s = this.h.settings?.get?.('scare');
    if (this.h.game?.net?.pvp) return s === 'off' ? 'off' : 'low'; // 對戰:只留背景(非正史模擬戰,不要干擾對打)
    return LEVELS.includes(s) ? s : 'normal';
  }
  get I() { return INTENSITY[this.level]; }
  get bigActive() { return this.t < this.bigUntil; }
  // 靜默期:回合之間的休息(誘集器關閉);多人時連線層的 'wait' 也算
  get silent() { const ph = this.h.game?.phase; return ph === 'shop' || ph === 'break' || ph === 'wait'; }
  // 新的一局
  reset() {
    this.t = 0; this.dread = 0; this.tension = 0; this.calm = 0; this.bigUntil = 0; this.roundT = 0;
    this.last = {}; this.lastTier = { small: -1e9, medium: -1e9, big: -1e9 }; this.lastJump = -1e9; this.log.length = 0;
  }
  // 每幀(遊戲中、非暫停):張力與恐懼值
  update(dt, game) {
    this.t += dt;
    const p = game.player;
    if (game.phase !== this.phase) { this.phase = game.phase; this.roundT = 0; } else this.roundT += dt;
    let near = 99, alive = 0;
    for (const z of game.zombies) if (z.alive) { alive++; if (z.dist < near) near = z.dist; }
    const hp = p.hp / (p.maxHp || 100), hurt = Math.max(0, 1 - (game.time - (p.lastHurt ?? -99)) / 3);
    const tz = Math.max(0, Math.min(1, 1 - (near - 2) / 14));
    const tgt = Math.min(1, tz * 0.75 + Math.min(1, alive / 10) * 0.15 + Math.max(0, 0.35 - hp) * 1.2 + hurt * 0.4);
    this.tension += (tgt - this.tension) * Math.min(1, dt * (tgt > this.tension ? 4 : 0.8));
    this.calm = near < 14 ? 0 : this.calm + dt;
    // 恐懼:安靜時累積(休息時間、探索更快),戰鬥張力高時停止
    const quiet = this.tension < 0.25 ? 1 : this.tension < 0.5 ? 0.3 : 0;
    const phaseK = game.phase === 'shop' || game.phase === 'break' ? 1.5 : this.calm > 10 ? 1.2 : 0.7;
    const esc = 1 + Math.min(1, this.t / 900) * 0.6 + Math.min(10, game.round || 0) * 0.04; // 一局越後面累積越快
    this.dread = Math.min(100, this.dread + dt * quiet * phaseK * esc * this.I.rate * 1.15);
  }
  // 現在能不能放某層級的驚嚇(不看種類冷卻)
  allowTier(tier, game, skipGap = false) {
    const I = this.I;
    if (I.rate <= 0) return false;
    if (this.h.game?.net?.pvp && tier !== 'small') return false; // 對戰:只留背景
    if (this.bigActive) return false;
    if (tier !== 'small' && !I.medium) return false;
    if (tier === 'big' && !I.big) return false;
    if (tier !== 'small' && this.t < CALM_START) return false;
    const T = TIER[tier];
    if (!skipGap && this.t - this.lastTier[tier] < T.gap * I.cd) return false;
    if (tier === 'big') { // 大場面:不在打鬥中;休息時間或長時間沒有殭屍靠近
      if (this.tension > 0.2) return false;
      const ph = game?.phase;
      if (!(ph === 'shop' || ph === 'break' || ph === 'wait')) return false;
      if (ph === 'shop' && this.roundT < 6) return false; // 「商店開放」橫幅期間不搶戲
    }
    if (tier === 'medium' && this.tension > 0.55) return false;
    return true;
  }
  // ---- 穩定介面 ----
  request(kind, o = {}) {
    const K = KINDS[kind] || { tier: 'medium', cd: 30, jump: true, ext: true };
    const game = this.h.game, I = this.I;
    const w = Math.max(0.2, o.weight ?? 1);
    const deny = () => { this.denied++; return false; };
    if (!game || game.state !== 'playing') return deny();
    if (!this.allowTier(K.tier, game, kind === 'whisper')) return deny(); // 耳語只看自己的冷卻(進新區域的那句不要被別的小事件擋掉)
    if (this.t - (this.last[kind] ?? -1e9) < K.cd * I.cd * w) return deny();
    if (K.jump && this.t - this.lastJump < (K.tier === 'big' ? 60 : 18) * I.cd * w) return deny(); // 跳嚇不連發
    if (K.jump && this.t - this.lastTier.big < 40 * I.cd) return deny(); // 大場面之後的喘息
    if (this.phase === 'fighting' && this.roundT < 6) return deny(); // 回合剛開始
    if (!this.silent && !FIGHT_OK.has(kind)) return deny(); // 鬼只在靜默期
    if (this.t < CALM_START && LIGHT_KINDS.has(kind)) return deny(); // 開局 60 秒內燈不閃
    // 恐懼值不夠:外部(伏擊)看得見的驚嚇只要求一半門檻(牠們本身就是戰鬥的一部分)
    const need = TIER[K.tier].dread * (K.ext ? 0.5 : 1) * Math.min(1.6, w);
    if (this.dread < need && !o.force) return deny();
    return true;
  }
  notify(kind, o = {}) {
    const K = KINDS[kind] || { tier: 'medium', jump: true };
    const w = Math.max(0.2, o.weight ?? 1);
    this.last[kind] = this.t;
    this.lastTier[K.tier] = this.t;
    if (K.jump) this.lastJump = this.t;
    this.dread = Math.max(0, this.dread - TIER[K.tier].cost * w);
    if (K.tier === 'big') this.bigUntil = this.t + (o.dur ?? 12);
    this.fired++;
    this.log.push(`${this.t.toFixed(1)}:${kind}`);
    if (this.log.length > 40) this.log.shift();
    this.h.emit?.('scare', { kind, tier: K.tier, pos: o.pos || null });
  }
  // 大場面:演出期間鎖住其他驚嚇
  hold(sec) { this.bigUntil = Math.max(this.bigUntil, this.t + sec); }
  stats() { return { level: this.level, t: +this.t.toFixed(1), dread: +this.dread.toFixed(1), tension: +this.tension.toFixed(2), calm: +this.calm.toFixed(1), big: this.bigActive, fired: this.fired, denied: this.denied, log: this.log.slice(-10) }; }
}
