import * as THREE from 'three';
import { Model, T } from '../kit.js';

// 電話:壁掛電話(老式米色)、桌上電話(九〇年代多鍵話機,放在小邊桌)、護理站(櫃台 + 多線話機 + 呼叫燈板)、大廳公共電話(遮音罩)。
// 狀態:idle → ringing(響鈴,最多約 14 秒)→ 接起 → call(播台詞)→ 掛上;沒在響時拿起來 = 撥號音(或線上只有呼吸聲)。
// 特別的那一支(spec.special = 'callback'):掛掉之後幾秒又響起來,一次比一次近。
// 響鈴時機:靠近(ring:'near')、緊張空檔(ring:'tension',由導演挑一支你附近但看不到的)、旗標(ring:'flag:xxx')、
// 靈異系統正在響的電話(game.horror.ringing)也可以在這裡接起來。
const BEIGE = 0xd8cdb4, DARK = 0x2a2b2c, GRAY = 0x8d9190, STEEL = 0xa9adae;
const RING_KIND = { wall: 'bell', desk: 'trill', nurse: 'trill', pay: 'payphone', anchor: 'bell' };
const POOL = { wall: 'PHONE.ring', desk: 'PHONE.ring', nurse: 'PHONE.nurse', pay: 'PHONE.payphone', anchor: 'PHONE.ring' };

export function phonePools(api) {
  const { kit, M } = api;
  const hs = kit.pool('handset', (m) => {
    m.box(M.plastic, 0xffffff, 0, 0, 0, 0.19, 0.03, 0.045);
    for (const sx of [-1, 1]) { m.cyl(M.plastic, 0xffffff, sx * 0.095, -0.02, 0, 0.062, 0.035, 14); m.cyl(M.matte, 0x777777, sx * 0.095, -0.038, 0, 0.044, 0.004, 12); }
    m.box(M.plastic, 0xe0e0e0, 0, 0.016, 0, 0.12, 0.004, 0.03);
  }, M.plastic);
  const led = kit.pool('led', (m) => { m.box(M.led, 0xffffff, 0, 0, 0, 1, 1, 1); }, M.led);
  return { hs, led };
}
const ZERO = T(0, -50, 0, 0, 0, 0, 0.0001, 0.0001, 0.0001);

// 牆上的電話本體(局部座標)
function wallPhone(m, M, c = BEIGE) {
  m.box(M.plastic, c, 0, 1.44, 0.022, 0.2, 0.32, 0.04);
  m.box(M.plastic, c, 0, 1.43, 0.055, 0.17, 0.27, 0.035);
  m.box(M.matte, 0x6a6458, 0, 1.6, 0.03, 0.14, 0.012, 0.035);
  for (let r = 0; r < 4; r++) for (let k = 0; k < 3; k++) m.box(M.plastic, r === 3 && k !== 1 ? 0x8a8070 : 0xefe8da, -0.035 + k * 0.035, 1.47 - r * 0.03, 0.075, 0.024, 0.018, 0.008);
  m.box(M.matte, 0x111111, 0, 1.34, 0.074, 0.08, 0.02, 0.004);
  m.box(M.plastic, c, -0.1, 1.5, 0.05, 0.03, 0.06, 0.03); // 掛勾
  m.box(M.plastic, c, -0.1, 1.33, 0.05, 0.03, 0.05, 0.03);
  for (let i = 0; i < 9; i++) m.torus(M.plastic, c, -0.1, 1.26 - i * 0.035, 0.07, 0.03, 0.22, Math.PI / 2, 0, 0, 10); // 捲線
}
function deskPhone(m, M, c = 0xd9d4c8) {
  m.box(M.plastic, c, 0, 0.035, 0, 0.21, 0.07, 0.19, -0.12);
  m.box(M.plastic, c, 0, 0.075, -0.04, 0.2, 0.03, 0.08);
  for (let r = 0; r < 4; r++) for (let k = 0; k < 3; k++) m.box(M.plastic, 0xf2efe8, -0.03 + k * 0.03, 0.066 + r * 0.004, 0.06 - r * 0.026, 0.022, 0.01, 0.016, -0.12);
  m.box(M.glow, 0x6a8a5a, 0.065, 0.074, 0.055, 0.05, 0.004, 0.02, -0.12);
  for (let i = 0; i < 6; i++) m.torus(M.plastic, c, -0.12 - i * 0.012, 0.03, 0.02 + i * 0.03, 0.028, 0.22, 0, 0.6, Math.PI / 2, 10);
}
function sideTable(m, M, w = 0.5, d = 0.38, h = 0.72, c = 0x6b5a46) {
  m.slab(M.wood, c, 0, h - 0.03, 0, w, 0.03, d);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) m.slab(M.wood, c, sx * (w / 2 - 0.03), 0, sz * (d / 2 - 0.03), 0.035, h - 0.03, 0.035);
  m.slab(M.wood, 0x5a4a3a, 0, 0.18, 0, w - 0.06, 0.02, d - 0.06);
}
// 護理站櫃台 + 呼叫燈板;回傳台面上可以放東西的位置
function nurseCounter(m, M, w = 1.9) {
  const d = 0.62, h = 1.06;
  m.slab(M.paint, 0xcfd6d2, 0, 0, 0, w, h - 0.04, d);
  m.slab(M.plastic, 0x8b8f88, 0, h - 0.04, 0.02, w + 0.04, 0.04, d + 0.06);
  m.slab(M.paint, 0x5d8a86, 0, 0.12, d / 2 + 0.002, w, 0.5, 0.004); // 前面的色帶
  m.slab(M.matte, 0x3a3d3c, 0, 0, d / 2 - 0.02, w, 0.1, 0.04);
  m.box(M.matte, 0x222322, w / 2 - 0.35, h + 0.18, -0.1, 0.38, 0.3, 0.05); // 熄掉的螢幕
  m.box(M.plastic, 0xc8c4b8, w / 2 - 0.35, h + 0.02, -0.08, 0.06, 0.06, 0.06);
  m.box(M.plastic, 0xd8d4c8, w / 2 - 0.35, h + 0.008, 0.08, 0.42, 0.016, 0.14);
  for (let i = 0; i < 5; i++) m.box(M.matte, [0xe8e0c8, 0xd8e4ec, 0xf0d8d0][i % 3], -w / 2 + 0.25 + i * 0.05, h + 0.015 + i * 0.004, 0.0, 0.22, 0.004, 0.3, 0, 0.1 * i - 0.2); // 散落的病歷紙
  return { h, d, slots: [-w / 2 + 0.3, 0.05, 0.4] };
}
function nurseBoard(m, M, rooms) { // 呼叫燈板:每個房號一格,燈用指示燈池
  const w = 0.9, h = 0.46, y = 1.8;
  m.box(M.paint, 0xd9dcd6, 0, y, 0.02, w, h, 0.04);
  m.box(M.matte, 0x1a1c1c, 0, y + 0.16, 0.042, w - 0.06, 0.08, 0.004);
  const cells = [];
  rooms.forEach((rm, i) => {
    const cx = -w / 2 + 0.09 + (i % 5) * 0.18, cy = y + 0.04 - Math.floor(i / 5) * 0.16;
    m.box(M.matte, 0x2b2d2d, cx, cy, 0.042, 0.15, 0.12, 0.006);
    cells.push({ room: rm, x: cx, y: cy + 0.02, z: 0.047 });
  });
  return cells;
}
function payphone(m, M) {
  // 遮音罩
  m.box(M.paint, 0xd8d0b8, 0, 1.95, 0.24, 0.72, 0.04, 0.5);
  for (const sx of [-1, 1]) m.box(M.paint, 0xd8d0b8, sx * 0.36, 1.45, 0.24, 0.03, 1.0, 0.5);
  m.box(M.paint, 0x2e6b58, 0, 2.02, 0.24, 0.74, 0.1, 0.52);
  m.box(M.matte, 0x1a1a1a, 0, 0.95, 0.24, 0.72, 0.03, 0.46); // 置物台
  // 話機
  m.box(M.metal, 0x5f6b72, 0, 1.4, 0.07, 0.24, 0.5, 0.12);
  m.box(M.metal, 0x7a868c, 0, 1.4, 0.135, 0.2, 0.44, 0.012);
  m.box(M.glow, 0x5f7d55, 0, 1.56, 0.143, 0.12, 0.035, 0.004);
  m.box(M.matte, 0x111111, 0.06, 1.62, 0.143, 0.05, 0.008, 0.006); // 投幣口
  for (let r = 0; r < 4; r++) for (let k = 0; k < 3; k++) m.box(M.metal, STEEL, -0.04 + k * 0.04, 1.47 - r * 0.04, 0.145, 0.03, 0.03, 0.01);
  m.box(M.matte, 0x111111, 0, 1.22, 0.143, 0.1, 0.05, 0.01); // 退幣口
  m.box(M.metal, 0x5f6b72, -0.14, 1.42, 0.1, 0.04, 0.2, 0.06);
  for (let i = 0; i < 8; i++) m.cyl(M.metal, STEEL, -0.16, 1.12 - i * 0.032, 0.12, 0.022, 0.03, 8); // 金屬軟管
}

// 一支電話的狀態機(有模型的電話與道具錨點電話共用)。
// 響鈴提示:鈴聲(定位)+ 線路燈閃 + 聽筒在座上跳動;看著它 2.5m 內 → 「按 [E] 接聽電話」。
// 接起來:劇情指定的來電(spec.calls)用我們的台詞;其他交給靈異系統 game.horror.phone({ id, pos })(它挑這一局沒用過的電話台詞),
// 沒有靈異系統時用 lines.js 的 PHONE 台詞 + 合成電話聲 + 字幕。
function makePhone(api, o) {
  const { ix, ixs, R, game } = api;
  const { key, pos, style, hs, hsI, hsM, led, leds = [], calls = [], pool = [], spec = {} } = o;
  const jig = new THREE.Matrix4();
  const P = {
    key, pos, style, li: o.li, zone: o.zone, state: 'idle', ringT: 0, line: null, special: spec.special || null, cb: 0,
    ring: spec.ring || o.ring || (R() < 0.45 ? 'near' : 'tension'), offT: 0, talk: null, t: 0, used: new Set(), ghost: false, _tick: null,
    nextLine() {
      for (const l of calls) if (!this.used.has(l.id)) { this.used.add(l.id); return l; }
      return null;
    },
    poolLine(list = pool) {
      const free = list.filter((l) => !api.usedLines.has(l.id));
      const l = free.length ? free[(R() * free.length) | 0] : null;
      if (l) api.usedLines.add(l.id);
      return l;
    },
    run() { this._tick ||= ix.tick((dt) => P.update(dt)); },
    // 響:line = 指定台詞;dur = 響多久;ghost = 靈異系統讓它響的(接起來交給 game.horror.phone)
    startRing(line = null, dur = 14, ghost = false) {
      if (this.state !== 'idle') return false;
      this.state = 'ringing'; this.ringT = dur; this.t = 0; this.ghost = ghost;
      this.line = line || (ghost ? null : this.nextLine());
      ixs.ringStart(key, pos, RING_KIND[style] || 'bell');
      ix.emit('ring', P);
      this.run();
      return true;
    },
    stopRing() { ixs.ringStop(key); if (hs) hs.set(hsI, hsM); for (const i of leds) led.color(i, 0x221a10); },
    lift() { if (hs) hs.set(hsI, ZERO); ixs.pickup(null); },
    down() { if (hs) hs.set(hsI, hsM); ixs.hangup(pos); },
    tones() { ixs.dialTone(false); ixs.busyTone(false); ixs.offHook(false); ixs.lineNoise(false); },
    answer() {
      const ghost = this.ghost, ln = this.line;
      this.stopRing();
      this.lift();
      this.state = 'call'; this.offT = 0; this.ghost = false; this.line = null;
      const hz = game.horror;
      let h = null;
      if (!ln && hz?.phone) { try { h = hz.phone({ id: key, pos, ringing: ghost }); } catch { h = null; } }
      const l = h ? null : ln || this.poolLine();
      if (l) { h = api.speak(l, { filter: 'phone' }); ix.flags.set('h.call.' + (l.id || key), true); }
      ixs.lineNoise(true);
      this.talk = h;
      this.callEnd = game.time + (h?.dur || (h ? 5 : 2.5)) + 0.4;
      if (!h) api.say('', '(只有沙沙的雜訊)', 2200, 'phone');
      ix.emit('call', P, l || null);
    },
    pickUp() { // 沒在響:撥號音;偶爾線上已經有人
      this.lift();
      this.state = 'off'; this.offT = 0;
      const idle = api.lineList('PHONE.idle');
      if (idle.length && R() < 0.3) { const l = this.poolLine(idle); if (l) { ixs.lineNoise(true); this.talk = api.speak(l, { filter: 'phone' }); return; } }
      ixs.dialTone(true);
    },
    hangUp(auto = false) {
      this.talk?.stop?.(); this.talk?.kill?.(); this.talk = null;
      this.tones();
      this.down();
      const was = this.state;
      this.state = 'idle';
      if (auto) api.toast('電話線拉不到那麼遠', '#a3a39a');
      if (this.special === 'callback' && was === 'call' && this.cb < 3) { // 回撥:掛掉後幾秒又響,一次比一次近
        const cbl = api.lineList('PHONE.callback');
        const l = cbl[Math.min(this.cb, cbl.length - 1)] || null;
        this.cb++;
        ix.after(3.5 + R() * 3, () => { if (this.state === 'idle') this.startRing(l, 18); });
      }
    },
    update(dt) {
      if (this.state === 'ringing') {
        this.ringT -= dt; this.t += dt;
        const ringOn = this.t % 3 < 1.1; // 響 1 秒、停 2 秒
        const on = ringOn && (this.t % 0.3) < 0.15;
        for (const i of leds) led.color(i, ringOn ? (on ? 0xff6a24 : 0x6a1a08) : 0x221a10);
        if (hs) { // 聽筒在座上跳
          if (ringOn) { jig.copy(hsM).multiply(T(0, 0.004 * Math.abs(Math.sin(this.t * 52)), 0, 0, 0, Math.sin(this.t * 47) * 0.05)); hs.set(hsI, jig); }
          else hs.set(hsI, hsM);
        }
        if (this.ringT <= 0) { // 沒人接
          this.stopRing(); this.state = 'idle'; this.ghost = false;
          if (api.near(pos, 14)) { const ms = api.lineList('PHONE.missed'); const m = ms[(R() * ms.length) | 0]; if (m) api.say('', m.text || '(電話停了。)', 2600); }
          ix.emit('missed', P);
        }
        return true;
      }
      if (this.state === 'off' || this.state === 'call') {
        this.offT += dt;
        const pp = game.player.pos;
        if (Math.hypot(pp.x - pos.x, pp.z - pos.z) > 2.8 || Math.abs(pp.y + 1.2 - pos.y) > 2.5 || game.state !== 'playing') { this.hangUp(game.state === 'playing'); return true; }
        if (this.state === 'call' && game.time > this.callEnd && !this._busy) { this._busy = true; ixs.lineNoise(false); ixs.busyTone(true); }
        if (this.state === 'off' && this.offT > 12 && !this._howl) { this._howl = true; ixs.dialTone(false); ixs.offHook(true); }
        return true;
      }
      this._busy = this._howl = false;
      this._tick = null;
      return false;
    },
    reset() { if (this.state === 'off' || this.state === 'call') { this.talk?.stop?.(); this.tones(); } this.stopRing(); this.state = 'idle'; this.cb = 0; this.used.clear(); this.nearDone = false; this.ghost = false; },
  };
  P.e = ix.register(pos, {
    id: key, kind: 'phone', name: o.name || '電話', reach: 2.5, radius: o.radius || 0.16, priority: 2, scope: 'map',
    prompt: () => (P.state === 'ringing' ? '接聽電話' : P.state === 'idle' ? (style === 'pay' ? '拿起話筒' : '拿起電話') : '掛上電話'),
    onUse: () => {
      if (P.state === 'ringing') P.answer();
      else if (P.state === 'idle') P.pickUp();
      else { P.hangUp(); return; }
      P.run();
    },
    reset: () => P.reset(),
  });
  api.phones.push(P);
  return P;
}

export const phones = {
  build(api, s, spec = {}) {
    const { kit, M, ix } = api;
    const style = spec.style || 'wall';
    const { hs, led } = phonePools(api);
    const m = new Model();
    let hsRest, focus;
    const ledLocal = [], extra = {};
    if (style === 'wall') { wallPhone(m, M); hsRest = T(-0.1, 1.42, 0.075, 0, 0, Math.PI / 2); focus = [0, 1.45, 0.08]; ledLocal.push([0.06, 1.582, 0.074]); }
    else if (style === 'pay') {
      payphone(m, M);
      hsRest = T(-0.14, 1.44, 0.16, 0, 0, Math.PI / 2, 1.1, 1.1, 1.1); focus = [0, 1.45, 0.16];
      ledLocal.push([0.07, 1.68, 0.143]);
      api.signTex?.(s, '公用電話', 0, 2.02, 0.5, 0.5, 0.08);
    } else if (style === 'nurse') {
      const c = nurseCounter(m, M);
      const ph = T(c.slots[0], c.h, 0.12, 0, 0.3);
      const pm = new Model(); deskPhone(pm, M); kit.static(pm, api.mtx(s).multiply(ph), s.li);
      hsRest = T(c.slots[0], c.h + 0.1, 0.08, 0, 0.3);
      focus = [c.slots[0], c.h + 0.08, 0.12];
      for (let i = 0; i < 4; i++) ledLocal.push([c.slots[0] - 0.08 + i * 0.03, c.h + 0.082, 0.17]);
      const rooms = spec.rooms || ['201', '202', '203', '204', '205', '206', '207', '208', '209', '210'];
      extra.cells = nurseBoard(m, M, rooms);
      api.hosts.push({ s, zone: s.zone, slots: c.slots.slice(1).map((x) => ({ x, y: c.h, z: 0.1, used: false })), near: spec.near || null });
      api.box(s, -0.97, 0, 0.97, 0.66, 1.08);
    } else { // desk
      sideTable(m, M);
      const pm = new Model(); deskPhone(pm, M); kit.static(pm, api.mtx(s, 0, 0.72, 0.02, 0.2), s.li);
      hsRest = T(0, 0.72 + 0.1, -0.02, 0, 0.2);
      focus = [0, 0.8, 0.02];
      ledLocal.push([0.06, 0.8, 0.07]);
      api.box(s, -0.26, 0, 0.26, 0.4, 0.75);
    }
    kit.static(m, api.mtx(s), s.li);
    const world = api.mtx(s);
    const hsM = world.clone().multiply(hsRest);
    const hsI = hs.add(s.li, hsM);
    const leds = ledLocal.map((p) => led.add(s.li, world.clone().multiply(T(p[0], p[1], p[2], 0, 0, 0, 0.014, 0.01, 0.006)), 0x221a10));
    if (extra.cells) { // 呼叫燈板(護理站)
      const board = { cells: extra.cells.map((c) => ({ ...c, i: led.add(s.li, world.clone().multiply(T(c.x, c.y, c.z, 0, 0, 0, 0.12, 0.05, 0.004)), 0x1a0806), on: false })) };
      board.light = (room, on = true) => { for (const c of board.cells) if (c.room === String(room)) { c.on = on; led.color(c.i, on ? 0xff3a26 : 0x1a0806); } };
      board.all = (on) => { for (const c of board.cells) board.light(c.room, on); };
      api.nurseBoard = ix.nurseBoard = board;
    }
    const pos = api.wp(s, ...focus);
    const key = spec.id || `ph${s.li}_${Math.round(pos.x * 10)}_${Math.round(pos.z * 10)}`;
    const name = { wall: '電話', desk: '電話', nurse: '護理站電話', pay: '公共電話' }[style];
    return makePhone(api, {
      key, pos, style, li: s.li, zone: s.zone, hs, hsI, hsM, led, leds, spec, name,
      calls: (spec.calls || []).map((id) => api.lineById(id)).filter(Boolean), pool: api.lineList(POOL[style] || 'PHONE.ring'),
    });
  },
};

// 現有道具上的電話錨點(game.hospital.propEvents kind 'phone'):模型是合併過的道具,另外加一顆會閃的線路燈
export function anchorPhone(api, ev) {
  const { game } = api;
  const { led } = phonePools(api);
  const li = Math.max(0, game.world.layout.levelOfY(ev.y - 0.5));
  const pos = { x: ev.x, y: ev.y + 0.05, z: ev.z };
  const leds = [led.add(li, T(ev.x, ev.y + 0.07, ev.z, 0, 0, 0, 0.016, 0.012, 0.016), 0x221a10)];
  return makePhone(api, { key: `pa${Math.round(ev.x * 10)}_${Math.round(ev.z * 10)}`, pos, style: 'anchor', li, zone: ev.zone, led, leds, ring: 'tension', radius: 0.2, pool: api.lineList('PHONE.ring') });
}

// 電話導演:緊張空檔讓附近一支電話響(看不到的那一支最好)、靠近就響的電話、旗標觸發;
// 靈異系統讓電話響(game.horror 'phone:ring')→ 那一支真的電話開始響、能接;收音機自己打開('radio:on')→ 可以關掉
export function phoneDirector(api) {
  const { ix, game, R, ixs, sfx } = api;
  let next = 50 + R() * 40, t = 0, bound = null;
  const near = (pos, r = 1.6) => { let best = null, bd = r; for (const P of api.phones) { const d = Math.hypot(P.pos.x - pos.x, P.pos.z - pos.z) + Math.abs(P.pos.y - (pos.y ?? P.pos.y)) * 0.5; if (d < bd) { bd = d; best = P; } } return best; };
  const bind = (H) => {
    bound = H;
    H.on?.('phone:ring', (d) => { const P = d?.pos && near(d.pos); if (P && P.state === 'idle') P.startRing(null, Math.max(4, (d.until ?? game.time + 9) - game.time + 3), true); });
    H.on?.('radio:on', (d) => { // 靈異系統把收音機/電視打開了:那裡出現「關掉」的互動(13 秒後它自己會停)
      if (!d?.pos) return;
      const tv = d.kind === 'tv' || d.kind === 'cctv';
      const e = ix.register(d.pos, {
        id: `ghost-radio:${Math.round(d.pos.x)}_${Math.round(d.pos.z)}:${(game.time * 10) | 0}`, kind: 'radio', name: tv ? '電視' : '收音機', reach: 2.4, radius: 0.3, scope: 'run',
        prompt: tv ? '關掉電視' : '關掉收音機',
        onUse: () => { sfx.loopStop('gh-radio'); if (tv) ixs.tvOff(d.pos); else ixs.switchClick(d.pos, false); e.remove(); ix.emit('radio:off', d); },
      });
      ix.after(13, () => e.remove());
    });
  };
  ix.on('flag', (k) => { for (const P of api.phones) if (P.ring === 'flag:' + k) P.startRing(); });
  ix.on('reset', () => { next = 50 + R() * 40; api.lastRing = -1e9; });
  ix.on('ring', () => { api.lastRing = game.time; });
  const dir = {
    ring: (id) => { const P = id ? api.phones.find((q) => q.key === id || q.e?.id === id) : api.phones.find((q) => q.state === 'idle'); return P ? P.startRing() : false; },
    // 讓 pos 附近(2m 內)的那支電話響;沒有就回傳 false(呼叫端不要只放鈴聲)
    ringAt: (pos, dur = 12) => { const P = near(pos, 2.2); return P && P.state === 'idle' ? P.startRing(null, dur) : false; },
    // 讓同一層、離玩家 a~b 公尺的一支電話響(優先看不到的)
    ringFar: (a = 10, b = 24, gap = 0) => {
      if (game.time - (api.lastRing ?? -1e9) < gap) return false;
      const p = game.player.pos, li = game.world.layout.levelOfY(p.y + 0.3);
      const cand = api.phones.filter((P) => P.state === 'idle' && P.ring !== 'never' && P.li === li && (() => { const d = Math.hypot(P.pos.x - p.x, P.pos.z - p.z); return d > a && d < b; })());
      if (!cand.length) return false;
      const hidden = cand.filter((P) => !game.world.hasLineOfSight(p.x, p.y + 1.6, p.z, P.pos.x, P.pos.y, P.pos.z));
      const list = hidden.length ? hidden : cand;
      return list[(R() * list.length) | 0].startRing();
    },
  };
  ix.tick((dt) => {
    if (game.horror && game.horror !== bound) bind(game.horror);
    if ((t += dt) < 1) return true;
    t = 0;
    if (game.state !== 'playing') return true;
    const p = game.player.pos, li = game.world.layout.levelOfY(p.y + 0.3), now = game.time;
    const calm = api.calm(10) || game.phase === 'shop';
    for (const P of api.phones) { // 靠近就響(每局一次)
      if (P.ring !== 'near' || P.nearDone || P.state !== 'idle' || P.li !== li) continue;
      const d = Math.hypot(P.pos.x - p.x, P.pos.z - p.z);
      if (d < 8 && d > 2.5 && calm) { P.nearDone = true; if (R() < 0.7) P.startRing(); }
    }
    if (now < next || !calm || api.phones.some((P) => P.state === 'ringing')) return true;
    next = now + (dir.ringFar(6, 24) ? 75 + R() * 70 : 15);
    return true;
  });
  return dir;
}
