// 靈異系統入口:game.horror —— 驚嚇導演、耳邊低語、幻影、靈異事件、寒氣、牆上的字。
// 全部是本機效果:多人時每位玩家各自一套導演與亂數,所以隊友聽到/看到的不一樣(刻意的:「你剛剛有聽到嗎?」)。
// 不送任何網路訊息、不影響殭屍或傷害;對戰模式只留背景(耳語、聲音)。設定「驚嚇強度」關閉時,只有玩家自己觸發的(接電話)會出聲。
//
// 公開介面(給 interact / story / ambush 代理):
//   game.horror.whisper(lineId | text, { ear, subtitle, filter, priority, pos, mode }) → handle | null
//   game.horror.phone({ pos, id, ringing }) → handle     接起電話(電話聽筒濾波,右耳)
//   game.horror.radio({ pos, id }) → handle              收音機開了(收音機濾波,在收音機的位置)
//   game.horror.event(kind, { force }) → bool            立刻觸發一個靈異事件(見 director.KINDS);force 略過導演節奏
//   game.horror.apparition(kind, opts) → bool            figure | window | child | nurse | behind | curtain | mirror | counter
//   game.horror.flicker(pos, dur) / chill(k, dur) / silence(dur)
//   game.horror.on(ev, fn) → off                         'whisper' 'phone:ring' 'phone:answer' 'radio:on' 'scare' 'apparition:vanish'
//   game.horror.director.request(kind, { weight, pos }) / notify(kind)   (見 director.js)
//   game.horror.ringing → { pos, anchor, until } | null  正在響的電話(interact 可以讓玩家接起來)
//   game.horror.stats()
import * as THREE from 'three';
import { Director, KINDS as DK } from './director.js';
import { settings } from '../ui/settings.js';
import { ghost } from '../audio.js';
import { Whispers } from './whisper.js';
import { GhostSubs } from './subs.js';
import { Apparitions, models } from './ghosts.js';
import { Marks } from './marks.js';
import { ColdFx } from './fx.js';
import { paranormalKinds } from './paranormal.js';
import { LINES, CAPTIONS } from './lines.js';
import { precompile as warmCompile, initPrograms } from '../sys/warmup.js';

// 導演挑事件用的清單:[種類, 權重];區域偏好另外乘
const CATALOG = {
  small: [['ambient', 1], ['flicker', 0.35], ['crawl', 0.6], ['silence', 0.45], ['lullaby', 0.5], ['radioOn', 0.45], ['phoneRing', 0.55], ['whisper', 1.2]],
  medium: [['doorCreep', 0.9], ['door', 0.5], ['cart', 0.5], ['rollToward', 0.6], ['moveBehind', 0.7], ['footprints', 0.85], ['handprints', 0.8], ['writing', 0.8], ['coldBreath', 0.6], ['tvFace', 0.6], ['elevator', 0.55], ['anchor', 0.7], ['fall', 0.4],
    ['figure', 1.1], ['window', 0.8], ['child', 0.7], ['nurse', 0.8], ['curtain', 0.9], ['mirror', 1.2]],
  big: [['behind', 1], ['lightsDie', 1.1], ['blackout', 0.5]],
};
const APPARITION = new Set(['figure', 'window', 'child', 'nurse', 'behind', 'curtain', 'mirror', 'counter']);
const BIAS = {
  corridor: { figure: 2, nurse: 2, lightsDie: 1.8, footprints: 1.4, child: 1.3 }, ward: { curtain: 2.5, nurse: 1.3, mirror: 1.5, handprints: 1.3 },
  nursery: { lullaby: 4, child: 2.5, handprints: 1.5 }, peds_ward: { lullaby: 3, child: 2 }, playroom: { lullaby: 3, child: 2.5 },
  morgue: { coldBreath: 2.5, crawl: 1.5, silence: 1.5, anchor: 1.5 }, autopsy: { coldBreath: 2, crawl: 1.4 }, psych_cell: { doorCreep: 2.5, behind: 1.5 }, stairwell: { doorCreep: 2.5, crawl: 1.3 },
  tunnel: { crawl: 2, silence: 1.5, footprints: 1.5 }, chapel: { anchor: 2, silence: 1.5 }, rehab: { mirror: 3 }, waiting: { tvFace: 2, phoneRing: 1.5 }, lobby: { elevator: 1.5, figure: 1.3 },
  monitor: { tvFace: 3 }, security: { tvFace: 3 }, icu: { tvFace: 1.5, coldBreath: 1.4 }, outdoor: { window: 0, crawl: 0, figure: 0.6, writing: 0, footprints: 0, doorCreep: 0 },
};
const _a = new THREE.Vector3(), _b = new THREE.Vector3();

export function installHorror(game) {
  if (typeof location !== 'undefined' && new URLSearchParams(location.search).has('nohorror')) return null; // 除錯:?nohorror 關掉整個靈異系統(比較效能用)
  const subs = {};
  const later = []; // [時間, fn](遊戲時間)
  const watchers = [];
  const H = {
    game, settings,
    director: null, whispers: null, subs: new GhostSubs(), app: null, marks: null, fx: null,
    ringing: null, usedWrit: new Set(), coldK: 0, coldT: 0, coldUntil: 0, known: new Set(),
    // 玩家認出某個鬼之後(讀到能認出他的文件),字幕改顯示名字(劇情代理呼叫;GHOSTS 的 id)
    reveal(id) { H.known.add(id); },
    on(ev, fn) { (subs[ev] ||= new Set()).add(fn); return () => subs[ev].delete(fn); },
    emit(ev, d) { const s = subs[ev]; if (s) for (const fn of s) { try { fn(d); } catch (e) { console.warn('[horror]', ev, e); } } },
    after(sec, fn) { later.push([game.time + sec, fn]); },
    watch(fn) { watchers.push(fn); }, // 每幀呼叫,回傳 false 就移除
    v3: (o) => _a.set(o.x, o.y, o.z), v3b: (x, y, z) => _b.set(x, y, z),
    get intensity() { return H.director.level; },
    get events() { return game.hospital?.events || null; },
    // ---- 耳語 ----
    whisper(line, o = {}) { return H.whispers.say(line, { priority: 6, ...o }); },
    phone(o = {}) {
      const ringing = H.ringing && game.time < H.ringing.until;
      const first = ringing && !H.whispers.used.has('ph.1') ? 'ph.1' : null;
      const l = first || H.whispers.pick('phone', { round: game.round, phase: game.phase }) || 'ph.5';
      H.ringing = null;
      const h = H.whispers.say(l, { filter: 'phone', ear: 'right', priority: 9, force: true });
      H.emit('phone:answer', { id: o.id ?? null, line: h?.id ?? null });
      return h;
    },
    radio(o = {}) {
      const l = H.whispers.pick('radio', { round: game.round, phase: game.phase }) || 'rd.1';
      return H.whispers.say(l, { filter: 'radio', pos: o.pos, ear: o.pos ? 'world' : 'near', priority: o.auto ? 5 : 8, force: !o.auto });
    },
    // 事件字幕(數數的人)
    caption(kind, n = 1, tail) {
      const C = CAPTIONS[kind];
      if (!C) return;
      const text = C.count.slice(0, n).join('……') + (tail === 'end' ? C.tailEnd : tail === 'near' ? C.tailNear : C.tail);
      H.subs.show({ text, cap: true, tag: C.who, hold: 2, lead: 0.6 });
    },
    // ---- 事件 ----
    event(kind, o = {}) {
      if (kind === 'whisper') return !!ambientWhisper(true);
      const E = H.events;
      if (!E) return false;
      if (!o.force && !H.director.request(kind, o)) return false;
      const r = E.fire(kind, o);
      if (r) { H.director.notify(kind, { ...o, dur: DK[kind]?.tier === 'big' ? 12 : undefined }); H.emit('event', { kind }); }
      return !!r;
    },
    apparition(kind, o = {}) { return APPARITION.has(kind) ? H.event(kind, { force: true, ...o }) : false; },
    flicker(pos, dur = 0.8) {
      const F = H.events?.fixtures;
      if (!F || !pos) return false;
      let best = null, bd = 36;
      for (const f of F) { if (f.state === 2 || f.prop || !f.shape) continue; const q = (f.x - pos.x) ** 2 + (f.z - pos.z) ** 2 + ((f.y - (pos.y ?? f.y)) * 2) ** 2; if (q < bd) { bd = q; best = f; } }
      if (!best) return false;
      H.events.S.active.push({ type: 'storm', f: best, t0: game.time, t1: game.time + dur, burn: false });
      return true;
    },
    chill(k = 0.8, dur = 15) { H.coldT = Math.max(H.coldT, k); H.coldUntil = Math.max(H.coldUntil, game.time + dur); },
    silence(dur = 4) { ghost.silence(dur); },
    // ---- 每幀 ----
    update(dt) {
      ghost.track();
      H.subs.update();
      if (game.state !== 'playing') { if (H._st === 'playing') H.resetRun(); H._st = game.state; return; }
      if (H._st !== 'playing') { H._st = 'playing'; H.resetRun(); }
      const paused = (game.paused || game.shopUIOpen) && !game.net;
      // 寒氣(結霜 + 呼氣)
      const tgt = game.time < H.coldUntil ? H.coldT : 0;
      H.coldK += (tgt - H.coldK) * Math.min(1, dt * (tgt > H.coldK ? 0.9 : 0.35));
      if (tgt === 0 && H.coldK < 0.01) { H.coldK = 0; H.coldT = 0; }
      H.subs.frost(H.coldK * (settings.get('hurtFx') === false ? 0.5 : 1));
      if (paused) return;
      H.fx?.update(dt, game, H.coldK);
      H.marks?.update(dt);
      H.app?.update(dt, game);
      for (let i = later.length - 1; i >= 0; i--) if (game.time >= later[i][0]) { const fn = later[i][1]; later.splice(i, 1); try { fn(); } catch (e) { console.warn('[horror]', e); } }
      for (let i = watchers.length - 1; i >= 0; i--) { let keep = false; try { keep = watchers[i](dt); } catch (e) { console.warn('[horror]', e); } if (!keep) watchers.splice(i, 1); }
      if (H.ringing && game.time > H.ringing.until) H.ringing = null;
      H.director.update(dt, game);
      tick(dt);
    },
    resetRun() {
      H.director.reset(); H.whispers.reset(); H.app?.clear(); H.marks?.clear(); H.fx?.clear();
      later.length = 0; watchers.length = 0; H.usedWrit.clear(); H.ringing = null; H.coldK = H.coldT = 0; H.coldUntil = 0;
      T.zones.clear(); T.props.clear(); T.still = 0; T.streak = 0; T.lastKill = 0; T.zonePend = null; T.next = 0;
      for (const d of H.events?.doors || []) d.primed = false;
      if (performance.now() > 40000) models.warm();
    },
    stats() { return { ...H.director.stats(), whispers: H.whispers.count, wlog: H.whispers.log.slice(-8), apparitions: H.app?.count ?? 0, alog: H.app?.log.slice(-8) ?? [], active: H.app?.active ?? 0, models: models.state, events: H.events?.S.log.slice(-10) ?? [], cold: +H.coldK.toFixed(2) }; },
  };
  H.director = new Director(H);
  H.whispers = new Whispers(H);
  game.horror = H;

  // ---- 場景相關(灰盒地圖沒有 hospital.events 時只剩耳語) ----
  const E = game.hospital?.events;
  if (E && E.register) {
    H.app = new Apparitions(H, game.scene);
    H.marks = new Marks(H, game.scene);
    H.fx = new ColdFx(game.scene);
    E.register(paranormalKinds(H));
    E.auto = false; // 驚嚇導演接手排程
    try { H.marks.placeStatic(game.hospital.K, game.hospital.layout); } catch (e) { console.warn('[horror] 牆上字跡', e); }
  }
  // 選單期間就開始在背景準備幻影模型;等 main.js 的開機預編譯做完(畫質、光源數都定了)再預編譯靈異材質(不卡第一次出現)
  // 等主程式的暖機(hz:warm:殭屍變體與常用材質)做完才開始,不跟它搶 CPU/GPU 編譯執行緒;最多等 30 秒
  { const t0 = performance.now(); const wait = () => { if (performance.getEntriesByName('hz:warm').length || performance.now() - t0 > 30000) { models.warm(); precompile(game, H); } else setTimeout(wait, 400); }; setTimeout(wait, 1000); }

  // ---- 觸發器與排程 ----
  const T = { zones: new Set(), props: new Set(), still: 0, streak: 0, lastKill: 0, zonePend: null, next: 0, acc: 0, low: -1e9, dark: -1e9, strk: -1e9, prop: -1e9, warn: -1e9, guide: -1e9, sig: -1e9 };
  const zoneOf = () => game.hospital?.zone || null;
  const say = (l, o) => { if (!l) return null; const r = H.whispers.say(l, { priority: 5, ...o }); if (r) H.director.notify('whisper'); return r; };
  function ambientWhisper(force) {
    const l = H.whispers.pick('idle', { round: game.round, phase: game.phase, zone: zoneOf() });
    if (!l) return null;
    if (!force && !H.director.request('whisper')) return null;
    return say(l, { priority: 3 });
  }
  function tick(dt) {
    const D = H.director;
    if (D.level === 'off') return;
    T.acc += dt;
    if (T.acc < 0.25) return; // 4 Hz
    const step = T.acc; T.acc = 0;
    const p = game.player, zone = zoneOf(), round = game.round, phase = game.phase;
    const c = { zone, round, phase };
    // 第一次進入某區:那一區的低語(戰鬥中延後,最多等 25 秒)
    if (zone && !T.zones.has(zone.id)) { T.zones.add(zone.id); const l = H.whispers.pick('zone', c); if (l) T.zonePend = { l, at: game.time + 1.2 + Math.random() * 1.8, until: game.time + 90, zone: zone.id }; }
    if (T.zonePend && zone && zone.id !== T.zonePend.zone && game.time > T.zonePend.at + 20) T.zonePend = null; // 走遠了就算了
    if (T.zonePend && game.time >= T.zonePend.at) {
      if (game.time > T.zonePend.until) T.zonePend = null;
      else if (D.silent && D.tension < 0.45 && !H.whispers.busy && D.request('whisper', { force: true })) { say(T.zonePend.l, { priority: 5 }); T.zonePend = null; }
    }
    // 低血量
    // 用急救包(正典 §5.8#7;只在靜默期)
    if (game.healT > 0 && !T.heal) { T.heal = true; if (D.silent && !H.whispers.busy && D.request('whisper', { force: true })) { const l = H.whispers.pick('medkit', c); if (l) say(l, { priority: 6 }); } } else if (!(game.healT > 0)) T.heal = false;
    if (D.silent && p.hp / (p.maxHp || 100) < 0.3 && p.alive !== false && game.time - T.low > 80 && !H.whispers.busy && D.request('whisper', { force: true })) { const l = H.whispers.pick('lowhp', c); if (l) { say(l, { priority: 6 }); T.low = game.time; } }
    // 暗處站著不動
    T.still = p.speedNorm < 0.05 ? T.still + step : 0;
    if (D.silent && T.still > 6 && game.time - T.dark > 70 && D.tension < 0.2 && isDark(p) && !H.whispers.busy && D.request('whisper', { force: true })) {
      const l = H.whispers.pick('dark', c);
      if (l) { say(l, { priority: 5 }); T.dark = game.time; T.still = 0; if (!p.flashOn && Math.random() < 0.4) H.after(3, () => H.event('coldBreath')); }
    }
    // 連殺結束之後
    const S = game.stats;
    if (S) {
      if (S.streak >= 5 && S.lastKill > T.lastKill) T.streak = Math.max(T.streak, S.streak);
      T.lastKill = S.lastKill;
      if (T.streak >= 5 && D.silent && game.time - S.lastKill > 5 && D.tension < 0.35 && game.time - T.strk > 100 && !H.whispers.busy && D.request('whisper', { force: true })) { const l = H.whispers.pick('streak', c); if (l) say(l, { priority: 4 }); T.strk = game.time; T.streak = 0; }
    }
    const E = H.events;
    // 靠近道具(每個錨點每局一次)
    if (E && D.silent && D.tension < 0.35 && game.time - T.prop > 35 && !H.whispers.busy) {
      const li = game.hospital.level;
      for (const a of E.anchors) {
        if (a.li !== li || T.props.has(a)) continue;
        const d = Math.hypot(a.x - p.pos.x, a.z - p.pos.z);
        if (d > 3.2 || !game.world.hasLineOfSight?.(p.pos.x, p.pos.y + 1.5, p.pos.z, a.x, a.y + 0.3, a.z)) continue;
        T.props.add(a);
        const l = H.whispers.pick('prop', { ...c, prop: a.kind });
        if (l && D.request('whisper', { force: true })) { say(l, { priority: 5 }); T.prop = game.time; }
        break;
      }
    }
    // 殭屍從看不到的方向接近:那一側的耳朵(提示)
    if (D.silent && D.tension < 0.6 && game.time - T.warn > 45 && !H.whispers.busy) { // 靜默期裡的伏擊者
      const fx = -Math.sin(p.yaw), fz = -Math.cos(p.yaw);
      for (const z of game.zombies) {
        if (!z.alive || z._ghw || !(z.dist > 6 && z.dist < 14) || Math.abs(z.pos.y - p.pos.y) > 2) continue;
        const dx = z.pos.x - p.pos.x, dz = z.pos.z - p.pos.z, dl = Math.hypot(dx, dz) || 1, dot = (dx * fx + dz * fz) / dl;
        if (dot > 0.25) continue;
        z._ghw = true;
        if (Math.random() > 0.5) break;
        const ear = dot < -0.55 ? 'behind' : (fx * dz - fz * dx) > 0 ? 'right' : 'left';
        const l = H.whispers.pick('warn', { ...c, ear }) || H.whispers.pick('warn', c);
        if (l && D.request('whisper', { force: true })) { say(l, { priority: 6, ear: l.ear || ear }); T.warn = game.time; }
        break;
      }
    }
    // 引導:休息時離補給站很遠 → 從補給站那一側的耳朵
    if ((phase === 'shop') && D.roundT > 12 && !game.shopUIOpen && game.time - T.guide > 200 && game.shop?.pos && !H.whispers.busy) {
      const sp = game.shop.pos, d = Math.hypot(sp.x - p.pos.x, sp.z - p.pos.z);
      if (d > 24) {
        const l = H.whispers.pick('guide', { ...c, cue: 'shop' });
        if (l && D.request('whisper', { force: true })) { say(l, { priority: 5, ear: earToward(p, sp.x, sp.z) }); T.guide = game.time; }
      }
    }
    if (!E) return;
    // 殭屍靠近時的「訊號」閃燈
    if (game.time - T.sig > 8 && D.tension > 0.05 && D.tension < 0.5 && Math.random() < 0.25 && D.request('signal')) { if (E.fire('signal')) D.notify('signal'); T.sig = game.time; }
    // 依恐懼值挑事件
    if (game.time < T.next) return;
    T.next = game.time + 1.5;
    let tier = null;
    if (D.dread >= 75 && D.allowTier('big', game) && Math.random() < 0.6) tier = 'big';
    else if (D.dread >= 40 && D.allowTier('medium', game)) tier = 'medium';
    else if (D.dread >= 16 && D.allowTier('small', game) && Math.random() < 0.3) tier = 'small'; // 小事件不要一直放:留給恐懼累積到看得見的事件
    if (!tier) return;
    const th = zone?.theme, mood = zone?.mood, out = /^outdoor|^roof/.test(mood || '');
    const esc = Math.min(1, Math.max(0, (D.t - 60) / 600)) * 0.7 + Math.min(1, (round || 1) / 8) * 0.3;
    const cand = [];
    for (const [k, w0] of CATALOG[tier]) {
      let w = w0 * (BIAS[th]?.[k] ?? BIAS[mood]?.[k] ?? 1);
      if (out && BIAS.outdoor[k] != null) w *= BIAS.outdoor[k];
      if (APPARITION.has(k)) w *= 0.35 + esc; // 一局越後面越常看到人影
      if (k === 'whisper' && !H.whispers.pick('idle', c)) w = 0;
      if (w <= 0 || !D.request(k)) continue;
      cand.push([k, w * (0.6 + Math.random() * 0.8)]);
    }
    cand.sort((a, b) => b[1] - a[1]);
    for (const [k] of cand) {
      if (k === 'whisper') { if (ambientWhisper(true)) return; continue; }
      if (E.fire(k)) { D.notify(k, { dur: tier === 'big' ? 12 : undefined }); H.emit('event', { kind: k }); return; }
    }
  }
  function isDark(p) {
    const F = H.events?.fixtures;
    if (!F) return false;
    const li = game.hospital.level;
    for (const f of F) if (f.li === li && f.cur > 0.3 && (f.x - p.pos.x) ** 2 + (f.z - p.pos.z) ** 2 < 36) return false;
    return true;
  }
  function earToward(p, x, z) {
    const fx = -Math.sin(p.yaw), fz = -Math.cos(p.yaw), dx = x - p.pos.x, dz = z - p.pos.z, dl = Math.hypot(dx, dz) || 1;
    const dot = (dx * fx + dz * fz) / dl;
    if (dot < -0.5) return 'behind';
    if (dot > 0.7) return 'both';
    return (fx * dz - fz * dx) > 0 ? 'right' : 'left';
  }
  void LINES;
  return H;
}

// 預編譯靈異材質(幻影兩種、腳印/手印、字跡、寒氣粒子):先在背景執行緒編好,第一次出現不卡
async function precompile(game, H) {
  if (!H.app || H.warm) return;
  H.warm = 'compiling';
  try {
    const g = new THREE.Group();
    const geo = new THREE.SphereGeometry(0.2, 8, 6);
    for (const s of H.app.slots.slice(0, 1)) for (const m of [s.pale, s.shade, s.depth]) g.add(new THREE.Mesh(geo, m));
    for (const m of H.marks.warmList()) { const c = m.clone(); c.visible = true; if (c.isInstancedMesh) c.count = 1; g.add(c); }
    const wm = H.marks.write({ id: 'warm', text: '·', style: 'marker' }, 0, -50, 0, 0, 1, { keep: true }); wm.visible = true;
    const pts = H.fx.pts.clone(); pts.visible = true; g.add(pts);
    const res = await warmCompile(game, g, { shadows: false });
    if (res?.programs) await initPrograms(res.programs);
    wm.visible = false;
    H.warm = 'done';
  } catch (e) { H.warm = 'failed'; console.warn('[horror] 預編譯', e); }
}
