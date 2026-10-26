// 音訊核心:AudioContext、混音匯流排、分區殘響、可重用的 3D 聲道條(strip)、遮蔽與空氣吸收、發聲數上限、基本音源。
// 沒有 AudioContext 時,外部呼叫一律安全地不做事。
//
// 訊號流:
//  各匯流排 → 類別(音效/配樂)→ mix → 悶音濾波(爆炸耳鳴/倒地)→ sum → 黏合壓縮 → 限幅 → 硬天花板(-1.1 dBFS)→ 主音量 → 喇叭
//  介面音效 → 類別(ui)→ sum(不受悶音影響)
//  殘響:區域殘響(兩個 convolver 交叉淡化,換區時載入新空間)、回聲(戶外/隧道的離散反射)、配樂大廳殘響

export const A = {
  ctx: null,
  bus: {},
  L: { x: 0, y: 1.65, z: 0, yaw: 0 }, // 聆聽者(玩家眼睛)
  vol: loadVol(), // 使用者音量設定 0..1
  world: null, // sfx.attachWorld(world) 後可做視線遮蔽、地面材質查詢
  surface: 'tile', // 玩家目前腳下材質(彈殼落地等用)
  stats: { emitted: 0, culled: 0, stolen: 0, los: 0 },
};

export const rand = (a, b) => a + Math.random() * (b - a);
export const pick = (arr) => arr[(Math.random() * arr.length) | 0];
export const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const vg = (v) => v * v; // 音量滑桿 → 增益(近似對數感受)

function loadVol() {
  const v = { master: 1, music: 1, sfx: 1 };
  try {
    const s = JSON.parse(localStorage.getItem('hz.audio.vol') || 'null');
    if (s) for (const k in v) if (Number.isFinite(s[k])) v[k] = clamp(s[k], 0, 1);
  } catch { /* 無痕模式等 */ }
  return v;
}

function setParams(node, o) {
  for (const k in o) node[k].value = o[k];
  return node;
}

export function gain(v, dest) {
  const g = A.ctx.createGain();
  g.gain.value = v;
  if (dest) g.connect(dest);
  return g;
}

export function filter(type, f, q = 0.7, dest) {
  const b = A.ctx.createBiquadFilter();
  b.type = type;
  b.frequency.value = f;
  b.Q.value = q;
  if (dest) b.connect(dest);
  return b;
}

// ---------- 初始化 ----------
const ticks = [];
export const onTick = (fn) => ticks.push(fn); // 50ms 排程(配樂、環境、循環音共用一個計時器)

export function attach(ctx) {
  A.ctx = ctx;
  const v = A.vol;
  A.outVol = gain(vg(v.master), ctx.destination);
  const ceil = ctx.createWaveShaper(); // 硬天花板:線性到 0.74,之後柔和飽和到 0.877(保證峰值 < -1 dBFS)
  ceil.curve = ceilCurve();
  ceil.oversample = 'none';
  ceil.connect(A.outVol);
  const limiter = setParams(ctx.createDynamicsCompressor(), { threshold: -4, knee: 0, ratio: 20, attack: 0.001, release: 0.09 });
  limiter.connect(ceil);
  const glue = setParams(ctx.createDynamicsCompressor(), { threshold: -12, knee: 8, ratio: 2, attack: 0.01, release: 0.2 });
  glue.connect(limiter);
  A.sum = gain(0.82, glue);
  A.muffle = filter('lowpass', 20000, 0.5, A.sum);
  A.mix = gain(1, A.muffle);
  A.cat = { sfx: gain(vg(v.sfx), A.mix), music: gain(vg(v.music), A.mix), ui: gain(vg(v.sfx), A.sum) };
  A.bus.sfx = gain(1, A.cat.sfx);
  A.bus.voice = gain(0.26, A.cat.sfx);
  A.bus.scare = gain(0.75, A.cat.sfx);
  A.duckAmb = gain(1, A.cat.sfx);
  A.bus.amb = gain(0.7, A.duckAmb);
  A.duck = gain(1, A.cat.music);
  A.bus.music = gain(0.17, A.duck);
  A.bus.ui = gain(1, A.cat.ui);

  // ---- 殘響 ----
  A.zrIn = gain(1);
  A.zrOut = gain(1, A.mix);
  A.zr = [0, 1].map((i) => {
    const c = ctx.createConvolver();
    const g = gain(i === 0 ? 1 : 0, c);
    A.zrIn.connect(g);
    c.connect(A.zrOut);
    return { c, g, key: null, off: -99 };
  });
  A.zrCur = 0;
  A.echo = makeEcho();
  A.hall = ctx.createConvolver();
  A.hall.buffer = makeIR(ctx, { dur: 3.4, pre: 0.035, damp: 0.82, er: 16 });
  A.hall.connect(gain(0.55, A.mix));
  A.duckRev = gain(1, A.hall);
  A.send = {
    sfx: { room: gain(vg(v.sfx), A.zrIn), echo: gain(vg(v.sfx), A.echo.in), hall: gain(vg(v.sfx), A.hall) },
    music: { hall: gain(vg(v.music), A.duckRev) },
  };
  A.room = A.send.sfx.room; // 舊名相容
  A.noise = { white: noiseBuf(ctx, 'white'), pink: noiseBuf(ctx, 'pink'), brown: noiseBuf(ctx, 'brown') };
  A.curves = {};
  A.waves = {};
  A.recentPain = [];
  A.losCache = new Map();
  A.selfStrips = new Map();
  A.lastDuck = -1;
  for (const k in POOLS) POOLS[k].strips = [];
  setListener(A.L.x, A.L.y, A.L.z, A.L.yaw);
  setSpace(A.space || 'corridor', true);
  if (A.timer) clearInterval(A.timer);
  if (typeof ctx.startRendering !== 'function') A.timer = setInterval(tick, 50);
  return ctx;
}

export function ensure() {
  if (A.ctx) return A.ctx;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  try {
    return attach(new AC({ latencyHint: 'interactive' }));
  } catch {
    return null;
  }
}

function ceilCurve() {
  const n = 8192, c = new Float32Array(n), k = 0.74, h = 0.885 - k;
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1, a = Math.abs(x);
    c[i] = Math.sign(x) * (a <= k ? a : k + h * Math.tanh((a - k) / h));
  }
  return c;
}

// ---------- 音量(設定選單用) ----------
export function setVolume(kind, v) {
  if (!(kind in A.vol)) return;
  A.vol[kind] = clamp(+v || 0, 0, 1);
  try { localStorage.setItem('hz.audio.vol', JSON.stringify(A.vol)); } catch { /* 忽略 */ }
  if (!A.ctx) return;
  const t = A.ctx.currentTime, V = A.vol, set = (p, x) => p.setTargetAtTime(x, t, 0.04);
  set(A.outVol.gain, vg(V.master));
  set(A.cat.sfx.gain, vg(V.sfx));
  set(A.cat.ui.gain, vg(V.sfx));
  for (const k in A.send.sfx) set(A.send.sfx[k].gain, vg(V.sfx));
  set(A.cat.music.gain, vg(V.music));
  set(A.send.music.hall.gain, vg(V.music));
}

// ---------- 殘響脈衝 ----------
// 早期反射(er 個)+ 平行牆面的顫動回聲(flutter)+ 越後面越暗的指數衰減
function makeIR(ctx, o) {
  const sr = ctx.sampleRate, dur = o.dur, len = Math.floor(sr * dur * 0.78), pre = o.pre ?? 0.01; // 衰減到 -47dB 就截斷(省卷積運算)
  const b = ctx.createBuffer(2, len, sr);
  for (let ch = 0; ch < 2; ch++) {
    const d = b.getChannelData(ch);
    for (let k = 0; k < (o.er ?? 12); k++) {
      const i = Math.floor((pre + Math.random() * (o.erSpan ?? 0.06)) * sr);
      if (i < len) d[i] += (Math.random() < 0.5 ? -1 : 1) * (0.8 - k * 0.035) * (o.erG ?? 1);
    }
    if (o.flutter) { // 走廊/樓梯間:固定間隔的反射串
      const per = o.flutter * (ch ? 1.07 : 1);
      for (let tt = pre + per, a = 0.5; tt < Math.min(dur, 0.6); tt += per, a *= 0.82) d[Math.floor(tt * sr)] += (ch ? -a : a) * (o.flutterG ?? 0.6);
    }
    let y = 0;
    const damp = o.damp ?? 0.6, bright = o.bright ?? 0.92;
    for (let i = Math.floor(pre * sr); i < len; i++) {
      const u = i / (len / 0.78);
      const a = Math.max(0.02, bright - damp * u);
      y += a * (Math.random() * 2 - 1 - y);
      d[i] += y * Math.exp((-6.9 * i) / sr / dur) * 0.6;
    }
    const fade = Math.floor(sr * 0.02); // 尾端淡出避免截斷
    for (let i = 0; i < fade; i++) d[len - 1 - i] *= i / fade;
  }
  return b;
}

// 空間預設:dur 殘響長度、wet 送出量、echo 離散回聲(戶外遠處建物、隧道)
export const SPACES = {
  padded: { ir: { dur: 0.28, pre: 0.003, damp: 0.85, bright: 0.45, er: 6, erSpan: 0.012 }, wet: 0.35, echo: 0 },
  small: { ir: { dur: 0.55, pre: 0.004, damp: 0.7, bright: 0.8, er: 10, erSpan: 0.02 }, wet: 0.6, echo: 0 },
  room: { ir: { dur: 0.9, pre: 0.006, damp: 0.6, bright: 0.85, er: 12, erSpan: 0.03 }, wet: 0.75, echo: 0 },
  corridor: { ir: { dur: 1.5, pre: 0.008, damp: 0.5, bright: 0.9, er: 14, erSpan: 0.05, flutter: 0.016, flutterG: 0.35 }, wet: 0.9, echo: 0.05, e: [0.07, 0.11, 0.25] },
  tile: { ir: { dur: 1.7, pre: 0.006, damp: 0.35, bright: 0.96, er: 16, erSpan: 0.03, flutter: 0.012, flutterG: 0.3 }, wet: 1, echo: 0 },
  hall: { ir: { dur: 3.6, pre: 0.03, damp: 0.75, bright: 0.85, er: 18, erSpan: 0.09 }, wet: 1.15, echo: 0.12, e: [0.13, 0.19, 0.3] },
  chapel: { ir: { dur: 4.2, pre: 0.025, damp: 0.85, bright: 0.75, er: 16, erSpan: 0.08 }, wet: 1.25, echo: 0.05, e: [0.1, 0.16, 0.25] },
  stair: { ir: { dur: 2.3, pre: 0.005, damp: 0.4, bright: 0.95, er: 16, erSpan: 0.03, flutter: 0.021, flutterG: 0.45 }, wet: 1.2, echo: 0.1, e: [0.045, 0.065, 0.4] },
  tunnel: { ir: { dur: 2.8, pre: 0.012, damp: 0.6, bright: 0.85, er: 14, erSpan: 0.05, flutter: 0.028, flutterG: 0.3 }, wet: 1.1, echo: 0.35, e: [0.12, 0.17, 0.45] },
  industrial: { ir: { dur: 2.1, pre: 0.01, damp: 0.5, bright: 0.9, er: 14, erSpan: 0.06 }, wet: 1, echo: 0.15, e: [0.09, 0.14, 0.3] },
  outdoor: { ir: { dur: 0.6, pre: 0.012, damp: 0.9, bright: 0.6, er: 4, erSpan: 0.03, erG: 0.6 }, wet: 0.22, echo: 0.55, e: [0.31, 0.47, 0.32] },
  open: { ir: { dur: 0.5, pre: 0.012, damp: 0.9, bright: 0.55, er: 3, erSpan: 0.02, erG: 0.5 }, wet: 0.16, echo: 0.4, e: [0.48, 0.66, 0.22] },
};
const irCache = new Map();

// 換空間:新 IR 載入閒置的 convolver,輸入端交叉淡化(舊空間的殘響尾巴自然消失)
export function setSpace(key, now = false) {
  if (!SPACES[key]) key = 'corridor';
  A.space = key;
  if (!A.ctx) return;
  const S = SPACES[key], t = A.ctx.currentTime, tc = now ? 0.001 : 0.25;
  let slot = A.zr.findIndex((z) => z.key === key);
  if (slot < 0) {
    slot = 1 - A.zrCur;
    const z = A.zr[slot];
    if (!irCache.has(key) || irCache.get(key).sampleRate !== A.ctx.sampleRate) irCache.set(key, makeIR(A.ctx, S.ir));
    z.c.buffer = irCache.get(key);
    z.key = key;
  }
  A.zr.forEach((z, i) => z.g.gain.setTargetAtTime(i === slot ? S.wet : 0, t, tc));
  A.zrCur = slot;
  const E = A.echo, e = S.e || [0.25, 0.37, 0.3];
  E.in.gain.setTargetAtTime(S.echo, t, tc * 2);
  E.dl.delayTime.setTargetAtTime(e[0], t, now ? 0.001 : 0.6);
  E.dr.delayTime.setTargetAtTime(e[1], t, now ? 0.001 : 0.6);
  E.fl.gain.setTargetAtTime(e[2], t, tc);
  E.fr.gain.setTargetAtTime(e[2] * 0.9, t, tc);
}

// 回聲網路:左右兩條不同長度的延遲 + 回授 + 低通(每次反射越來越暗)
function makeEcho() {
  const ctx = A.ctx;
  const inG = gain(0);
  const lp = filter('lowpass', 2600, 0.5);
  const hp = filter('highpass', 160, 0.5, lp);
  inG.connect(hp);
  const out = gain(0.8, A.mix);
  const side = (pan, t) => {
    const d = ctx.createDelay(1.2);
    d.delayTime.value = t;
    const fb = gain(0.3);
    const damp = filter('lowpass', 2200, 0.5, fb);
    lp.connect(d);
    d.connect(damp);
    fb.connect(d);
    const p = ctx.createStereoPanner();
    p.pan.value = pan;
    d.connect(p);
    p.connect(out);
    return [d, fb];
  };
  const [dl, fl] = side(-0.55, 0.25), [dr, fr] = side(0.55, 0.37);
  return { in: inG, dl, dr, fl, fr };
}

// 噪音緩衝(粉紅/棕噪音頭尾交叉淡化,循環播放不爆點)
function noiseBuf(ctx, kind, secs = 4) {
  const sr = ctx.sampleRate, len = sr * secs;
  const b = ctx.createBuffer(1, len, sr);
  const d = b.getChannelData(0);
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, last = 0;
  for (let i = 0; i < len; i++) {
    const w = Math.random() * 2 - 1;
    if (kind === 'white') d[i] = w;
    else if (kind === 'pink') {
      b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.969 * b2 + w * 0.153852;
      b3 = 0.8665 * b3 + w * 0.3104856; b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
      d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
      b6 = w * 0.115926;
    } else {
      last = (last + 0.02 * w) / 1.02;
      d[i] = last * 3.5;
    }
  }
  if (kind !== 'white') {
    const n = Math.floor(sr * 0.25);
    for (let i = 0; i < n; i++) {
      const k = i / n;
      d[len - n + i] = d[len - n + i] * (1 - k) + d[i] * k;
    }
  }
  return b;
}

// 柔性飽和曲線(快取)
export function shaper(k, dest) {
  const ws = A.ctx.createWaveShaper();
  const key = k.toFixed(2);
  if (!A.curves[key]) {
    const n = 1024, c = new Float32Array(n), t = Math.tanh(k);
    for (let i = 0; i < n; i++) c[i] = Math.tanh(k * ((i / (n - 1)) * 2 - 1)) / t;
    A.curves[key] = c;
  }
  ws.curve = A.curves[key];
  ws.oversample = '2x';
  if (dest) ws.connect(dest);
  return ws;
}

// ---------- 聆聽者 ----------
export function setListener(x, y, z, yaw) {
  const L = A.L;
  L.x = x; L.y = y; L.z = z; L.yaw = yaw;
  if (!A.ctx) return;
  const l = A.ctx.listener, fx = -Math.sin(yaw), fz = -Math.cos(yaw);
  if (l.positionX) {
    l.positionX.value = x; l.positionY.value = y; l.positionZ.value = z;
    l.forwardX.value = fx; l.forwardY.value = 0; l.forwardZ.value = fz;
    l.upX.value = 0; l.upY.value = 1; l.upZ.value = 0;
  } else {
    l.setPosition(x, y, z);
    l.setOrientation(fx, 0, fz, 0, 1, 0);
  }
}

export function distTo(p) {
  const L = A.L;
  return Math.hypot(p.x - L.x, (p.y ?? 1.2) - L.y, p.z - L.z);
}

// 聆聽者附近的相對位置(驚嚇音沒給位置時用):ang 0 = 正前方,π = 正後方
export function around(dist, ang, dy = 0) {
  const L = A.L, a = L.yaw + ang;
  return { x: L.x - Math.sin(a) * dist, y: L.y + dy, z: L.z - Math.cos(a) * dist };
}

// ---------- 樓層、遮蔽、空氣吸收 ----------
const LEVEL_H = 4.2;
export function levelOf(y) {
  const w = A.world;
  if (w && w.levelAt) { try { return w.levelAt(y); } catch { /* 用預設 */ } }
  return Math.floor((y + 0.5) / LEVEL_H);
}

// 聆聽者到聲源有沒有視線(快取 150ms,量化到 0.5m)
function los(x, y, z) {
  const w = A.world, L = A.L, now = A.ctx.currentTime;
  const k = `${Math.round(x * 2)},${Math.round(y * 2)},${Math.round(z * 2)}|${Math.round(L.x * 2)},${Math.round(L.y * 2)},${Math.round(L.z * 2)}`;
  const c = A.losCache.get(k);
  if (c && now - c.t < 0.15) return c.v;
  let v = true;
  try { v = !!w.hasLineOfSight(L.x, L.y, L.z, x, y, z); } catch { v = true; }
  A.stats.los++;
  if (A.losCache.size > 400) A.losCache.clear();
  A.losCache.set(k, { t: now, v });
  return v;
}

// 回傳 { cut 低通頻率, g 直達聲增益, rv 殘響送出倍率 }
export function acoustics(px, py, pz, d) {
  let cut = 20000 / (1 + d * 0.17); // 空氣吸收 + 遠處繞射:10m ≈ 7kHz、30m ≈ 3.3kHz
  let g = 1, rv = 1;
  const fl = Math.abs(levelOf(py - 0.3) - levelOf(A.L.y - 1.65));
  let open = !fl;
  if (A.world && A.world.hasLineOfSight && d > 1.4) {
    const fy = levelOf(py - 0.3) * LEVEL_H; // 抬到離地 1.1m 再測,避免矮櫃台/欄杆把腳步聲整個擋掉
    open = los(px, Math.max(py, fy + 1.1), pz);
  }
  if (!open) {
    if (fl) { cut = Math.min(cut, 560 / fl); g = Math.pow(0.38, fl); rv = 0.5; } // 隔著樓板:只剩低頻
    else if (d < 4) { cut = Math.min(cut, 2600); g = 0.7; } // 轉角/門邊:繞射
    else { cut = Math.min(cut, 1250); g = 0.48; rv = 0.85; } // 隔牆
  }
  return { cut: Math.max(120, cut), g, rv, open };
}
const revDist = (d) => (0.75 + Math.min(1.3, d / 9)) / (1 + d * 0.07); // 擴散場:殘響量和距離關係不大

// ---------- 聲道條(重用) ----------
// 每類別預先(延遲)建立固定數量的聲道條:增益 → 低通(空氣吸收/遮蔽)→ panner → 遮蔽增益 → 匯流排,外加殘響/回聲送出。
// 每個聲音只建一個自己的增益節點接到聲道條上;聲道條滿了就依優先權/距離搶占。位置可即時跟隨移動中的聲源。
const POOLS = {
  voice: { max: 7, hrtf: true, bus: 'voice' }, // 殭屍語音
  step: { max: 8, hrtf: true, bus: 'sfx' }, // 腳步、拖行
  fx: { max: 14, hrtf: false, bus: 'sfx' }, // 其他定位音效
  gun: { max: 6, hrtf: false, bus: 'sfx', steal: true }, // 遠端玩家槍聲(新的一定要出聲)
  scare: { max: 3, hrtf: true, bus: 'scare' },
  amb: { max: 8, hrtf: true, bus: 'amb' }, // 環境中的定位事件(滴水、管線、烏鴉)
  loop: { max: 10, hrtf: false, bus: 'amb' }, // 定位循環音(發電機、電視)
};
export const poolInfo = () => Object.fromEntries(Object.entries(POOLS).map(([k, p]) => [k, `${p.strips.filter((s) => s.vg && s.end > A.ctx.currentTime).length}/${p.strips.length}/${p.max}`]));

function makeStrip(pool) {
  const ctx = A.ctx;
  const s = { pool, vg: null, end: 0, prio: 0, d: 0, src: null, upd: 0, room: 0, hall: 0, echo: 0 };
  s.in = gain(1);
  s.lp = filter('lowpass', 18000, 0.5);
  const p = (s.pan = ctx.createPanner());
  p.panningModel = pool.hrtf && A.hrtf !== false ? 'HRTF' : 'equalpower';
  p.distanceModel = 'inverse';
  p.maxDistance = 120;
  s.occ = gain(1, A.bus[pool.bus]);
  s.in.connect(s.lp);
  s.lp.connect(p);
  p.connect(s.occ);
  s.sr = gain(0, A.send.sfx.room);
  s.se = gain(0, A.send.sfx.echo);
  s.sh = gain(0, A.send.sfx.hall);
  s.in.connect(s.sr);
  s.in.connect(s.se);
  s.in.connect(s.sh);
  return s;
}

function release(s) {
  if (s.vg) { try { s.vg.disconnect(); } catch { /* 已斷 */ } }
  s.vg = null;
  s.src = null;
}

function fadeKill(g, n, len = 0.04) {
  g.gain.cancelScheduledValues(n);
  g.gain.setValueAtTime(g.gain.value, n);
  g.gain.linearRampToValueAtTime(0, n + len);
}

function grab(pool, prio, d, now) {
  let free = null;
  for (const s of pool.strips) if (!s.vg || s.end <= now) { free = s; break; }
  if (free) { release(free); return { s: free, late: 0 }; }
  if (pool.strips.length < pool.max) { const s = makeStrip(pool); pool.strips.push(s); return { s, late: 0 }; }
  let vic = null;
  for (const s of pool.strips) {
    if (pool.steal) { if (!vic || s.t0 < vic.t0) vic = s; } // 搶最舊的
    else if (!vic || s.prio < vic.prio || (s.prio === vic.prio && s.d > vic.d)) vic = s; // 先犧牲優先權低、其次最遠的
  }
  if (!pool.steal && (prio < vic.prio || (prio === vic.prio && d >= vic.d))) return null;
  const old = vic.vg;
  fadeKill(old, now);
  setTimeout(() => { try { old.disconnect(); } catch { /* 已斷 */ } }, 90);
  vic.vg = null;
  A.stats.stolen++;
  return { s: vic, late: 0.045 }; // 等舊聲音淡出再開始
}

// 更新聲道條的位置/濾波/遮蔽/殘響送出
function place(s, init, t0) {
  const p = s.src, ctx = A.ctx, t = t0 ?? ctx.currentTime;
  const py = p.y ?? 1.2;
  const d = Math.hypot(p.x - A.L.x, py - A.L.y, p.z - A.L.z);
  s.d = d;
  const ac = acoustics(p.x, py, p.z, d);
  const pan = s.pan;
  const set = init ? (prm, v) => prm.setValueAtTime(v, t) : (prm, v) => prm.setTargetAtTime(v, t, 0.06);
  if (pan.positionX) { set(pan.positionX, p.x); set(pan.positionY, py); set(pan.positionZ, p.z); } else pan.setPosition(p.x, py, p.z);
  set(s.lp.frequency, ac.cut);
  set(s.occ.gain, ac.g);
  const rv = revDist(d) * ac.rv;
  set(s.sr.gain, s.room * rv);
  set(s.se.gain, s.echo * rv);
  set(s.sh.gain, s.hall * rv);
}

// 發聲:回傳 h = { in(接到這裡), t(開始時間), d, end, kill() };被距離剔除或搶不到聲道條時回傳 null
export function emit(o = {}) {
  const ctx = A.ctx;
  if (!ctx) return null;
  const now = ctx.currentTime;
  const pos = o.pos && Number.isFinite(o.pos.x) && Number.isFinite(o.pos.z) ? o.pos : null;
  const delay = o.delay ?? 0, dur = o.dur ?? 1;
  let d = 0;
  if (pos) {
    d = distTo(pos);
    if (!(d <= (o.maxDist ?? 45))) { A.stats.culled++; return null; }
  }
  const vgN = gain(o.gain ?? 1);
  const h = {
    in: vgN, t: now + 0.006 + delay, d, end: now + delay + dur + 0.2,
    kill() { fadeKill(vgN, A.ctx.currentTime, 0.05); },
  };
  A.stats.emitted++;
  if (!pos) { // 非定位(玩家自己的聲音、介面):接到共用的固定送出聲道,每個聲音只多一個增益節点
    vgN.connect(selfStrip(o.bus ?? 'sfx', o.room ?? 0, o.echo ?? (o.room ? o.room * 0.7 : 0), o.hall ?? 0));
    setTimeout(() => vgN.disconnect(), (delay + dur + 2.5) * 1000);
    return h;
  }
  const pool = POOLS[o.cat] || POOLS.fx;
  const got = grab(pool, o.prio ?? 1, d, now);
  if (!got) { vgN.disconnect(); A.stats.culled++; return null; }
  const s = got.s;
  h.t += got.late;
  h.end += got.late;
  s.vg = vgN;
  s.end = h.end;
  s.t0 = now;
  s.prio = o.prio ?? 1;
  s.src = o.track === false ? { x: pos.x, y: pos.y, z: pos.z } : pos; // 預設跟著聲源物件移動(殭屍 vp 每幀就地更新)
  s.room = o.room ?? 0;
  s.hall = o.hall ?? 0;
  s.echo = o.echo ?? s.room * 0.7;
  s.pan.refDistance = o.ref ?? 1.5;
  s.pan.rolloffFactor = o.roll ?? 1.1;
  s.upd = now;
  place(s, true, now + got.late);
  vgN.connect(s.in);
  h.strip = s;
  return h;
}

// 非定位聲音共用的送出聲道(依匯流排與量化後的殘響/回聲/大廳送出量重用)
function selfStrip(bus, room, echo, hall) {
  const q = (x) => Math.round(x * 20) / 20;
  const k = `${bus}|${q(room)}|${q(echo)}|${q(hall)}`;
  let s = A.selfStrips.get(k);
  if (!s) {
    s = gain(1, A.bus[bus]);
    if (room) s.connect(gain(q(room), A.send.sfx.room));
    if (echo) s.connect(gain(q(echo), A.send.sfx.echo));
    if (hall) s.connect(gain(q(hall), A.send.sfx.hall));
    A.selfStrips.set(k, s);
  }
  return s;
}

// 50ms 排程:跟隨移動的聲源、輪流更新遮蔽(每條約 150ms 一次)、其他模組的 tick
let rr = 0;
export function tick() {
  const ctx = A.ctx;
  if (!ctx) return;
  const now = ctx.currentTime;
  let budget = 10; // 每次最多做 10 條的完整聲學更新(含視線查詢)
  for (const k in POOLS) {
    for (const s of POOLS[k].strips) {
      if (!s.vg) continue;
      if (s.end <= now) { release(s); continue; }
      if (now - s.upd > 0.15 && budget > 0) { budget--; s.upd = now; place(s, false); }
    }
  }
  rr++;
  for (const fn of ticks) { try { fn(now, rr); } catch (e) { if (import.meta.env?.DEV) console.warn('[audio tick]', e); } }
}

// ---------- 基本音源 ----------
// 噪音爆發:濾波器頻率可從 f 掃到 f1;包絡 = 線性起音 + (保持) + 指數衰減
export function burst(dest, t, o) {
  const ctx = A.ctx;
  const src = ctx.createBufferSource();
  src.buffer = A.noise[o.buf ?? 'white'];
  src.loop = true;
  const dur = o.dur ?? 0.1;
  const f = ctx.createBiquadFilter();
  f.type = o.type ?? 'bandpass';
  f.Q.value = o.q ?? 1;
  f.frequency.setValueAtTime(o.f ?? 1000, t);
  if (o.f1) f.frequency.exponentialRampToValueAtTime(Math.max(20, o.f1), t + (o.glide ?? dur));
  const g = ctx.createGain();
  const a = o.a ?? 0.001, hold = o.hold ?? 0;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(o.g ?? 1, t + a);
  if (hold) g.gain.setValueAtTime(o.g ?? 1, t + a + hold);
  g.gain.exponentialRampToValueAtTime(0.0001, t + a + hold + dur);
  src.connect(f);
  f.connect(g);
  g.connect(dest);
  src.start(t, Math.random() * 3);
  src.stop(t + a + hold + dur + 0.03);
  return { src, f, g };
}

// 振盪器音:可掃頻
export function tone(dest, t, o) {
  const ctx = A.ctx;
  const osc = ctx.createOscillator();
  if (o.wave) osc.setPeriodicWave(o.wave);
  else osc.type = o.type ?? 'sine';
  const dur = o.dur ?? 0.2;
  osc.frequency.setValueAtTime(o.f, t);
  if (o.f1) osc.frequency.exponentialRampToValueAtTime(Math.max(10, o.f1), t + (o.glide ?? dur));
  if (o.detune) osc.detune.value = o.detune;
  const g = ctx.createGain();
  const a = o.a ?? 0.002, hold = o.hold ?? 0;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(o.g ?? 1, t + a);
  if (hold) g.gain.setValueAtTime(o.g ?? 1, t + a + hold);
  g.gain.exponentialRampToValueAtTime(0.0001, t + a + hold + dur);
  osc.connect(g);
  g.connect(dest);
  osc.start(t);
  osc.stop(t + a + hold + dur + 0.03);
  return { osc, g };
}

// 金屬撞擊:非諧波分音
export function metal(dest, t, f, g, decay = 0.08, ratios = [1, 2.76, 5.4, 8.93]) {
  ratios.forEach((r, i) => {
    const fr = f * r * rand(0.99, 1.01);
    if (fr < 18000) tone(dest, t, { f: fr, dur: decay / (1 + i * 0.6), g: g / (1 + i * 0.9), a: 0.0005 }); // 超過可聽範圍的分音略過
  });
}

// 液體氣泡:正弦快速上滑
export function bubble(dest, t, f, g, len = 0.05) {
  tone(dest, t, { f, f1: f * rand(1.6, 2.3), glide: len * 0.7, dur: len, g, a: 0.003 });
}

// 播放 AudioBuffer(樣本或預烘焙的合成音):rate 音高倍率、off 起點、len 長度、fi/fo 淡入淡出
export function playBuf(dest, t, buf, o = {}) {
  const ctx = A.ctx;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.playbackRate.value = o.rate ?? 1;
  if (o.loop) { src.loop = true; if (o.ls != null) { src.loopStart = o.ls; src.loopEnd = o.le ?? buf.duration; } }
  let out = src;
  const g = o.g ?? 1;
  if (o.fi || o.fo || (o.len && o.len < buf.duration - 0.05) || Math.abs(g - 1) > 0.01) {
    const e = ctx.createGain();
    const len = o.len ?? (buf.duration - (o.off ?? 0)) / (o.rate ?? 1);
    e.gain.setValueAtTime(o.fi ? 0.0001 : g, t);
    if (o.fi) e.gain.linearRampToValueAtTime(g, t + o.fi);
    if (o.fo && !o.loop) { e.gain.setValueAtTime(g, t + Math.max(o.fi ?? 0, len - o.fo)); e.gain.linearRampToValueAtTime(0.0001, t + len); }
    src.connect(e);
    out = e;
  }
  out.connect(dest);
  src.start(t, o.off ?? 0);
  if (o.len && !o.loop) src.stop(t + o.len + 0.02);
  return { src, g: out };
}

// 把一段合成音預先渲染成 AudioBuffer(頻繁播放的短音效,執行期只剩一個 BufferSource)
export function bake(secs, fn, ch = 1) {
  const real = A.ctx;
  const oc = new OfflineAudioContext(ch, Math.ceil(secs * real.sampleRate), real.sampleRate);
  A.ctx = oc;
  try { fn(oc.destination, 0.002); } finally { A.ctx = real; }
  return oc.startRendering();
}
// 烘焙快取:key → n 個變體;第一次要用時在背景渲染,完成前回傳 null(呼叫端即時合成)。最多 120 組,超過丟最舊的
const BK = new Map();
let bakeCh = 0;
const chSec = (bs) => bs.reduce((s, b) => s + b.duration * b.numberOfChannels, 0);
export function baked(key, n, len, fn, ch = 1) {
  const v = BK.get(key);
  if (v !== undefined) return v || null;
  if (!A.ctx || A.noBake || typeof OfflineAudioContext === 'undefined') return null;
  BK.set(key, null);
  if (BK.size > 120) { const k0 = BK.keys().next().value, old = BK.get(k0); if (old) bakeCh -= chSec(old); BK.delete(k0); }
  Promise.all(Array.from({ length: n }, () => bake(len, fn, ch)))
    .then((b) => { if (BK.has(key)) { BK.set(key, b); bakeCh += chSec(b); } })
    .catch(() => BK.set(key, false));
  return null;
}
export const bakeStats = () => ({ sets: BK.size, chSec: +bakeCh.toFixed(1), mb: +((bakeCh * (A.ctx ? A.ctx.sampleRate : 48000) * 4) / 1048576).toFixed(1) });

// 音樂/環境暫時壓低
export function duck(depth = 0.55, release = 0.35) {
  if (!A.ctx) return;
  const n = A.ctx.currentTime;
  if (n - A.lastDuck < 0.06 && depth >= A.lastDepth) return; // 連射時不必每發重排自動化
  A.lastDuck = n;
  A.lastDepth = depth;
  for (const node of [A.duck, A.duckAmb, A.duckRev]) {
    const p = node.gain;
    if (p.cancelAndHoldAtTime) p.cancelAndHoldAtTime(n);
    else { p.cancelScheduledValues(n); p.setValueAtTime(p.value, n); }
    p.setTargetAtTime(node === A.duckAmb ? Math.min(1, depth + 0.2) : depth, n, 0.01);
    p.setTargetAtTime(1, n + 0.06, release);
  }
}

// 悶音(爆炸耳鳴、倒地):amount 0..1,hold 秒後恢復(Infinity = 直到 unmuffle)
export function muffle(amount, hold = 0.3, release = 2) {
  if (!A.ctx) return;
  const p = A.muffle.frequency, n = A.ctx.currentTime;
  const cut = 20000 * Math.pow(1 - clamp(amount, 0, 0.98), 2.6);
  if (p.cancelAndHoldAtTime) p.cancelAndHoldAtTime(n); else p.cancelScheduledValues(n);
  p.setTargetAtTime(Math.max(160, cut), n, 0.03);
  if (Number.isFinite(hold)) p.setTargetAtTime(20000, n + hold, release / 3);
}

// 隨機曲線(setValueCurveAtTime 用)
export function curve(n, fn) {
  const c = new Float32Array(n);
  for (let i = 0; i < n; i++) c[i] = fn(i / (n - 1), i);
  return c;
}
