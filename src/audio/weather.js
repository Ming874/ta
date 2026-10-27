// 天氣:雨聲音床與雷聲(給 outdoor 代理的天氣系統呼叫)。
//
// sfx.setRain(level, outdoorFactor)
//   level 0..1 雨勢(0 = 停雨,0.3 毛毛雨,0.6 中雨,1 暴雨);outdoorFactor 0..1 聆聽者「在室外的程度」
//   (1 = 露天、0.5 = 門口/破窗旁、0 = 建築深處)。省略 outdoorFactor 時依目前區域是否戶外自動判斷。
//   可每幀呼叫(內部平滑、只在數值變化夠大時才排自動化);level 為 0 時 8 秒後拆掉節點。
// sfx.thunder(dist, delay)
//   dist 公尺(閃電距離,約 200~6000);請在閃電亮起的當下呼叫:聲音依聲速延遲 dist/343 秒到達(最多 8 秒),
//   也可用 delay(秒)指定延遲。近的雷 = 尖銳的霹靂聲 + 全頻的滾雷;遠的 = 延遲後低沉、拉長的悶雷;室內再變悶。
//
// 雨聲是真實錄音(CC0,public/audio/rain/,署名見 public/credits/audio.md),分層依位置交叉淡化:
//   遠處雨幕(wash)— 室外全頻;室內過低通 = 隔著牆/屋頂的悶雨聲
//   近處雨滴(near)— 打在地面、水窪的細節,只有真的在室外才聽得清楚;高通後當草叢/樹葉的沙沙(在草地、中庭、墓園)
//   屋頂/排水溝(roof)— 雨棚、車頂、屋簷下 = 近而響的鼓點;室內 = 頂樓才聽得到的悶悶屋頂鼓聲(依上方還有幾層樓衰減)
//   窗戶(window)— 室內靠近窗戶時的玻璃雨滴聲
// 錄音第一次下雨才載入(不擋選單);載入前由合成雨聲撐場,載好後交叉淡化過去。低畫質只用 3 層、中畫質 4 層、高畫質全部。
import { A, onTick, emit, gain, filter, burst, tone, rand, clamp, playBuf } from './core.js';
import * as S from './samples.js';

// 錄音清單(登記到樣本庫的循環音床;解碼成單聲道,播放時兩個錯開的音源左右分開 = 自然的立體寬度)
Object.assign(S.LOOPS, {
  rain_wash: { sr: 24000, f: ['rain/rain_wash.ogg'], n: [1] },
  rain_near: { sr: 32000, f: ['rain/rain_near.ogg'], n: [1] },
  rain_roof: { sr: 24000, f: ['rain/rain_roof.ogg'], n: [1] },
  rain_window: { sr: 32000, f: ['rain/rain_window.ogg'], n: [1] },
  thunder: { sr: 22050, f: ['rain/thunder_roll.ogg'], n: [1] },
});

const R = { lvl: 0, out: -1, nodes: null, rec: null, offAt: 0, ctxT: -9, cx: { dr: 0, win: 0, veg: 0, roofK: 1 }, last: {} };

// ---------- 合成備援(錄音載入前) ----------
function noise(kind) {
  const s = A.ctx.createBufferSource();
  s.buffer = A.noise[kind];
  s.loop = true;
  s.start(A.ctx.currentTime, Math.random() * 3);
  return s;
}
function synthBed() {
  const o = gain(0, A.bus.amb), outG = gain(0, o), inG = gain(0, o);
  const n1 = noise('white'), n2 = noise('pink'), n3 = noise('brown');
  n1.connect(filter('highpass', 3200, 0.5, gain(0.05, outG)));
  n2.connect(filter('bandpass', 1500, 0.45, gain(0.12, outG)));
  n3.connect(filter('lowpass', 420, 0.6, gain(0.16, outG)));
  n3.connect(filter('lowpass', 520, 0.7, gain(0.22, inG)));
  return { o, outG, inG, srcs: [n1, n2, n3] };
}

// ---------- 錄音分層 ----------
// 每層:兩個錯開起點的循環音源(左右)→ 分支(全頻 / 濾波)→ 各自的增益。layer: [LOOPS key, 立體寬度]
function loopPair(b, dest, wide) {
  const out = [];
  for (const pan of [-wide, wide]) {
    const s = A.ctx.createBufferSource();
    s.buffer = b; s.loop = true;
    s.playbackRate.value = rand(0.985, 1.015);
    const p = A.ctx.createStereoPanner();
    p.pan.value = pan;
    s.connect(p); p.connect(dest);
    s.start(A.ctx.currentTime, rand(0, b.duration));
    out.push(s);
  }
  return out;
}
const QL = () => { try { return A.game?.quality?.preset || 'high'; } catch { return 'high'; } };
function recBed() {
  const q = QL(), o = gain(0, A.bus.amb), G = {}, srcs = [];
  const mk = (k, v = 0) => (G[k] = gain(v, o));
  // 遠處雨幕:室外全頻、室內低通
  mk('wash'); mk('washIn');
  const w = gain(1); w.connect(G.wash); w.connect(filter('lowpass', 650, 0.6, G.washIn));
  // 近處雨滴(地面/水窪)+ 高通後的植被沙沙
  mk('near');
  const nr = gain(1); nr.connect(G.near);
  if (q === 'high' || q === 'ultra') { mk('veg'); nr.connect(filter('highpass', 2600, 0.6, G.veg)); }
  // 屋頂/排水溝:雨棚下全頻(加一點 2.5kHz 金屬感);室內只剩低頻鼓聲
  mk('awn'); mk('roofIn');
  const rf = gain(1);
  const pk = filter('peaking', 2500, 1.2, G.awn); pk.gain.value = 3;
  rf.connect(pk); rf.connect(filter('lowpass', 420, 0.7, G.roofIn));
  // 窗戶
  let wn = null;
  if (q !== 'low') { mk('glass'); wn = gain(1); wn.connect(filter('highpass', 600, 0.6, G.glass)); }
  return { o, G, srcs, ins: { rain_wash: [w, 0.8], rain_near: [nr, 0.6], rain_roof: [rf, 0.5], rain_window: wn && [wn, 0.45] }, started: new Set() };
}

function stopNodes(N) {
  if (!N) return;
  for (const s of N.srcs) { try { s.stop(); } catch { /* 已停 */ } }
  setTimeout(() => { try { N.o.disconnect(); } catch { /* 已斷 */ } }, 150);
}

// ---------- 位置情境(每 0.25 秒):雨棚鼓聲、靠窗、植被、上方還有幾層樓 ----------
function context(now) {
  if (now - R.ctxT < 0.25) return;
  R.ctxT = now;
  const C = R.cx, L = A.L, lay = A.world && A.world.layout;
  if (R.cxOverride) { Object.assign(C, R.cxOverride); return; }
  try { C.dr = clamp(+(A.game && A.game.weather && A.game.weather.drum) || 0, 0, 1); } catch { C.dr = 0; }
  C.win = 0; C.veg = 0; C.roofK = 1;
  if (!lay || !lay.flagsAt) return;
  const feet = L.y - 1.65, li = lay.levelOfY ? lay.levelOfY(feet) : 0, c0 = Math.floor(L.x / 2), r0 = Math.floor(L.z / 2);
  // 3 格(6m)內最近的窗戶
  let best = 9;
  for (let dr = -3; dr <= 3; dr++) for (let dc = -3; dc <= 3; dc++) {
    const f = lay.flagsAt(li, c0 + dc, r0 + dr);
    if (f & 512) { const d = Math.hypot(dc, dr) * 2; if (d < best) best = d; }
  }
  C.win = best < 9 ? clamp(1 - (best - 1) / 5, 0, 1) : 0;
  // 植被:草地,或中庭/墓園/遊戲場
  let surf = A.surface;
  try { surf = A.world.surfaceAt(L.x, feet, L.z) || surf; } catch { /* 用舊值 */ }
  const z = lay.zoneAt ? lay.zoneAt(li, c0, r0) : null;
  C.veg = surf === 'grass' || (z && /courtyard|cemetery|playground/.test(z.theme || '')) ? 1 : 0;
  // 上方還有幾層樓(頂樓才聽得到屋頂上的雨)
  let above = 0;
  if (lay.hasFloor) for (let lj = li + 1; lj < lay.levels.length; lj++) if (lay.hasFloor(lj, c0, r0)) above++;
  C.roofK = 1 / (1 + 1.6 * above);
}

// ---------- 對外 ----------
function autoOut() {
  if (A.outdoor) return 1;
  const w = A.world, L = A.L;
  if (w && w.ceilAt) { try { return Number.isFinite(w.ceilAt(L.x, L.z, L.y - 1.65)) ? 0 : 1; } catch { return 0; } }
  return 0;
}

export function setRain(level, outdoorFactor) {
  R.lvl = clamp(+level || 0, 0, 1);
  R.out = Number.isFinite(outdoorFactor) ? clamp(outdoorFactor, 0, 1) : -1;
  if (!A.ctx) return;
  if (R.lvl > 0.001) {
    if (!R.rec) R.rec = recBed();
    if (!R.nodes && R.rec.started.size < 3) R.nodes = synthBed();
  }
  apply(false);
}

// 各層的目標增益(依雨量 l、室外程度 o、雨棚 dr、靠窗 win、植被 veg、上方樓層 roofK)
export function rainGains(l, o, C) {
  const base = Math.pow(l, 0.7);
  return {
    wash: base * (0.55 + 0.25 * l) * o,
    washIn: base * 0.42 * (1 - o) * (0.45 + 0.55 * C.roofK),
    near: Math.pow(l, 1.1) * Math.pow(o, 1.5) * 0.85 * (1 - 0.5 * C.dr),
    veg: l * o * C.veg * 0.55,
    awn: l * (C.dr * 1.25 + o * 0.12),
    roofIn: l * (1 - o) * C.roofK * 0.75,
    glass: l * C.win * (1 - 0.6 * o) * 0.9,
  };
}

function apply(force) {
  if (!A.ctx) return;
  const n = A.ctx.currentTime, o = R.out >= 0 ? R.out : autoOut(), l = R.lvl;
  context(n);
  const rec = R.rec, last = R.last;
  if (rec) {
    const g = rainGains(l, o, R.cx);
    let any = false;
    for (const k in rec.G) { // 變化夠大才重排自動化(10Hz 呼叫也不會產生拉鍊雜音:setTarget 平滑 0.5 秒)
      const v = rec.G[k] ? g[k] ?? 0 : 0;
      if (force || Math.abs(v - (last[k] ?? -1)) > 0.015) { rec.G[k].gain.setTargetAtTime(v, n, k === 'awn' || k === 'glass' ? 0.35 : 0.6); last[k] = v; any = true; }
    }
    const tot = rec.started.size ? Math.min(1.6, 1.25) : 0;
    if (force || any || last.o !== tot) { rec.o.gain.setTargetAtTime(tot, n, 1.2); last.o = tot; }
  }
  const N = R.nodes; // 合成備援:錄音大致到齊後淡掉
  if (N) {
    const k = rec && rec.started.size >= 3 ? 0 : Math.pow(l, 0.8) * 1.6;
    N.o.gain.setTargetAtTime(k, n, 1.2);
    N.outG.gain.setTargetAtTime(o, n, 0.6);
    N.inG.gain.setTargetAtTime((1 - o) * 0.8 + 0.1, n, 0.6);
    if (k === 0 && !N.off) { N.off = n + 6; }
  }
  R.offAt = l <= 0.001 ? (R.offAt || n + 8) : 0;
}

onTick((now) => {
  if (!R.rec && !R.nodes) return;
  const rec = R.rec;
  if (rec && R.lvl > 0.001) { // 錄音:每層載好就接上(載入中會一直請求;用到時 loop() 也會刷新使用時間,不被釋放)
    for (const key in rec.ins) {
      const io = rec.ins[key];
      if (!io) continue;
      const b = S.loop(key);
      if (b && !rec.started.has(key)) { rec.started.add(key); rec.srcs.push(...loopPair(b.b, io[0], io[1])); apply(true); }
    }
  }
  if (R.out < 0 || now - R.ctxT > 0.5) apply(false);
  if (R.nodes && R.nodes.off && now > R.nodes.off) { stopNodes(R.nodes); R.nodes = null; }
  if (R.offAt && now > R.offAt) { stopNodes(R.nodes); stopNodes(R.rec); R.nodes = null; R.rec = null; R.last = {}; R.offAt = 0; return; }
  const l = R.lvl, o = R.out >= 0 ? R.out : 0;
  if (o > 0.2 && o < 0.9 && l > 0.2 && Math.random() < 0.02 * l) S.play('amb.drip', { bus: 'amb', prio: 0, gain: 0.5, g: 0.6 }); // 屋簷/門口的滴水
});

// ---------- 雷 ----------
export function thunder(dist = 1500, delay) {
  if (!A.ctx) return;
  const dd = clamp(+dist || 1500, 50, 12000);
  const dl = Number.isFinite(delay) ? clamp(delay, 0, 10) : Math.min(8, dd / 343);
  const near = clamp(1 - (dd - 250) / 1600, 0, 1); // 1 = 很近
  const ind = R.out >= 0 ? 1 - R.out : 1 - autoOut(); // 室內程度
  const rec = S.loop('thunder');
  const len = rec ? rec.b.duration / (0.82 + near * 0.18) + 0.5 : 3.5 + (1 - near) * 3 + rand(0, 1.5);
  const h = emit({ bus: 'amb', prio: 5, room: 0.3, hall: 0.9, echo: 0.6, dur: len + 1, delay: dl, gain: (0.5 + near * 0.7) * (1 - ind * 0.45) });
  if (!h) return;
  const t = h.t;
  // 距離越遠高頻被吃得越多(近:全頻;3km:約 450Hz;室內再減半)
  const lp = filter('lowpass', (ind > 0.5 ? 0.5 : 1) * (near > 0.6 ? 12000 : 380 + near * 3500), 0.6, h.in);
  if (near > 0.3) { // 霹靂:亮而尖的撕裂聲 + 衝擊(錄音的滾雷之前)
    burst(lp, t, { type: 'highpass', f: 1200, dur: 0.12, a: 0.004, g: 0.5 * near });
    burst(lp, t + 0.01, { buf: 'pink', type: 'bandpass', f: 2500, f1: 500, q: 0.6, dur: 0.6, a: 0.01, g: 0.45 * near });
    tone(lp, t, { f: 55, f1: 28, dur: 0.7, a: 0.005, g: 0.6 * near });
  }
  if (rec) { // 真實的滾雷錄音:遠的放慢(更低沉、更長)
    const rate = 0.82 + near * 0.18 + rand(-0.03, 0.03);
    playBuf(lp, t + (near > 0.3 ? 0.08 : 0), rec.b, { rate, g: rec.g * (0.9 + near * 0.6), fi: near > 0.3 ? 0 : 0.6 });
    tone(lp, t, { f: rand(32, 40), f1: 22, dur: len * 0.6, a: 0.4 + (1 - near) * 0.6, g: 0.18 }); // 次低頻的壓力
    return;
  }
  // 錄音還沒載入:合成滾雷(並開始載入)
  tone(lp, t, { f: rand(32, 42), f1: 22, dur: len * 0.8, a: 0.3 + (1 - near) * 0.5, g: 0.35 });
  for (let i = 0; i < 6; i++) {
    const p = A.ctx.createStereoPanner();
    p.pan.value = rand(-0.9, 0.9);
    p.connect(lp);
    burst(p, t + rand(0.05, len * 0.6), { buf: 'brown', type: 'lowpass', f: rand(180, 420), f1: 60, dur: rand(0.8, 2), a: rand(0.1, 0.4), g: rand(0.15, 0.35) });
  }
  burst(lp, t + 0.1, { buf: 'brown', type: 'lowpass', f: 300, f1: 60, dur: len, a: 0.5, g: 0.3 });
}

export const rainState = () => ({ on: !!(R.rec || R.nodes), level: R.lvl, out: R.out, ctx: { ...R.cx }, layers: R.rec ? [...R.rec.started] : [], gains: { ...R.last }, synth: !!R.nodes });

// 測試/除錯:覆寫位置情境({ dr, win, veg, roofK };null = 恢復自動)、清掉雨聲狀態(換 context / 換地圖)
export function rainContext(cx) { R.cxOverride = cx || null; R.ctxT = -9; }
export function rainReset() {
  try { stopNodes(R.nodes); stopNodes(R.rec); } catch { /* 不同 context 的節點 */ }
  R.nodes = null; R.rec = null; R.last = {}; R.offAt = 0; R.ctxT = -9;
}
