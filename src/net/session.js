import * as THREE from 'three';
import { sfx } from '../audio.js';
import { F, BIN, NONE, Writer, Reader, makeState, writeState, readState, WEAPON_IDS, PARTS, code, name } from './protocol.js';
import { Interp } from './interp.js';
import { Avatar } from './avatar.js';
import { ZombieSync } from './zsync.js';
import { CoopMode } from './coop.js';
import { PvpMode } from './pvp.js';
import { NetHud } from './hud.js';

// 多人連線的一場比賽(game.net)。
// 原則:每一端只模擬自己的玩家;房主另外模擬回合、出怪、殭屍 AI 並廣播快照;
// 打殭屍 → 命中送給房主結算;打玩家 → 命中送給被打的人(由被打的人套用防彈衣並回報死亡)。
// 與 game.js 的整合:Game.update 開頭呼叫 net.update(dt)、本機玩家更新後呼叫 net.afterPlayer(dt);
// 其餘以「實例層級的方法包裝」掛上(hook),離開連線時全部還原,單人模式行為不變。
const INTERP_DELAY = 100; // 遠端玩家插值延遲(ms)
const SEND_MS = 50, SEND_FAST_MS = 25;
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3();
const r2 = (x) => Math.round(x * 100) / 100;

// 遠端玩家:放進 game.players,讓殭屍可以追/打(§3.6 介面:pos/alive/downed/id/knock/addShake/hurt)
export class RemotePlayer {
  constructor(s, info) {
    this.s = s;
    this.id = info.id;
    this.name = info.name || `玩家${info.id + 1}`;
    this.remote = true;
    this.connected = info.conn !== false;
    this.rtt = info.rtt || 0;
    this.pos = new THREE.Vector3(s.game.world.start.x, s.game.world.start.y || 0, s.game.world.start.z);
    this.vx = 0; this.vz = 0; this.yaw = 0; this.pitch = 0;
    this.alive = false; this.up = true; this.downed = false; this.hp = 100; this.maxHp = 100; this.armor = 0;
    this.flags = 0; this.weapon = 'pistol'; this.rt = NONE; this.rp = 0;
    this.buf = new Interp(10, 40, [3], [7, 8, 9]); // x y z yaw pitch vx vz flags weapon hp
    this.sv = new Float32Array(10);
    this.st = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, vx: 0, vz: 0, flags: 0, hp: 100 };
    this.has = false;
    this.lastMsg = 0;
    this.avatar = null;
    this.stats = { kills: 0, deaths: 0, downs: 0, revives: 0, coins: 0 };
    this._shakeT = 0;
    // 對戰模式射線用的「目標」:命中盒的 userData.zombie 指向它(combat.fire 以同一套流程處理)
    this.target = { remote: this, type: 'player', alive: true, pos: this.pos, T: { coins: 0, radius: 0.35, mass: 1 }, root: null, meshes: [], hitboxes: [], damage: (a, part) => s.pvpHit(this, a, part) };
  }
  hurt(amount, t, src) { return this.s.damageRemote(this, amount, src); }
  knock(dx, dz) { if (this.s.isHost) this.s.send('kn', [r2(dx), r2(dz)], this.id); }
  addShake(a) {
    if (!this.s.isHost || a < 0.08) return;
    const t = performance.now();
    if (t - this._shakeT < 200) return;
    this._shakeT = t;
    this.s.send('sh', r2(a), this.id);
  }
}

export class NetSession {
  constructor(game, client, lobby, start) {
    this.game = game;
    this.client = client;
    this.lobby = lobby;
    this.room = start.room;
    this.me = start.you;
    this.hostSlot = start.room.host;
    this.match = start.match;
    this.seed = start.seed || 1;
    this.late = !!start.late;
    this.settings = start.room.settings || {};
    this.remotes = new Map();
    this.hooks = [];
    this.handlers = new Map();
    this.unsub = [];
    this.active = false;
    this.renderTime = 0;
    this.w = new Writer(4096);
    this.r = new Reader();
    this.out = makeState();
    this.inp = makeState();
    this.sendT = 0;
    this.lastSend = 0;
    this.seq = 0;
    this._inFire = false;
    this._shotBlood = false;
    this.zs = new ZombieSync(this);
    this.mode = start.room.mode === 'pvp' ? new PvpMode(this) : new CoopMode(this);
    this.hud = new NetHud(this);
  }

  get isHost() { return this.hostSlot === this.me; }
  get pvp() { return !!this.mode.pvp; }
  myName() { return this.client.name; }
  nameOf(slot) { return slot === this.me ? this.myName() : this.remotes.get(slot)?.name ?? '?'; }

  // ---------- game.net 介面 ----------
  send(type, data, to) { return this.client.game(type, data, to); }
  on(type, fn) {
    let l = this.handlers.get(type);
    if (!l) this.handlers.set(type, (l = []));
    l.push(fn);
  }
  // 對遠端玩家造成傷害:殭屍(房主模擬)→ 送給該玩家;本機玩家造成的爆炸 → 合作不誤傷、對戰算 PvP 傷害
  damageRemote(p, amount, src) {
    if (!p || !p.remote || !(amount > 0) || !this.active) return 0;
    const g = this.game;
    const fromZombie = !!src && (src.zombie || g.zombies.some((z) => z.pos === src || z.vp === src));
    if (fromZombie) {
      if (!this.isHost || !p.alive || p.downed || !p.connected) return 0;
      this.send('hurt', [r2(amount), src ? r2(src.x) : null, src ? r2(src.z) : null], p.id);
      return amount;
    }
    if (this.pvp && p.alive) { this.queuePvp(p.id, 0, amount, code(WEAPON_IDS, g.weapons.current)); return amount; }
    return 0;
  }

  // ---------- 生命週期 ----------
  start() {
    const g = this.game;
    this.active = true;
    g.net = this;
    g.player.id = this.me;
    g.player.name = this.myName();
    for (const p of this.room.players) if (p.id !== this.me) this.addRemote(p);
    this.install();
    this.mode.install?.();
    this.listen();
    this.hud.mount();
    g.resetRun();
    g.state = 'playing';
    g.paused = false;
    g.ui.showHud(true);
    for (const id of ['menu', 'dead', 'shop']) g.ui.overlay(id, false);
    this.mode.begin();
    this.zs.begin();
    this.startTicker();
  }

  // 背景分頁時瀏覽器會停掉 requestAnimationFrame:用 Worker 計時器(背景不太會被節流)在畫面停住時繼續跑模擬(不渲染),
  // 讓房主的殭屍/回合、本機狀態送出都不中斷
  startTicker() {
    try {
      const src = 'let t=null;onmessage=(e)=>{clearInterval(t);t=e.data>0?setInterval(()=>postMessage(0),e.data):null;};';
      this.tickUrl = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
      this.ticker = new Worker(this.tickUrl);
      this.ticker.onmessage = () => {
        const now = performance.now();
        if (!this.active || now - this.lastUpdate < 150) return;
        const dt = Math.min(0.05, (now - this.lastUpdate) / 1000);
        try { this.game.update(dt); } catch (e) { console.error('[net] 背景更新', e); }
      };
      this.ticker.postMessage(50);
    } catch { this.ticker = null; }
  }
  stopTicker() {
    if (this.ticker) { this.ticker.postMessage(0); this.ticker.terminate(); this.ticker = null; }
    if (this.tickUrl) { URL.revokeObjectURL(this.tickUrl); this.tickUrl = null; }
  }

  stop() {
    if (!this.active) return;
    this.active = false;
    const g = this.game;
    for (const off of this.unsub) off();
    this.unsub.length = 0;
    this.client.onBinary = null;
    this.mode.stop?.();
    this.stopTicker();
    this.uninstall();
    for (const rp of this.remotes.values()) this.dropRemote(rp);
    this.remotes.clear();
    g.players.length = 0;
    g.players.push(g.player);
    g.player.id = 'local';
    g.player.downed = false;
    g.player.alive = true;
    g.weaponScene.visible = true;
    if (g.shopUIOpen) g.closeShop(false);
    g.net = null;
    this.zs.stop();
    this.hud.unmount();
    g.resetRun();
    g.state = 'menu';
    g.paused = false;
    g.phase = 'fighting';
    g.setMood?.('menu');
    g.ui.showHud(false);
  }

  // ---------- 方法包裝 ----------
  hook(obj, key, make) {
    if (!obj || typeof obj[key] !== 'function') return;
    const had = Object.prototype.hasOwnProperty.call(obj, key);
    const orig = obj[key];
    this.hooks.push([obj, key, orig, had]);
    obj[key] = make(orig);
  }
  uninstall() {
    for (let i = this.hooks.length - 1; i >= 0; i--) {
      const [obj, key, orig, had] = this.hooks[i];
      if (had) obj[key] = orig; else delete obj[key];
    }
    this.hooks.length = 0;
  }
  install() {
    const g = this.game, s = this;
    // 記錄本機開火(彈著點、是否打中肉體)放進下一則狀態;對戰時把敵人的命中盒加入射線
    this.hook(g, 'fire', (orig) => function (...a) {
      s._inFire = true;
      s._shotBlood = false;
      try { return orig.apply(this, a); } finally { s._inFire = false; }
    });
    this.hook(g, 'burst', (orig) => function (pos, normal, kind, n, floorY) {
      if (s._inFire && (kind === 'blood' || kind === 'bile')) s._shotBlood = true;
      return orig.call(this, pos, normal, kind, n, floorY);
    });
    this.origTracer = g.tracer;
    this.hook(g, 'tracer', (orig) => function (a, b) {
      orig.call(this, a, b);
      if (s._inFire) s.recordShot(b, s._shotBlood);
    });
    this.hook(g.ray, 'intersectObjects', (orig) => function (objs, rec, out) {
      if (s._inFire && s.pvp) {
        const extra = s.pvpMeshes();
        if (extra.length) objs = objs.concat(extra);
      }
      return orig.call(this, objs, rec, out);
    });
    // 擊殺:代理殭屍 / 遠端玩家的擊殺 / 金幣歸屬
    this.origOnKill = g.onKill;
    this.hook(g, 'onKill', (orig) => function (z, killer) { return s.zs.onKill(z, killer, orig); });
    // 代理殭屍(膿腫者)爆開只做視覺,傷害由房主結算
    this.hook(g, 'explode', (orig) => function (z) { return z && z._proxy ? s.zs.visualExplode(z) : orig.call(this, z); });
    // 本機玩家死亡 → 合作:倒地;對戰:陣亡等待重生
    this.hook(g, 'die', (orig) => function () { return s.mode.onLocalDeath(orig); });
    // 只有房主出怪
    this.hook(g, 'spawnZombie', (orig) => function (...a) { return s.isHost ? orig.apply(this, a) : null; });
    this.hook(g, 'zombiesLeft', (orig) => function () { return s.isHost ? orig.call(this) : s.zs.hostLeft(); });
    // 房主的酸液彈廣播給其他人(各端各自模擬是否打中自己)
    this.origSpit = g.hazards.spit;
    this.hook(g.hazards, 'spit', (orig) => function (from, to) {
      orig.call(this, from, to);
      if (s.isHost) s.send('hz', ['s', r2(from.x), r2(from.y), r2(from.z), r2(to.x), r2(to.y), r2(to.z)]);
    });
    // 互動提示:多人時 N 是「準備」
    this.hook(g.ui, 'prompt', (orig) => function (text) {
      if (text && typeof text === 'string') text = text.replace('按 N 立即開始', '按 N 準備').replace('按 N 開始下一回合', '按 N 準備下一回合');
      return orig.call(this, text);
    });
  }

  // ---------- 網路事件 ----------
  listen() {
    const c = this.client, g = this.game;
    const on = (t, fn) => this.unsub.push(c.on(t, fn));
    c.onBinary = (ab) => this.onBinary(ab);
    on('g', (m) => {
      const l = this.handlers.get(m.k);
      if (l) for (const fn of l) { try { fn(m.d, m.f); } catch (e) { console.error('[net]', m.k, e); } }
    });
    on('peer', (m) => this.onPeer(m.p, m));
    on('left', (m) => this.onLeft(m.id, m.why));
    on('host', (m) => this.setHost(m.id));
    on('pings', (m) => { for (const [id, rtt] of m.r) { const rp = this.remotes.get(id); if (rp) rp.rtt = rtt; else if (id === this.me) this.myRtt = rtt; } });
    on('chat', (m) => this.hud.chatLine(m.name, m.text, m.id === this.me));
    on('reconnecting', () => this.hud.status('連線中斷,重新連線中…', true));
    on('reconnected', () => {
      this.hud.status('已重新連線', false, 2000);
      // 伺服器若沒有接回座位(超過保留時間),就結束這場
      const t = setTimeout(() => { if (this.active) this.lobby.matchLost('重新連線失敗:座位已釋出'); }, 2500);
      const off = c.on('joined', (m) => { if (m.resumed) { clearTimeout(t); off(); this.onResumed(m); } });
    });
    on('lost', () => this.lobby.matchLost('與伺服器的連線中斷'));

    // 遊戲事件
    this.on('hurt', (d, f) => { // 殭屍攻擊(房主結算)
      if (f !== this.hostSlot) return;
      const src = d[1] !== null ? { x: d[1], z: d[2] } : null;
      g.damagePlayer(g.player, d[0], src);
    });
    this.on('kn', (d, f) => { if (f === this.hostSlot && Number.isFinite(d[0]) && Number.isFinite(d[1])) g.player.knock(d[0], d[1]); });
    this.on('sh', (d, f) => { if (f === this.hostSlot && Number.isFinite(d)) g.player.addShake(Math.min(1, d)); });
    this.on('hz', (d, f) => {
      if (f !== this.hostSlot || this.isHost) return;
      if (d[0] === 's') this.origSpit.call(g.hazards, new THREE.Vector3(d[1], d[2], d[3]), new THREE.Vector3(d[4], d[5], d[6]));
    });
    this.zs.listen();
    this.mode.listen();
  }

  onResumed(m) {
    // 重連後同步房間成員(可能有人在斷線期間離開/加入)與房主
    this.setHost(m.room.host);
    const ids = new Set(m.room.players.map((p) => p.id));
    for (const rp of [...this.remotes.values()]) if (!ids.has(rp.id)) this.onLeft(rp.id, 'leave');
    for (const p of m.room.players) if (p.id !== this.me) this.onPeer(p, {});
  }

  onPeer(p, m) {
    if (p.id === this.me) return;
    let rp = this.remotes.get(p.id);
    if (!rp) {
      rp = this.addRemote(p);
      this.hud.feed(`${rp.name} 加入了遊戲`, 'join');
      sfx.playerJoin?.();
      if (this.isHost) this.mode.onJoin?.(rp);
      return;
    }
    const was = rp.connected;
    rp.name = p.name;
    rp.connected = p.conn !== false;
    if (rp.avatar) rp.avatar.name = rp.name;
    if (was && !rp.connected) { rp.alive = false; this.hud.feed(`${rp.name} 連線中斷…`, 'warn'); }
    if (!was && rp.connected) { this.hud.feed(`${rp.name} 重新連線`, 'join'); if (this.isHost) this.mode.onJoin?.(rp, true); }
  }

  onLeft(id, why) {
    const rp = this.remotes.get(id);
    if (!rp) return;
    this.hud.feed(`${rp.name} ${why === 'kick' ? '被移出房間' : why === 'timeout' ? '連線逾時' : '離開了遊戲'}`, 'leave');
    sfx.playerLeave?.();
    this.dropRemote(rp);
    this.remotes.delete(id);
    this.mode.onLeave?.(rp);
  }

  setHost(id) {
    if (id === this.hostSlot) return;
    const wasHost = this.isHost;
    this.hostSlot = id;
    this.room.host = id;
    if (this.isHost && !wasHost) {
      this.hud.feed('你成為新的房主(接手模擬殭屍與回合)', 'host');
      this.zs.becomeHost();
      this.mode.becomeHost?.();
    } else if (!this.isHost && wasHost) {
      this.zs.becomeClient();
      this.mode.becomeClient?.();
    }
    if (!this.isHost) this.hud.feed(`${this.nameOf(id)} 成為房主`, 'host');
  }

  addRemote(info) {
    const rp = new RemotePlayer(this, info);
    this.remotes.set(rp.id, rp);
    this.game.players.push(rp);
    return rp;
  }
  dropRemote(rp) {
    const g = this.game, i = g.players.indexOf(rp);
    if (i >= 0) g.players.splice(i, 1);
    for (const z of g.zombies) if (z.target === rp) z.target = null;
    if (rp.avatar) { rp.avatar.dispose(); rp.avatar = null; }
    rp.alive = false;
    rp.target.alive = false;
  }
  ensureAvatar(rp) {
    if (rp.avatar) return rp.avatar;
    const a = new Avatar(this.game.scene, { look: rp.id, name: rp.name, team: !this.pvp });
    a.onStep = (pos, sprint) => sfx.remoteStep?.(pos, this.game.world.surfaceAt ? this.game.world.surfaceAt(pos.x, pos.y, pos.z) : 'tile', sprint);
    rp.avatar = a;
    rp.target.root = a.root;
    rp.target.meshes = a.hits;
    rp.target.hitboxes = a.hits;
    for (const h of a.hits) h.userData.zombie = rp.target;
    return a;
  }

  // ---------- 二進位訊息 ----------
  onBinary(ab) {
    if (!this.active || ab.byteLength < 4) return;
    const r = this.r.set(ab);
    const kind = r.dv.getUint8(0);
    if (kind === BIN.STATE) { if (readState(r, this.inp)) this.onState(this.inp); }
    else if (kind === BIN.ZSNAP) this.zs.onSnapshot(r);
  }

  onState(s) {
    const rp = this.remotes.get(s.slot);
    if (!rp) return;
    rp.lastMsg = performance.now();
    const buf = rp.buf;
    // 瞬移(重生、傳送)或剛復活:清掉插值歷史,避免滑過去
    if (rp.has && (Math.hypot(s.x - rp.pos.x, s.z - rp.pos.z) > 4 || Math.abs(s.y - rp.pos.y) > 2.5 || ((s.flags & F.ALIVE) && !(rp.flags & F.ALIVE)))) buf.clear();
    const base = buf.pushAfterGap(s.time, 260);
    if (base >= 0) {
      const v = buf.v;
      v[base] = s.x; v[base + 1] = s.y; v[base + 2] = s.z; v[base + 3] = s.yaw; v[base + 4] = s.pitch;
      v[base + 5] = s.vx; v[base + 6] = s.vz; v[base + 7] = s.flags; v[base + 8] = s.weapon; v[base + 9] = s.hp;
    }
    rp.has = true;
    rp.pos.set(s.x, s.y, s.z);
    rp.vx = s.vx; rp.vz = s.vz; rp.yaw = s.yaw; rp.pitch = s.pitch;
    rp.flags = s.flags;
    rp.up = !!(s.flags & F.ALIVE) && !(s.flags & F.DEAD); // 依對方自己回報的狀態:活著(含倒地)
    rp.alive = rp.up && rp.connected;
    rp.downed = !!(s.flags & F.DOWNED);
    rp.hp = s.hp; rp.armor = s.armor;
    rp.weapon = name(WEAPON_IDS, s.weapon, 'pistol');
    rp.rt = s.rt; rp.rp = s.rp;
    rp.target.alive = rp.alive && !(s.flags & F.SHIELD);
    // 開火:曳光、槍口火光、彈著
    for (let i = 0; i < s.nShots; i++) { const k = i * 4; this.remoteShot(rp, s.shots[k], s.shots[k + 1], s.shots[k + 2], s.shots[k + 3]); }
    // 打殭屍:房主結算;其他人只做受擊反應
    for (let i = 0; i < s.nZ; i++) { const k = i * 3; this.zs.onRemoteHit(rp, s.zh[k], name(PARTS, s.zh[k + 1], 'body'), s.zh[k + 2]); }
    // 打玩家:打到我才處理
    for (let i = 0; i < s.nP; i++) {
      const k = i * 4;
      if (s.ph[k] === this.me) this.mode.onPvpHit?.(rp, name(PARTS, s.ph[k + 1], 'body'), s.ph[k + 2], s.ph[k + 3]);
      else { const t = this.remotes.get(s.ph[k]); if (t?.avatar && t.alive) this.game.burst(_v.set(t.pos.x, t.pos.y + 1.2, t.pos.z), _v2.set(0, 1, 0), 'blood', 5, t.pos.y); }
    }
  }

  remoteShot(rp, ex, ey, ez, flesh) {
    const a = rp.avatar, g = this.game;
    if (!a || !a.visible) return;
    a.fire();
    const from = a.muzzleWorld(new THREE.Vector3());
    const to = new THREE.Vector3(ex, ey, ez);
    this.origTracer.call(g, from, to);
    const n = _v2.subVectors(from, to).normalize();
    if (flesh) g.burst(to, n, 'blood', 5);
    else { g.burst(to, n, 'spark', 3); g.burst(to, n, 'dust', 3); }
    // 槍口火光照亮環境(本機沒在開火時才借用 muzzleLight,不新增光源)
    if (g.muzzleLight.intensity < 4 && from.distanceTo(g.camera.position) < 30) { g.muzzleLight.position.copy(from); g.muzzleLight.intensity = 22; }
    sfx.remoteShot?.(rp.weapon, from);
  }

  // ---------- 本機輸出 ----------
  recordShot(end, blood) {
    const s = this.out;
    if (s.nShots >= 24) return;
    const k = s.nShots++ * 4;
    s.shots[k] = end.x; s.shots[k + 1] = end.y; s.shots[k + 2] = end.z; s.shots[k + 3] = blood ? 1 : 0;
  }
  queueZHit(id, part, dmg) {
    const s = this.out;
    if (s.nZ >= 32) return;
    const k = s.nZ++ * 3;
    s.zh[k] = id; s.zh[k + 1] = code(PARTS, part); s.zh[k + 2] = dmg;
  }
  queuePvp(slot, part, dmg, wpn) {
    const s = this.out;
    if (s.nP >= 32) return;
    const k = s.nP++ * 4;
    s.ph[k] = slot; s.ph[k + 1] = typeof part === 'number' ? part : code(PARTS, part); s.ph[k + 2] = dmg; s.ph[k + 3] = wpn;
  }
  // 射擊端判定命中遠端玩家(對戰)
  pvpHit(rp, amount, part) {
    if (!this.pvp || !rp.alive || (rp.flags & F.SHIELD)) return false;
    this.queuePvp(rp.id, part, amount, code(WEAPON_IDS, this.game.weapons.current));
    return false; // 擊殺由被打的人回報
  }
  pvpMeshes() {
    const out = this._pm || (this._pm = []);
    out.length = 0;
    for (const rp of this.remotes.values()) {
      if (!rp.avatar || !rp.alive || !rp.avatar.visible || (rp.flags & F.SHIELD)) continue;
      rp.avatar.root.updateMatrixWorld(true);
      for (const h of rp.avatar.hits) out.push(h);
    }
    return out;
  }

  sendState(force = false) {
    const g = this.game, p = g.player, s = this.out, w = g.weapons;
    const t = performance.now();
    const pending = s.nShots || s.nZ || s.nP;
    if (!force && t - this.lastSend < (pending ? SEND_FAST_MS : SEND_MS)) return;
    if (!this.client.open) return;
    this.lastSend = t;
    s.seq = (this.seq = (this.seq + 1) & 0xffff);
    s.time = Math.round(this.client.serverNow()) >>> 0;
    s.x = p.pos.x; s.y = p.pos.y; s.z = p.pos.z; s.yaw = p.yaw; s.pitch = p.pitch; s.vx = p.vx || 0; s.vz = p.vz || 0;
    const m = this.mode;
    s.flags = (p.alive !== false && !m.dead ? F.ALIVE : 0) | (p.downed ? F.DOWNED : 0) | (p.sprinting ? F.SPRINT : 0) | (w.reloading > 0 ? F.RELOAD : 0)
      | ((w.ads || 0) > 0.5 ? F.ADS : 0) | (p.flashOn ? F.LIGHT : 0) | (m.dead ? F.DEAD : 0) | (m.shieldT > 0 ? F.SHIELD : 0)
      | (m.reviving ? F.REVIVE : 0) | (g.paused ? F.MENU : 0) | (this.hud.chatOpen ? F.CHAT : 0) | (g.shopUIOpen ? F.SHOP : 0) | (m.spectating ? F.SPECTATE : 0);
    s.weapon = code(WEAPON_IDS, w.current);
    s.hp = p.hp; s.armor = p.armor || 0;
    s.rt = m.reviveSlot ?? NONE; s.rp = m.reviveP || 0;
    this.client.sendBin(writeState(this.w, s));
    s.nShots = s.nZ = s.nP = 0;
  }

  // ---------- 每幀 ----------
  update(dt) {
    if (!this.active) return;
    const now = performance.now();
    this.lastUpdate = now;
    this.renderTime = this.client.serverNow() - INTERP_DELAY;
    for (const rp of this.remotes.values()) {
      // 斷線或很久沒有狀態:殭屍先不追(但不算陣亡,全員倒地的判定看 rp.up)
      if (rp.has && now - rp.lastMsg > 3000) rp.alive = false;
    }
    this.zs.update(dt);
    this.mode.update(dt);
    this.hud.update(dt);
    if (this.game.state !== 'playing') this.animateRemotes(dt);
  }

  afterPlayer(dt) {
    if (!this.active) return;
    // 防呆:任何非有限值(NaN)都還原成上一個正常狀態,避免一路擴散到鏡頭/音效/網路
    const p = this.game.player;
    if (!Number.isFinite(p.pos.x + p.pos.y + p.pos.z + p.yaw + p.pitch + (p.vx || 0) + (p.vz || 0) + (p.shake || 0))) {
      const g0 = this._good;
      if (g0) { p.pos.set(g0[0], g0[1], g0[2]); p.yaw = g0[3]; p.pitch = g0[4]; } else { const st = this.game.world.start; p.pos.set(st.x, st.y || 0, st.z); p.yaw = 0; p.pitch = 0; }
      p.vx = p.vz = 0; p.shake = 0;
      this.game.camera.position.set(p.pos.x, p.pos.y + 1.65, p.pos.z);
    } else (this._good || (this._good = [0, 0, 0, 0, 0])).splice(0, 5, p.pos.x, p.pos.y, p.pos.z, p.yaw, p.pitch);
    this.mode.afterPlayer(dt);
    this.animateRemotes(dt);
    this.sendState();
  }

  animateRemotes(dt) {
    const cam = this.game.camera;
    for (const rp of this.remotes.values()) {
      if (!rp.has) { if (rp.avatar) rp.avatar.setVisible(false); continue; }
      const a = this.ensureAvatar(rp);
      const v = rp.sv;
      const r = rp.buf.sample(this.renderTime, v);
      if (r < 0) continue;
      const st = rp.st;
      // 封包晚到:用速度外插最多 120ms
      const ex = r === 1 ? Math.min(rp.buf.over, 0.12) : 0;
      st.x = v[0] + v[5] * ex; st.y = v[1]; st.z = v[2] + v[6] * ex;
      st.yaw = v[3]; st.pitch = v[4]; st.vx = v[5]; st.vz = v[6]; st.flags = v[7]; st.hp = v[9];
      if (!rp.connected) st.flags &= ~F.LIGHT;
      a.setVisible(rp.connected || (rp.flags & F.ALIVE));
      a.setWeapon(name(WEAPON_IDS, v[8], 'pistol'));
      a.drawPlate(rp.hp, rp.maxHp, rp.downed, this.mode.plateExtra?.(rp) || (rp.connected ? '' : '斷線中'));
      a.update(dt, st, cam);
    }
  }
}
