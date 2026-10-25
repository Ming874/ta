// 程式生成的恐怖配樂與環境音。
// 常駐層:低頻 drone、不和諧弦樂 cluster(顫音隨威脅升高)、日光燈嗡鳴、通風管風聲。
// 排程層(60ms lookahead):心跳、戰鬥打擊脈動(7/8 拍)、隨機事件(走音音樂盒、金屬刮擦、遠處撞擊、低語、驚嚇漸強)、滴水、遠處鐵門、遠處呻吟。
import { A, burst, tone, metal, bubble, gain, filter, rand, pick, clamp, curve } from './core.js';
import { vocal } from './voices.js';

const MOODS = {
  menu: { drone: 0.6, pad: 0.45, pulse: 0, amb: 0.9, ev: { box: 3, scrape: 1, boom: 1, whisper: 2, stinger: 0, cluster: 1 }, gap: [6, 12] },
  fight: { drone: 0.7, pad: 0.5, pulse: 0.4, amb: 0.65, ev: { box: 0.5, scrape: 2, boom: 2, whisper: 1, stinger: 1.5, cluster: 1 }, gap: [5, 11] },
  boss: { drone: 1, pad: 0.85, pulse: 1, amb: 0.45, ev: { box: 0, scrape: 2, boom: 2, whisper: 0, stinger: 2, cluster: 2 }, gap: [4, 8], tempo: 1.2 },
  break: { drone: 0.45, pad: 0.35, pulse: 0, amb: 1, ev: { box: 2, scrape: 1, boom: 1, whisper: 2, stinger: 0, cluster: 1 }, gap: [6, 13] },
  shop: { drone: 0.4, pad: 0.3, pulse: 0, amb: 1, ev: { box: 4, scrape: 0.5, boom: 0.5, whisper: 1, stinger: 0, cluster: 0.5 }, gap: [5, 10] },
  dead: { drone: 0.35, pad: 0, pulse: 0, amb: 0.5, ev: {}, gap: [99, 99] },
};

// 弦樂 cluster(以 D3 為根音的半音數)
const CLUSTERS = [[0, 1, 6, 7, 11], [-2, 0, 1, 5, 6], [0, 3, 4, 8, 13], [-1, 0, 5, 6, 10], [0, 1, 2, 7, 8], [-5, 0, 1, 6, 12]];
const ROOTS = [36.71, 34.65, 38.89, 32.7]; // D1 C#1 D#1 C1
const BOX = [0, 1, 3, 6, 7, 10, 12, 13]; // 音樂盒音階(含小二度、三全音)

const M = {
  started: false, mood: 'fight', moodSet: false, tension: 0, tTarget: 0, health: 0, pain: 0,
  nextBeat: 0, step: 0, bar: 0, nextHeart: 0, nextEvent: 0, nextDrip: 0, nextDoor: 0, nextMoan: 0, nextRetune: 0, nextSwell: 0, nextFlicker: 0,
  level: { drone: 0, pad: 0, pulse: 0, amb: 0 },
};

export function startMusic() {
  if (M.started || !A.ctx) return;
  M.started = true;
  const ctx = A.ctx, now = ctx.currentTime;
  const mus = A.bus.music;
  M.hallSend = gain(0.5, A.hall);

  // ---- drone ----
  M.droneOut = gain(0, mus);
  M.droneOut.connect(gain(0.35, A.hall));
  const dlp = filter('lowpass', 170, 2.5, M.droneOut);
  const dl = ctx.createOscillator();
  dl.frequency.value = 0.043;
  dl.connect(gain(80, dlp.frequency));
  dl.start();
  const breath = gain(0.75, dlp);
  const bl = ctx.createOscillator();
  bl.frequency.value = 0.071;
  bl.connect(gain(0.22, breath.gain));
  bl.start();
  M.drone = [];
  const root = ROOTS[0];
  [['sawtooth', 1, 0.16], ['sawtooth', 1.0068, 0.16], ['triangle', 2.12, 0.12], ['sine', 1, 0.18], ['sawtooth', 1.498, 0.06]].forEach(([type, r, g]) => {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = root * r;
    o.connect(gain(g, breath));
    o.start();
    M.drone.push({ o, r });
  });

  // ---- 弦樂 cluster ----
  M.padOut = gain(0, mus);
  M.padOut.connect(gain(0.6, A.hall));
  M.padSwell = gain(0.6, M.padOut);
  M.padLp = filter('lowpass', 1000, 0.8, M.padSwell);
  M.trem = ctx.createOscillator();
  M.trem.frequency.value = 5;
  M.tremDepth = gain(0.08);
  M.trem.connect(M.tremDepth);
  M.trem.start();
  const vib = ctx.createOscillator();
  vib.frequency.value = 4.7;
  const vibD = gain(7, null);
  vib.connect(vibD);
  vib.start();
  M.pad = CLUSTERS[0].map((st, i) => {
    const tg = gain(0.8, null);
    M.tremDepth.connect(tg.gain);
    const pan = ctx.createStereoPanner();
    pan.pan.value = -0.7 + (1.4 * i) / 4;
    tg.connect(pan);
    pan.connect(M.padLp);
    const f = 146.83 * Math.pow(2, st / 12);
    const oscs = [-6, 6].map((c) => {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = f;
      o.detune.value = c + rand(-3, 3);
      vibD.connect(o.detune);
      o.connect(gain(0.045, tg));
      o.start();
      return o;
    });
    return { oscs };
  });

  // ---- 環境:日光燈嗡鳴、通風風聲 ----
  M.ambOut = gain(0, A.bus.amb);
  const hum = ctx.createOscillator();
  hum.type = 'sawtooth';
  hum.frequency.value = 120;
  M.humG = gain(0.012);
  hum.connect(filter('bandpass', 240, 3, filter('highpass', 180, 0.7, M.humG)));
  M.humG.connect(M.ambOut);
  hum.start();
  const wind = ctx.createBufferSource();
  wind.buffer = A.noise.brown;
  wind.loop = true;
  const wlp = filter('lowpass', 420, 0.8);
  const wl = ctx.createOscillator();
  wl.frequency.value = 0.06;
  wl.connect(gain(220, wlp.frequency));
  wl.start();
  wind.connect(wlp);
  const duct = filter('peaking', 190, 4);
  duct.gain.value = 8;
  wlp.connect(duct);
  M.windG = gain(0.06, M.ambOut);
  duct.connect(M.windG);
  wind.start();

  const t = now + 0.5;
  Object.assign(M, { nextBeat: t, nextHeart: t, nextEvent: t + rand(3, 6), nextDrip: t + 1, nextDoor: t + rand(20, 40), nextMoan: t + rand(8, 18), nextRetune: t + rand(20, 35), nextSwell: t + 2, nextFlicker: t + rand(6, 14) });
  applyMood(2.5);
  M.timer = setInterval(tick, 60);
}

function applyMood(tc = 2) {
  if (!M.started) return;
  const m = MOODS[M.mood] || MOODS.fight;
  const n = A.ctx.currentTime;
  M.droneOut.gain.setTargetAtTime(m.drone * 0.3, n, tc);
  M.padOut.gain.setTargetAtTime(m.pad * 1.6, n, tc);
  M.ambOut.gain.setTargetAtTime(m.amb, n, tc);
}

export function setMood(mood) {
  if (!MOODS[mood]) return;
  M.moodSet = true;
  if (mood === M.mood) return;
  const prev = M.mood;
  M.mood = mood;
  if (!M.started) return;
  applyMood(mood === 'dead' ? 0.6 : 2);
  const n = A.ctx.currentTime;
  if (mood === 'dead') deathChord(n + 0.05);
  else if (prev === 'dead') M.drone.forEach((x) => x.o.frequency.setTargetAtTime(ROOTS[0] * x.r, n, 2));
  if (mood === 'boss' && prev !== 'boss') stinger(n + 0.05, 1.4);
  M.nextEvent = Math.min(M.nextEvent, n + rand(2, 4));
}

// 回合開始/結束時的預設氣氛(主線程若有明確 setMood 則以它為準)
export function autoMood(mood) {
  if (M.mood === 'boss' && mood === 'fight') return;
  const keep = M.moodSet;
  setMood(mood);
  M.moodSet = keep;
}

export function setTension(x) { M.tTarget = clamp(+x || 0, 0, 1); }
export function setHealth(r) { M.health = clamp((0.45 - r) / 0.45, 0, 1); }
export function addPain(v) { M.pain = Math.min(1, M.pain + v); }

// ---------- 排程 ----------
function tick() {
  const ctx = A.ctx;
  if (!ctx || ctx.state !== 'running') return;
  const t = ctx.currentTime, ahead = t + 0.2;
  const m = MOODS[M.mood] || MOODS.fight;
  M.tension += (M.tTarget - M.tension) * 0.08;
  M.pain = Math.max(0, M.pain - 0.018);
  const T = M.tension;

  // 弦樂顫音與亮度隨威脅
  M.trem.frequency.setTargetAtTime(4 + T * 6 + (M.mood === 'boss' ? 2 : 0), t, 0.5);
  M.tremDepth.gain.setTargetAtTime(0.05 + T * 0.45, t, 0.5);
  M.padLp.frequency.setTargetAtTime(800 + T * 1700 + (M.mood === 'boss' ? 600 : 0), t, 0.8);
  M.droneOut.gain.setTargetAtTime(m.drone * 0.3 * (1 + T * 0.4), t, 1.5);

  // 弦樂起伏
  if (t > M.nextSwell) {
    M.padSwell.gain.setTargetAtTime(rand(0.25, 1), t, rand(2, 4));
    M.nextSwell = t + rand(5, 12);
  }
  // 慢慢換 cluster 與 drone 根音
  if (t > M.nextRetune) {
    const cl = pick(CLUSTERS);
    M.pad.forEach((v, i) => v.oscs.forEach((o) => o.frequency.setTargetAtTime(146.83 * Math.pow(2, cl[i] / 12), t, rand(2, 4))));
    if (Math.random() < 0.5) { const r = pick(ROOTS); M.drone.forEach((d) => d.o.frequency.setTargetAtTime(r * d.r, t, 5)); }
    M.nextRetune = t + rand(18, 40);
  }

  // 心跳:低血量、剛受傷、威脅很高時
  const hb = Math.max(M.health, M.pain * 0.8, Math.max(0, T - 0.55) * 1.4);
  if (hb > 0.05) {
    if (M.nextHeart < t) M.nextHeart = t + 0.05;
    while (M.nextHeart < ahead) { heart(M.nextHeart, hb); M.nextHeart += 60 / (62 + hb * 72); }
  } else M.nextHeart = t;

  // 戰鬥脈動
  const pl = M.mood === 'boss' ? 1 : m.pulse > 0 ? m.pulse * (0.45 + T * 0.9) : 0;
  const eighth = 60 / (96 * (m.tempo || 1)) / 2;
  if (pl > 0.02) {
    if (M.nextBeat < t) M.nextBeat = t + 0.05;
    while (M.nextBeat < ahead) { beat(M.nextBeat, M.step, pl); M.nextBeat += eighth; M.step = (M.step + 1) % 7; if (!M.step) M.bar++; }
  } else M.nextBeat = t;

  // 隨機事件
  if (t > M.nextEvent) {
    const ev = m.ev, keys = Object.keys(ev), tot = keys.reduce((s, k) => s + ev[k], 0);
    if (tot > 0) {
      let r = Math.random() * tot, k = keys[0];
      for (const kk of keys) { r -= ev[kk]; if (r <= 0) { k = kk; break; } }
      EVENTS[k](t + 0.05);
    }
    M.nextEvent = t + rand(m.gap[0], m.gap[1]) * (1 - T * 0.3);
  }

  // 環境
  if (M.mood !== 'dead') {
    if (t > M.nextDrip) { drip(t + 0.02); M.nextDrip = t + rand(1.2, 5.5); }
    if (t > M.nextDoor) { door(t + 0.05); M.nextDoor = t + rand(35, 80); }
    if (t > M.nextMoan) { farMoan(t + 0.05); M.nextMoan = t + rand(14, 35); }
    if (t > M.nextFlicker) { flicker(t); M.nextFlicker = t + rand(8, 22); }
  }
}

// ---------- 樂器 ----------
function out(bus = 'music', hall = 0.5, pan = 0) {
  const g = gain(1, A.bus[bus]);
  if (hall) g.connect(gain(hall, A.hall));
  if (!pan) return g;
  const p = A.ctx.createStereoPanner();
  p.pan.value = pan;
  p.connect(g);
  return p;
}

function heart(t, v) {
  const d = gain(1, A.bus.sfx);
  tone(d, t, { f: 58, f1: 40, dur: 0.16, g: 0.34 * v });
  burst(d, t, { type: 'lowpass', f: 130, dur: 0.09, g: 0.2 * v });
  tone(d, t + 0.27, { f: 52, f1: 36, dur: 0.14, g: 0.24 * v });
  setTimeout(() => d.disconnect(), 2000);
}

function beat(t, s, v) {
  const d = out('music', 0.35);
  const boss = M.mood === 'boss';
  const accent = s === 0 ? 1 : s === 2 || s === 4 ? 0.7 : 0;
  if (accent) { // 低沉太鼓
    tone(d, t, { f: 78, f1: 38, dur: 0.38, g: 0.26 * v * accent });
    burst(d, t, { type: 'lowpass', f: 220, f1: 70, dur: 0.18, g: 0.16 * v * accent });
    burst(d, t, { type: 'bandpass', f: 320, f1: 180, q: 1.5, dur: 0.12, g: 0.14 * v * accent }); // 鼓皮
  }
  if (s === 6 && Math.random() < M.tension) tone(d, t, { f: 70, f1: 36, dur: 0.3, g: 0.3 * v });
  // 時鐘般的金屬滴答
  burst(d, t, { type: 'bandpass', f: s % 2 ? 6800 : 5200, q: 6, dur: 0.025, g: 0.03 * v * (0.4 + M.tension) });
  if (boss) {
    if (s === 1 || s === 3 || s === 5) tone(d, t, { f: 55, f1: 32, dur: 0.22, g: 0.25 * v });
    if (s === 0 && M.bar % 2 === 0) brass(t, 1.6, 0.06);
    if (s === 3 && Math.random() < 0.3) metal(d, t, rand(900, 1300), 0.03, 0.5, [1, 2.4, 3.9]);
  }
  setTimeout(() => d.disconnect(), 3000);
}

// 低音銅管般的不和諧和弦
function brass(t, dur, g) {
  const d = out('music', 0.5);
  const lp = filter('lowpass', 200, 2, d);
  lp.frequency.setValueAtTime(200, t);
  lp.frequency.exponentialRampToValueAtTime(900, t + dur * 0.3);
  lp.frequency.exponentialRampToValueAtTime(220, t + dur);
  for (const f of [73.42, 77.78, 103.83, 146.83]) tone(lp, t, { type: 'sawtooth', f: f * rand(0.996, 1.004), dur, a: dur * 0.25, g });
  setTimeout(() => d.disconnect(), (dur + 4) * 1000);
}

function stinger(t, dur = 2.5) {
  // 反向漸強後驟停
  const d = out('music', 0.4);
  const g = gain(0, d);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.5, t + dur);
  g.gain.linearRampToValueAtTime(0, t + dur + 0.04);
  const lp = filter('lowpass', 400, 1.5, g);
  lp.frequency.setValueAtTime(400, t);
  lp.frequency.exponentialRampToValueAtTime(4000, t + dur);
  const base = pick([146.83, 155.56, 138.59]);
  for (const st of [0, 1, 6, 11, 13]) {
    const o = A.ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(base * Math.pow(2, st / 12), t);
    o.frequency.linearRampToValueAtTime(base * Math.pow(2, (st + 0.6) / 12), t + dur);
    o.connect(gain(0.12, lp));
    o.start(t);
    o.stop(t + dur + 0.1);
  }
  burst(g, t, { type: 'bandpass', f: 800, f1: 6000, q: 2, dur: 0.05, a: dur, g: 0.4 });
  // 驟停後的撞擊
  tone(out('music', 0.8), t + dur, { f: 60, f1: 28, dur: 1.4, g: 0.35 });
  setTimeout(() => d.disconnect(), (dur + 4) * 1000);
}

function deathChord(t) {
  const d = out('music', 0.7);
  const lp = filter('lowpass', 2500, 1, d);
  lp.frequency.setValueAtTime(2500, t);
  lp.frequency.exponentialRampToValueAtTime(150, t + 6);
  for (const st of [0, 1, 5, 6, 11, 12]) {
    const o = A.ctx.createOscillator();
    o.type = 'sawtooth';
    const f = 146.83 * Math.pow(2, st / 12);
    o.frequency.setValueAtTime(f, t);
    o.frequency.exponentialRampToValueAtTime(f * 0.5, t + 6);
    const g = gain(0, lp);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.07, t + 0.4);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 7);
    o.connect(g);
    o.start(t);
    o.stop(t + 7.1);
  }
  tone(d, t, { f: 50, f1: 22, dur: 4, g: 0.6 });
  burst(d, t, { buf: 'brown', type: 'lowpass', f: 200, f1: 40, dur: 3, g: 0.5 });
  M.drone.forEach((x) => x.o.frequency.setTargetAtTime(ROOTS[3] * x.r * 0.75, t, 3));
  setTimeout(() => d.disconnect(), 9000);
}

const EVENTS = {
  // 走音、越轉越慢的音樂盒
  box(t) {
    const d = out('music', 0.7, rand(-0.6, 0.6));
    const n = 4 + ((Math.random() * 6) | 0);
    let tt = t, gap = rand(0.32, 0.45), sag = 1;
    const base = pick([587.33, 523.25, 622.25]);
    for (let i = 0; i < n; i++) {
      const f = base * Math.pow(2, pick(BOX) / 12) * sag * rand(0.985, 1.015);
      tone(d, tt, { f, dur: 1.2, a: 0.002, g: 0.05 });
      tone(d, tt, { f: f * 3.98, dur: 0.35, a: 0.001, g: 0.018 });
      tone(d, tt, { f: f * 6.3, dur: 0.12, a: 0.001, g: 0.01 });
      tt += gap;
      gap *= rand(1.04, 1.14); // 發條快沒了
      sag *= rand(0.99, 0.998);
    }
    setTimeout(() => d.disconnect(), (tt - t + 3) * 1000);
  },
  // 金屬刮擦(像有人拖著鐵床)
  scrape(t) {
    const d = out('music', 0.8, rand(-0.8, 0.8));
    const dur = rand(1.6, 3);
    const f0 = rand(900, 1500);
    for (const r of [1, 1.47]) {
      const b = burst(d, t, { type: 'bandpass', f: f0 * r, f1: f0 * r * rand(0.55, 0.8), q: 28, dur: dur * 0.5, a: dur * 0.5, g: 0.35 });
      b.f.Q.value = 30;
    }
    burst(d, t, { buf: 'pink', type: 'bandpass', f: 600, q: 1, dur: dur * 0.6, a: dur * 0.4, g: 0.03 });
    setTimeout(() => d.disconnect(), (dur + 5) * 1000);
  },
  // 遠處撞擊
  boom(t) {
    const d = out('amb', 1.2, rand(-0.7, 0.7));
    const lp = filter('lowpass', 500, 0.7, d);
    tone(lp, t, { f: rand(40, 55), f1: 25, dur: 1.4, g: 0.35 });
    burst(lp, t, { buf: 'brown', type: 'lowpass', f: 220, f1: 50, dur: 1, g: 0.35 });
    if (Math.random() < 0.5) metal(lp, t + 0.02, rand(180, 320), 0.05, 1.2, [1, 2.3, 3.7]);
    setTimeout(() => d.disconnect(), 6000);
  },
  // 低語般的氣聲
  whisper(t) {
    const d = out('music', 0.9, rand(-0.9, 0.9));
    const dur = rand(1.5, 2.6);
    const g = gain(0, d);
    g.gain.setValueCurveAtTime(curve(64, (u) => 0.18 * Math.sin(Math.PI * u) * (0.4 + 0.6 * Math.abs(Math.sin(u * rand(8, 14))))), t, dur);
    const src = A.ctx.createBufferSource();
    src.buffer = A.noise.pink;
    src.loop = true;
    for (const [f, q] of [[pick([700, 500, 300]), 8], [pick([1100, 1800, 2300]), 10], [2600, 12]]) {
      const bp = filter('bandpass', f, q, g);
      bp.frequency.linearRampToValueAtTime(f * rand(0.8, 1.2), t + dur);
      src.connect(bp);
    }
    src.start(t, Math.random() * 3);
    src.stop(t + dur + 0.1);
    setTimeout(() => d.disconnect(), (dur + 5) * 1000);
  },
  stinger(t) { stinger(t, rand(1.8, 3)); },
  // 低音鋼琴般的小二度和弦
  cluster(t) {
    const d = out('music', 0.8);
    const base = pick([73.42, 65.41, 69.3]);
    for (const st of [0, 1, 6, 12]) {
      const f = base * Math.pow(2, st / 12);
      tone(d, t, { type: 'triangle', f, dur: 4, a: 0.004, g: 0.08 });
      tone(d, t, { f: f * 2.01, dur: 2, a: 0.004, g: 0.03 });
    }
    setTimeout(() => d.disconnect(), 8000);
  },
};

function drip(t) {
  const d = out('amb', 0.9, rand(-1, 1));
  const f = rand(900, 1800);
  bubble(d, t, f, 0.06, 0.05);
  if (Math.random() < 0.5) bubble(d, t + rand(0.08, 0.2), f * rand(1.1, 1.4), 0.025, 0.04);
  setTimeout(() => d.disconnect(), 4000);
}

function door(t) {
  // 遠處鐵門:吱嘎(黏滑摩擦)→ 碰撞
  const d = out('amb', 1.3, rand(-0.8, 0.8));
  const lp = filter('lowpass', 1800, 0.7, d);
  const dur = rand(0.9, 1.6);
  const b = burst(lp, t, { type: 'bandpass', f: rand(380, 520), f1: rand(250, 700), q: 14, dur: dur * 0.5, a: dur * 0.5, g: 0.25 });
  b.g.gain.cancelScheduledValues(t);
  b.g.gain.setValueCurveAtTime(curve(128, (u) => 0.22 * Math.sin(Math.PI * u) * (0.5 + 0.5 * Math.sin(u * dur * rand(25, 45)))), t, dur);
  const tt = t + dur + rand(0.1, 0.6);
  tone(lp, tt, { f: 70, f1: 30, dur: 0.8, g: 0.35 });
  burst(lp, tt, { type: 'lowpass', f: 900, f1: 120, dur: 0.5, g: 0.35 });
  metal(lp, tt, rand(220, 340), 0.07, 0.9, [1, 1.8, 2.9, 4.2]);
  setTimeout(() => d.disconnect(), (dur + 6) * 1000);
}

function farMoan(t) {
  const d = out('amb', 1.5, rand(-1, 1));
  const lp = filter('lowpass', 900, 0.7, d);
  vocal(lp, t, {
    mode: 'groan', f0: rand(65, 95), dur: rand(1.8, 3), fs: rand(0.9, 1.05), q: 6, vows: [pick(['uh', 'o']), pick(['o', 'u']), 'u'],
    breath: 0.3, fryRate: rand(18, 30), fryD: 0.5, sub: 0.1, drive: 2, lp: 1500, gurgle: 0.1, gain: 0.11, jit: 0.05, wob: 0.04, att: 0.4, rel: 0.8, k: 1,
  });
  setTimeout(() => d.disconnect(), 8000);
}

function flicker(t) {
  // 日光燈閃爍時的劈啪嗡聲
  const d = out('amb', 0.2, rand(-0.5, 0.5));
  const dur = rand(0.3, 0.9);
  const o = A.ctx.createOscillator();
  o.type = 'square';
  o.frequency.value = 120;
  const g = gain(0, filter('bandpass', 1800, 1.5, d));
  g.gain.setValueCurveAtTime(curve(48, () => (Math.random() < 0.45 ? 0.03 : 0)), t, dur);
  o.connect(g);
  o.start(t);
  o.stop(t + dur + 0.05);
  setTimeout(() => d.disconnect(), 3000);
}
