// 天氣:雨聲音床與雷聲(給 outdoor 代理的天氣系統呼叫)。
//
// sfx.setRain(level, outdoorFactor)
//   level 0..1 雨勢(0 = 停雨,0.3 毛毛雨,0.6 中雨,1 暴雨);outdoorFactor 0..1 聆聽者「在室外的程度」
//   (1 = 露天、0.5 = 門口/破窗旁、0 = 建築深處)。省略 outdoorFactor 時依目前區域是否戶外自動判斷。
//   可每幀呼叫(內部平滑、只在數值變化夠大時才排自動化);level 為 0 時 8 秒後拆掉節點。
//   室外:高頻嘶嘶 + 寬頻雨幕 + 地面/水窪的雨滴顆粒;室內:屋頂上悶悶的雨聲(低通)+ 偶爾窗上的雨滴。
// sfx.thunder(dist, delay)
//   dist 公尺(閃電距離,約 200~6000);請在閃電亮起的當下呼叫:聲音依聲速延遲 dist/343 秒到達(最多 8 秒),
//   也可用 delay(秒)指定延遲。近的雷有尖銳的霹靂聲 + 長滾雷,遠的只剩低沉悶雷;室內時再變悶。
import { A, onTick, emit, gain, filter, burst, tone, rand, clamp } from './core.js';
import * as S from './samples.js';

const R = { on: false, lvl: 0, out: 1, tl: 0, to: -1, nodes: null, offAt: 0, drop: 0 };

function noise(kind) {
  const s = A.ctx.createBufferSource();
  s.buffer = A.noise[kind];
  s.loop = true;
  s.start(A.ctx.currentTime, Math.random() * 3);
  return s;
}

// 雨滴顆粒緩衝(直接在 JS 產生,不用排程節點):室外 = 地面/水窪的密集滴答,室內 = 窗上稀疏的滴答。循環播放
function patter(kind) {
  const sr = 24000, len = sr * 3.1, b = A.ctx.createBuffer(1, len, sr), d = b.getChannelData(0);
  const n = kind === 'out' ? 260 : 40;
  for (let k = 0; k < n; k++) {
    const i0 = (Math.random() * len) | 0, a = (kind === 'out' ? rand(0.05, 0.3) : rand(0.03, 0.12)) * (Math.random() < 0.1 ? 2 : 1);
    if (kind === 'out' && Math.random() < 0.35) { // 水窪:短促上滑的正弦
      const f0 = rand(900, 2600), f1 = f0 * rand(1.5, 2.2), m = (sr * rand(0.02, 0.04)) | 0;
      let ph = 0;
      for (let i = 0; i < m && i0 + i < len; i++) { const u = i / m; ph += (2 * Math.PI * (f0 + (f1 - f0) * u)) / sr; d[i0 + i] += Math.sin(ph) * a * 0.5 * (1 - u) * (1 - u); }
    } else { // 雨滴打擊:衰減很快的噪音
      const m = (sr * rand(0.002, 0.007)) | 0;
      let y = 0;
      for (let i = 0; i < m && i0 + i < len; i++) { y += 0.5 * (Math.random() * 2 - 1 - y); d[i0 + i] += y * a * Math.exp(-i / (m * 0.3)); }
    }
  }
  const f = (sr * 0.05) | 0; // 頭尾交叉淡化
  for (let i = 0; i < f; i++) { const k = i / f; d[len - f + i] = d[len - f + i] * (1 - k) + d[i] * k; }
  return b;
}
function loopSrc(buf, rate, pan, dest) {
  const s = A.ctx.createBufferSource();
  s.buffer = buf; s.loop = true; s.playbackRate.value = rate;
  const p = A.ctx.createStereoPanner();
  p.pan.value = pan;
  s.connect(p); p.connect(dest);
  s.start(A.ctx.currentTime, Math.random() * 3);
  return s;
}

function build() {
  const ctx = A.ctx;
  const o = gain(0, A.bus.amb); // 總量
  const outG = gain(0, o), inG = gain(0, o);
  // 室外:嘶嘶(高頻)+ 雨幕(中頻)+ 低頻的雨打地面
  const n1 = noise('white'), n2 = noise('pink'), n3 = noise('brown');
  const hiss = filter('highpass', 3200, 0.5, gain(0.05, outG));
  n1.connect(hiss);
  const sheet = filter('bandpass', 1500, 0.45, gain(0.12, outG));
  n2.connect(sheet);
  const low = filter('lowpass', 420, 0.6, gain(0.16, outG));
  n3.connect(low);
  // 左右各一條延遲的雨幕,讓雨聲有寬度
  const wide = ctx.createStereoPanner();
  wide.pan.value = 0.6;
  const dl = ctx.createDelay(0.1);
  dl.delayTime.value = 0.023;
  n2.connect(dl);
  dl.connect(filter('bandpass', 2300, 0.5, gain(0.06, wide)));
  wide.connect(outG);
  // 雨滴顆粒:兩份不同速度、左右分開(不會聽出循環)
  const po = patter('out'), pin = patter('in');
  const pg = gain(0.9, outG);
  const s4 = loopSrc(po, 1, -0.5, pg), s5 = loopSrc(po, 0.93, 0.5, pg);
  // 室內:屋頂上的雨(只剩低頻)+ 窗上滴答
  const roof = filter('lowpass', 520, 0.7, gain(0.22, inG));
  n3.connect(roof);
  const roof2 = filter('bandpass', 260, 0.8, gain(0.08, inG));
  n2.connect(roof2);
  const s6 = loopSrc(pin, 1, rand(-0.6, 0.6), gain(0.5, inG));
  return { o, outG, inG, srcs: [n1, n2, n3, s4, s5, s6], sheet, pg };
}

function stop() {
  const N = R.nodes;
  if (!N) return;
  R.nodes = null;
  for (const s of N.srcs) { try { s.stop(); } catch { /* 已停 */ } }
  setTimeout(() => { try { N.o.disconnect(); } catch { /* 已斷 */ } }, 100);
}

// outdoorFactor 自動判斷:目前區域是戶外 → 1;否則看頭頂有沒有遮蔽
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
  if (R.lvl > 0.001 && !R.nodes) { R.nodes = build(); R.tl = 0; R.to = -1; }
  apply();
}

function apply() {
  const N = R.nodes;
  if (!N || !A.ctx) return;
  const n = A.ctx.currentTime, out = R.out >= 0 ? R.out : autoOut();
  if (Math.abs(R.lvl - R.tl) < 0.02 && Math.abs(out - R.to) < 0.03) return; // 變化太小不重排(可以每幀呼叫)
  R.tl = R.lvl; R.to = out;
  const l = R.lvl;
  N.o.gain.setTargetAtTime(Math.pow(l, 0.8) * 1.6, n, 1.2);
  N.outG.gain.setTargetAtTime(out, n, 0.6);
  N.inG.gain.setTargetAtTime((1 - out) * 0.8 + 0.1, n, 0.6);
  N.sheet.frequency.setTargetAtTime(1800 - l * 700, n, 2); // 雨越大越厚(中心頻率往下)
  N.pg.gain.setTargetAtTime(0.4 + l * 0.8, n, 1);
  R.offAt = l <= 0.001 ? n + 8 : 0;
}

// 自動判斷室內外、停雨後拆掉、門口/屋簷偶爾的滴水
onTick((now) => {
  if (!R.nodes) return;
  if (R.out < 0) apply(); // 自動判斷時跟著聆聽者位置更新
  if (R.offAt && now > R.offAt) { stop(); return; }
  const l = R.tl, out = R.to;
  if (out > 0.2 && out < 0.9 && l > 0.2 && Math.random() < 0.02 * l) S.play('amb.drip', { bus: 'amb', prio: 0, gain: 0.5, g: 0.6 });
});

export function thunder(dist = 1500, delay) {
  if (!A.ctx) return;
  const dd = clamp(+dist || 1500, 50, 12000);
  const dl = Number.isFinite(delay) ? clamp(delay, 0, 10) : Math.min(8, dd / 343);
  const near = clamp(1 - (dd - 250) / 1600, 0, 1); // 1 = 很近
  const ind = R.out >= 0 ? 1 - R.out : 1 - autoOut(); // 室內程度
  const len = 3.5 + (1 - near) * 3 + rand(0, 1.5);
  const h = emit({ bus: 'amb', prio: 5, room: 0.3, hall: 0.9, echo: 0.6, dur: len + 1, delay: dl, gain: (0.5 + near * 0.7) * (1 - ind * 0.45) });
  if (!h) return;
  const t = h.t;
  const lp = filter('lowpass', ind > 0.5 ? 420 : 900 + near * 6000, 0.6, h.in);
  if (near > 0.3) { // 霹靂:亮而尖的撕裂聲 + 衝擊
    burst(lp, t, { type: 'highpass', f: 1200, dur: 0.12, a: 0.004, g: 0.5 * near });
    burst(lp, t + 0.01, { buf: 'pink', type: 'bandpass', f: 2500, f1: 500, q: 0.6, dur: 0.6, a: 0.01, g: 0.45 * near });
    tone(lp, t, { f: 55, f1: 28, dur: 0.7, a: 0.005, g: 0.6 * near });
  }
  // 滾雷:錄音的遠處爆炸降很多音當核心 + 多段隨機的低頻轟鳴(左右分開,很寬)
  S.play('explosion.far', { h, g: 0.9, semi: -9 - rand(0, 4), at: near > 0.3 ? 0.15 : 0, p: 0 });
  tone(lp, t, { f: rand(32, 42), f1: 22, dur: len * 0.8, a: 0.3 + (1 - near) * 0.5, g: 0.35 });
  for (let i = 0; i < 6; i++) {
    const p = A.ctx.createStereoPanner();
    p.pan.value = rand(-0.9, 0.9);
    p.connect(lp);
    burst(p, t + rand(0.05, len * 0.6), { buf: 'brown', type: 'lowpass', f: rand(180, 420), f1: 60, dur: rand(0.8, 2), a: rand(0.1, 0.4), g: rand(0.15, 0.35) });
  }
  burst(lp, t + 0.1, { buf: 'brown', type: 'lowpass', f: 300, f1: 60, dur: len, a: 0.5, g: 0.3 });
}

export const rainState = () => ({ on: !!R.nodes, level: R.tl, out: R.to });
