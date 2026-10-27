// 腳步聲:9 種地面材質 × 走/跑,錄音樣本優先,否則用合成;合成版本第一次用到時預先烘焙成多個變體(執行期每步只剩 1~2 個節點)。
// 玩家自己的腳步走固定的左右腳聲道(重用節點,左右腳略微偏左/偏右);殭屍與遠端玩家的腳步是 3D 定位。
import { A, emit, burst, tone, metal, bubble, gain, rand, pick, playBuf, baked, bakeStats } from './core.js';
import { surfaceAt, surfaceHere } from './foley.js';
import * as S from './samples.js';

export const SURFACES = ['tile', 'concrete', 'metal', 'wood', 'carpet', 'grass', 'gravel', 'asphalt', 'water'];

// 單一步:d 輸出、t 起點、v 音量、sp 奔跑、r 音高、soft 0..1(赤腳/破布鞋的殭屍:鞋跟喀聲較少、拍擊較多)
const STEP = {
  tile(d, t, v, sp, r, soft = 0) {
    burst(d, t, { type: 'lowpass', f: 600 * r, f1: 150, dur: 0.05, g: v * (0.8 + soft * 0.4) });
    burst(d, t, { type: 'bandpass', f: 2400 * r, q: 2.2, dur: 0.014, g: v * 0.55 * (1 - soft * 0.8) }); // 鞋跟喀
    burst(d, t, { type: 'highpass', f: 5200, dur: 0.006, g: v * 0.22 * (1 - soft) });
    if (soft) burst(d, t + 0.004, { type: 'bandpass', f: 1300, q: 1.2, dur: 0.03, g: v * 0.4 * soft }); // 赤腳拍擊
    const tt = t + (sp ? 0.028 : 0.05) * rand(0.8, 1.2);
    burst(d, tt, { type: 'lowpass', f: 800 * r, dur: 0.035, g: v * 0.45 });
    burst(d, tt, { type: 'bandpass', f: 3100 * r, q: 2.5, dur: 0.01, g: v * 0.3 * (1 - soft) });
    if (!soft && Math.random() < 0.18) burst(d, tt + 0.01, { type: 'bandpass', f: rand(1900, 2700), q: 14, dur: 0.035, a: 0.01, g: v * 0.12 }); // 膠底吱
    if (Math.random() < 0.3) burst(d, t + 0.01, { type: 'highpass', f: 4200, dur: 0.06, a: 0.01, g: v * 0.12 }); // 地上的砂礫
    if (Math.random() < 0.06) for (let i = 0; i < 5; i++) burst(d, t + rand(0, 0.08), { type: 'bandpass', f: rand(4500, 7500), q: 6, dur: 0.01, g: v * 0.22 }); // 踩到碎玻璃
  },
  concrete(d, t, v, sp, r, soft = 0) {
    burst(d, t, { type: 'lowpass', f: 420 * r, f1: 130, dur: 0.07, g: v });
    burst(d, t, { type: 'bandpass', f: 1500 * r, q: 1.3, dur: 0.016, g: v * 0.35 * (1 - soft * 0.6) });
    const tt = t + (sp ? 0.03 : 0.055) * rand(0.8, 1.2);
    burst(d, tt, { type: 'lowpass', f: 600 * r, dur: 0.04, g: v * 0.45 });
    burst(d, tt, { type: 'bandpass', f: 1100 * r, f1: 700, q: 0.9, dur: 0.06, a: 0.01, g: v * 0.2 }); // 鞋底磨地
    burst(d, t + 0.005, { type: 'highpass', f: 3800, dur: 0.07, a: 0.01, g: v * 0.16 }); // 細砂
  },
  metal(d, t, v, sp, r, soft = 0) {
    burst(d, t, { type: 'lowpass', f: 350 * r, f1: 120, dur: 0.05, g: v * 0.7 });
    metal(d, t, rand(380, 520) * r, v * 0.2, 0.24, [1, 2.31, 3.92, 5.6]); // 鋼板共鳴
    metal(d, t, rand(1100, 1500), v * 0.09, 0.1, [1, 2.7, 4.4]);
    burst(d, t, { type: 'bandpass', f: 3200, q: 3, dur: 0.012, g: v * 0.3 * (1 - soft * 0.5) });
    const tt = t + (sp ? 0.03 : 0.05) * rand(0.8, 1.2);
    metal(d, tt, rand(600, 800), v * 0.1, 0.12);
    burst(d, tt, { type: 'lowpass', f: 500, dur: 0.03, g: v * 0.35 });
    for (let i = 0; i < 3; i++) burst(d, t + rand(0.02, 0.09), { type: 'bandpass', f: rand(2000, 3500), q: 6, dur: 0.008, g: v * 0.08 }); // 格柵震動
  },
  wood(d, t, v, sp, r, soft = 0) {
    burst(d, t, { type: 'lowpass', f: 300 * r, f1: 90, dur: 0.09, g: v });
    burst(d, t, { type: 'bandpass', f: 220 * r, q: 5, dur: 0.12, g: v * 0.45 }); // 中空的木地板
    burst(d, t, { type: 'bandpass', f: 950 * r, q: 2, dur: 0.025, g: v * 0.3 * (1 - soft * 0.5) });
    const tt = t + (sp ? 0.032 : 0.055) * rand(0.8, 1.2);
    burst(d, tt, { type: 'lowpass', f: 400, dur: 0.05, g: v * 0.5 });
    burst(d, tt, { type: 'bandpass', f: 260 * r, q: 5, dur: 0.08, g: v * 0.22 });
    if (Math.random() < (sp ? 0.08 : 0.15)) { // 老木板嘎吱
      const f = rand(480, 900);
      burst(d, t + 0.04, { type: 'bandpass', f, f1: f * rand(0.7, 1.3), q: 16, dur: 0.12, a: 0.1, g: v * 0.1 });
    }
  },
  carpet(d, t, v, sp, r) {
    burst(d, t, { type: 'lowpass', f: 260 * r, f1: 80, dur: 0.08, g: v * 0.8 });
    burst(d, t, { buf: 'pink', type: 'bandpass', f: 900, q: 0.6, dur: 0.06, a: 0.01, g: v * 0.12 }); // 絨毛摩擦
    burst(d, t + (sp ? 0.03 : 0.06), { type: 'lowpass', f: 300, dur: 0.05, g: v * 0.35 });
  },
  grass(d, t, v, sp, r) {
    burst(d, t, { type: 'lowpass', f: 220, dur: 0.06, g: v * 0.45 }); // 軟土
    burst(d, t, { buf: 'pink', type: 'bandpass', f: 3400 * r, f1: 2200, q: 0.7, dur: 0.14, a: 0.025, g: v * 0.42 }); // 葉片沙沙
    burst(d, t + 0.01, { buf: 'pink', type: 'highpass', f: 5500, dur: 0.1, a: 0.02, g: v * 0.12 });
    for (let i = 0; i < 3; i++) burst(d, t + rand(0.01, 0.1), { type: 'bandpass', f: rand(2000, 4500), q: 2, dur: 0.02, g: v * 0.06 }); // 小樹枝
    burst(d, t + (sp ? 0.05 : 0.09), { buf: 'pink', type: 'bandpass', f: 2600, q: 0.8, dur: 0.08, a: 0.02, g: v * 0.18 });
  },
  gravel(d, t, v, sp, r) {
    burst(d, t, { type: 'lowpass', f: 320, dur: 0.05, g: v * 0.45 });
    const n = sp ? 20 : 15, span = sp ? 0.1 : 0.15;
    for (let i = 0; i < n; i++) burst(d, t + Math.pow(Math.random(), 1.6) * span, { type: 'bandpass', f: rand(1800, 7000) * r, q: 3, dur: rand(0.005, 0.012), g: v * rand(0.08, 0.22) }); // 石粒互相摩擦
    burst(d, t, { buf: 'pink', type: 'bandpass', f: 2500, q: 0.8, dur: 0.1, a: 0.02, g: v * 0.15 });
    const tt = t + (sp ? 0.04 : 0.07);
    for (let i = 0; i < 7; i++) burst(d, tt + Math.random() * 0.06, { type: 'bandpass', f: rand(2500, 6500), q: 3, dur: 0.008, g: v * rand(0.05, 0.12) });
  },
  asphalt(d, t, v, sp, r, soft = 0) {
    burst(d, t, { type: 'lowpass', f: 480 * r, f1: 140, dur: 0.06, g: v * 0.9 });
    burst(d, t, { type: 'bandpass', f: 1900 * r, q: 1.2, dur: 0.015, g: v * 0.35 * (1 - soft * 0.6) });
    const tt = t + (sp ? 0.028 : 0.05) * rand(0.8, 1.2);
    burst(d, tt, { type: 'bandpass', f: 2600, q: 0.9, dur: 0.05, a: 0.008, g: v * 0.2 }); // 粗糙路面摩擦
    burst(d, tt, { type: 'lowpass', f: 650, dur: 0.035, g: v * 0.4 });
    burst(d, t + 0.01, { type: 'highpass', f: 4500, dur: 0.05, g: v * 0.12 });
  },
  water(d, t, v, sp, r) {
    burst(d, t, { type: 'lowpass', f: 1400 * r, f1: 300, dur: 0.1, g: v * 0.6 }); // 拍水
    burst(d, t + 0.01, { type: 'highpass', f: 1800, dur: 0.22, a: 0.015, g: v * 0.2 }); // 水花
    burst(d, t + 0.02, { type: 'bandpass', f: 600, q: 1, dur: 0.25, a: 0.04, g: v * 0.2 }); // 晃動
    for (let i = 0; i < 5; i++) bubble(d, t + rand(0, 0.25), rand(300, 1200), v * 0.08, rand(0.03, 0.06));
    const tt = t + (sp ? 0.1 : 0.16);
    burst(d, tt, { type: 'lowpass', f: 900, dur: 0.15, a: 0.03, g: v * 0.3 }); // 抬腳帶起的水
    for (let i = 0; i < 3; i++) bubble(d, tt + rand(0, 0.15), rand(400, 900), v * 0.06, 0.04);
  },
};

export const bakedStats = bakeStats;

// 玩家左右腳的固定聲道(重用)
let feet = null, side = 0;
function foot() {
  if (!feet || feet.ctx !== A.ctx) {
    const mk = (pan) => {
      const p = A.ctx.createStereoPanner();
      p.pan.value = pan;
      p.connect(A.bus.sfx);
      p.connect(gain(0.13, A.send.sfx.room));
      return p;
    };
    feet = { ctx: A.ctx, n: [mk(-0.12), mk(0.12)] };
  }
  side ^= 1;
  return feet.n[side];
}

// 玩家腳步
export function step(sprint = false, surface) {
  if (surface) A.surface = surface;
  const surf = STEP[surface] ? surface : surfaceHere();
  const ctx = A.ctx, t = ctx.currentTime + 0.005, d = foot();
  const v = (sprint ? 0.62 : 0.3) * rand(0.85, 1.12) * 1.9;
  const smp = S.buf(`step.${surf}`);
  if (smp) playBuf(d, t, smp, { rate: rand(0.94, 1.06) * (sprint ? 1.04 : 1), g: (S.BANK[`step.${surf}`].g ?? 1) * (sprint ? 1.6 : 1) * rand(0.85, 1.1) * 1.6 });
  else {
    const set = baked(`p|${surf}|${sprint ? 1 : 0}`, 6, surf === 'water' ? 0.6 : 0.45, (dst, t0) => STEP[surf](dst, t0, sprint ? 0.62 * 1.2 : 0.3 * 1.2, sprint, rand(0.9, 1.12)));
    if (set) playBuf(d, t, pick(set), { rate: rand(0.95, 1.05), g: v / (sprint ? 0.744 : 0.36) });
    else STEP[surf](d, t, v, sprint, rand(0.85, 1.2));
  }
  if (sprint) { // 衣物與裝備晃動
    burst(d, t, { buf: 'pink', type: 'bandpass', f: rand(1300, 2200), f1: rand(900, 1500), q: 0.8, dur: 0.07, a: 0.05, g: 0.04 });
    if (Math.random() < 0.3) metal(d, t + 0.02, rand(3000, 4500), 0.012, 0.05);
  }
}

// 遠端玩家腳步(3D)
export function remoteStep(pos, surface) {
  const surf = STEP[surface] ? surface : surfaceAt(pos);
  const h = emit({ pos, cat: 'step', prio: 2, room: 0.15, dur: 0.6, maxDist: 30, ref: 1.6, gain: 2.2 });
  if (!h) return;
  if (S.play(`step.${surf}`, { h, g: 1 })) return;
  const set = baked(`p|${surf}|0`, 6, surf === 'water' ? 0.6 : 0.45, (dst, t0) => STEP[surf](dst, t0, 0.36, false, rand(0.9, 1.12)));
  if (set) playBuf(h.in, h.t, pick(set), { rate: rand(0.95, 1.05) });
  else STEP[surf](h.in, h.t, 0.36, false, rand(0.85, 1.2));
}

// 殭屍腳步:各類型步態 × 地面材質
const ZT = { walker: 0.68, runner: 1.2, crawler: 1.1, bloater: 0.7, brute: 0.6 };
function zBody(d, t, type, surf, r) {
  if (type === 'runner') { // 快速赤腳拍擊
    burst(d, t, { type: 'lowpass', f: 900 * r, f1: 200, dur: 0.05, g: 1 });
    burst(d, t, { type: 'bandpass', f: 2200 * r, q: 1.5, dur: 0.015, g: 0.6 });
  } else if (type === 'bloater') { // 沉重、濕滑
    burst(d, t, { type: 'lowpass', f: 380 * r, f1: 90, dur: 0.12, g: 0.55 });
    burst(d, t + 0.02, { type: 'bandpass', f: 500, f1: 250, q: 4, dur: 0.12, g: 0.25 });
    bubble(d, t + 0.05, rand(200, 320), 0.08);
  } else if (type === 'brute') {
    burst(d, t, { type: 'lowpass', f: 300 * r, f1: 70, dur: 0.15, g: 0.7 });
    tone(d, t, { f: 70, f1: 40, dur: 0.15, g: 0.5 });
  } else if (type === 'crawler') { // 手掌拍地
    burst(d, t, { type: 'lowpass', f: 1200, f1: 300, dur: 0.05, g: 0.8 });
    burst(d, t + 0.01, { type: 'bandpass', f: 600, q: 3, dur: 0.06, g: 0.35 });
  } else { // 拖步:先拍再刮
    burst(d, t, { type: 'lowpass', f: 450 * r, f1: 140, dur: 0.07, g: 0.38 });
    burst(d, t + 0.04, { type: 'bandpass', f: 1500 * r, f1: 800, q: 1.2, dur: 0.18, a: 0.06, g: surf === 'carpet' ? 0.05 : 0.12 });
  }
  // 地面材質層(赤腳/破鞋版本)
  const sv = { walker: 0.12, runner: 0.25, crawler: 0.1, bloater: 0.16, brute: 0.35 }[type] ?? 0.12;
  if (surf !== 'tile' && surf !== 'concrete' && surf !== 'asphalt' && STEP[surf]) STEP[surf](d, t, sv, type === 'runner', r, 0.8);
}
export function zStep(type, pos, surface) {
  const surf = STEP[surface] ? surface : surfaceAt(pos);
  const h = emit({ pos, cat: 'step', room: 0.12, dur: 0.6, maxDist: 24, ref: 1.2, gain: 3.5 * (ZT[type] ?? 1) });
  if (!h) return;
  const r = rand(0.85, 1.15);
  const set = baked(`z|${type}|${surf}`, 3, 0.6, (dst, t0) => zBody(dst, t0, type, surf, rand(0.88, 1.12)));
  if (set) playBuf(h.in, h.t, pick(set), { rate: r });
  else zBody(h.in, h.t, type, surf, r);
}

// 測試/量測用:直接合成某材質的一步
export const _STEP = STEP;
