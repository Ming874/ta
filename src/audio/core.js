// 音訊核心:AudioContext、混音匯流排、殘響、噪音緩衝、3D 定位與發聲數上限。
// 所有聲音都在 WebAudio 裡即時合成;沒有 AudioContext 時,外部呼叫一律安全地不做事。

export const A = {
  ctx: null,
  bus: {},
  L: { x: 0, y: 1.65, z: 0, yaw: 0 }, // 聆聽者(玩家)
};

export const rand = (a, b) => a + Math.random() * (b - a);
export const pick = (arr) => arr[(Math.random() * arr.length) | 0];
export const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);

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
export function attach(ctx) {
  A.ctx = ctx;
  const limiter = setParams(ctx.createDynamicsCompressor(), { threshold: -3, knee: 0, ratio: 20, attack: 0.001, release: 0.09 });
  const out = gain(0.92, ctx.destination);
  limiter.connect(out);
  const glue = setParams(ctx.createDynamicsCompressor(), { threshold: -10, knee: 8, ratio: 2, attack: 0.01, release: 0.2 });
  glue.connect(limiter);
  const master = gain(0.9, glue);
  A.master = master;
  A.bus.sfx = gain(1, master);
  A.bus.voice = gain(0.5, master);
  A.bus.ui = gain(0.75, master);
  // 音樂與環境另外經過 duck:開槍、爆炸時短暫壓低,讓槍聲清楚
  A.duck = gain(1, master);
  A.bus.music = gain(0.3, A.duck);
  A.bus.amb = gain(0.7, A.duck);
  // 殘響:room 給一般音效(磁磚走廊),hall 給遠處聲響與配樂
  A.room = ctx.createConvolver();
  A.room.buffer = makeIR(ctx, 1.5, 0.011, 0.5);
  A.room.connect(gain(0.5, master));
  A.hall = ctx.createConvolver();
  A.hall.buffer = makeIR(ctx, 4.5, 0.035, 0.82);
  A.hall.connect(gain(0.55, A.duck));
  A.noise = { white: noiseBuf(ctx, 'white'), pink: noiseBuf(ctx, 'pink'), brown: noiseBuf(ctx, 'brown') };
  A.curves = {};
  A.waves = {};
  A.recentPain = [];
  for (const k in POOL) POOL[k].list.length = 0;
  setListener(A.L.x, A.L.y, A.L.z, A.L.yaw);
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

// 走廊殘響脈衝:早期反射 + 越後面越暗的指數衰減
function makeIR(ctx, dur, pre, damp) {
  const sr = ctx.sampleRate, len = Math.floor(sr * dur);
  const b = ctx.createBuffer(2, len, sr);
  for (let ch = 0; ch < 2; ch++) {
    const d = b.getChannelData(ch);
    for (let k = 0; k < 16; k++) {
      const i = Math.floor((pre + Math.random() * 0.075) * sr);
      if (i < len) d[i] += (Math.random() < 0.5 ? -1 : 1) * (0.8 - k * 0.04);
    }
    let y = 0;
    for (let i = Math.floor(pre * sr); i < len; i++) {
      const u = i / len;
      const a = 0.92 - damp * u;
      y += a * (Math.random() * 2 - 1 - y);
      d[i] += y * Math.exp((-6.9 * i) / sr / dur) * 0.6;
    }
  }
  return b;
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

// ---------- 發聲器(含 3D、殘響送出、發聲數上限) ----------
// cat:voice(殭屍語音)/ step(腳步拖行)/ fx(其他定位音效)
const POOL = { voice: { max: 6, list: [] }, step: { max: 8, list: [] }, fx: { max: 14, list: [] } };

export function emit(o = {}) {
  const ctx = A.ctx;
  if (!ctx) return null;
  const now = ctx.currentTime;
  const pos = o.pos && Number.isFinite(o.pos.x) ? o.pos : null;
  const d = pos ? distTo(pos) : 0;
  if (pos && d > (o.maxDist ?? 45)) return null;
  const dur = o.dur ?? 1;
  const prio = o.prio ?? 1;
  let pool = null;
  if (o.cat) {
    pool = POOL[o.cat];
    pool.list = pool.list.filter((v) => v.end > now);
    if (pool.list.length >= pool.max) {
      // 先犧牲優先權最低、其次最遠的那一個
      let vic = null;
      for (const v of pool.list) if (!vic || v.prio < vic.prio || (v.prio === vic.prio && v.d > vic.d)) vic = v;
      if (prio < vic.prio || (prio === vic.prio && d >= vic.d)) return null;
      vic.h.kill();
      pool.list.splice(pool.list.indexOf(vic), 1);
    }
  }
  const input = gain(o.gain ?? 1);
  const nodes = [input];
  let tail = input;
  if (pos) {
    // 空氣吸收:越遠越悶
    const lp = filter('lowpass', Math.max(900, 19000 / (1 + d * 0.25)), 0.5);
    const p = ctx.createPanner();
    p.panningModel = o.hrtf ? 'HRTF' : 'equalpower';
    p.distanceModel = 'inverse';
    p.refDistance = o.ref ?? 1.5;
    p.rolloffFactor = o.roll ?? 1.1;
    p.maxDistance = 100;
    const py = pos.y ?? 1.2;
    if (p.positionX) { p.positionX.value = pos.x; p.positionY.value = py; p.positionZ.value = pos.z; } else p.setPosition(pos.x, py, pos.z);
    input.connect(lp);
    lp.connect(p);
    tail = p;
    nodes.push(lp, p);
  }
  tail.connect(A.bus[o.bus ?? 'sfx']);
  const far = pos ? 1 / (1 + d * 0.07) : 1;
  const near = pos ? 0.75 + Math.min(1.3, d / 9) : 1;
  if (o.room) { const s = gain(o.room * near * far, A.room); input.connect(s); nodes.push(s); }
  if (o.hall) { const s = gain(o.hall * near * far, A.hall); input.connect(s); nodes.push(s); }
  const h = {
    in: input,
    t: now + 0.006 + (o.delay ?? 0),
    d,
    end: now + (o.delay ?? 0) + dur + 0.2,
    kill() {
      const n = ctx.currentTime;
      input.gain.cancelScheduledValues(n);
      input.gain.setValueAtTime(input.gain.value, n);
      input.gain.linearRampToValueAtTime(0, n + 0.05);
    },
  };
  if (pool) pool.list.push({ h, d, prio, end: h.end });
  setTimeout(() => { for (const n of nodes) n.disconnect(); }, ((o.delay ?? 0) + dur + 2) * 1000);
  return h;
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
  if (o.f1) f.frequency.exponentialRampToValueAtTime(Math.max(20, o.f1), t + dur);
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

// 音樂/環境暫時壓低
export function duck(depth = 0.55, release = 0.35) {
  if (!A.ctx) return;
  const p = A.duck.gain, n = A.ctx.currentTime;
  if (p.cancelAndHoldAtTime) p.cancelAndHoldAtTime(n);
  else { p.cancelScheduledValues(n); p.setValueAtTime(p.value, n); }
  p.setTargetAtTime(depth, n, 0.01);
  p.setTargetAtTime(1, n + 0.06, release);
}

// 隨機曲線(setValueCurveAtTime 用)
export function curve(n, fn) {
  const c = new Float32Array(n);
  for (let i = 0; i < n; i++) c[i] = fn(i / (n - 1), i);
  return c;
}
