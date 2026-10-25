// 擬音:槍聲(分層)、換彈步驟、玩家、命中、介面、殭屍動作。
import { A, emit, burst, tone, metal, bubble, shaper, gain, filter, rand, pick, curve, duck } from './core.js';
import { grunt } from './voices.js';

// ---------- 小積木 ----------
// 機械小 click
function click(d, t, f, g) {
  burst(d, t, { type: 'bandpass', f, q: 6, dur: 0.008, g });
  burst(d, t + 0.002, { type: 'bandpass', f: f * 0.55, q: 3, dur: 0.018, g: g * 0.6 });
}
// 金屬卡榫/撞擊
function clack(d, t, f, g) {
  burst(d, t, { type: 'highpass', f: 1600, dur: 0.018, g: g * 0.8 });
  burst(d, t, { type: 'bandpass', f, q: 3.5, dur: 0.05, g });
  tone(d, t, { f: f * 0.18, f1: f * 0.09, dur: 0.05, g: g * 0.5 });
  metal(d, t + 0.001, f * 1.7, g * 0.22, 0.07);
}
// 摩擦滑動
function slide(d, t, f0, f1, dur, g) {
  burst(d, t, { type: 'bandpass', f: f0, f1, q: 2.2, dur: dur * 0.6, a: dur * 0.4, g });
}
// 彈匣/零件掉在磁磚上
function rattle(d, t, kind, g) {
  const f = kind === 'metal' ? 2300 : kind === 'alu' ? 3100 : 1500;
  let tt = t, gg = g;
  for (let i = 0; i < 4; i++) {
    burst(d, tt, { type: 'bandpass', f: f * rand(0.85, 1.15), q: 3, dur: 0.04, g: gg });
    burst(d, tt, { type: 'lowpass', f: 600, dur: 0.05, g: gg * 0.5 });
    if (kind !== 'plastic') metal(d, tt, f * rand(0.9, 1.3), gg * 0.25, 0.09);
    tt += rand(0.06, 0.12) * (1 - i * 0.2);
    gg *= 0.55;
  }
}
// 衣物摩擦
function cloth(d, t, dur, g) {
  burst(d, t, { buf: 'pink', type: 'bandpass', f: rand(1300, 2200), f1: rand(900, 1500), q: 0.8, dur: dur * 0.6, a: dur * 0.4, g });
}
// 黃銅彈殼叮噹(落地彈跳)
function casing(d, t, f, g, bounces = 3) {
  let tt = t, gg = g, gap = rand(0.08, 0.11);
  for (let i = 0; i < bounces; i++) {
    metal(d, tt, f * rand(0.94, 1.06), gg, 0.09 - i * 0.015, [1, 2.71, 4.93, 7.6]);
    burst(d, tt, { type: 'highpass', f: 5000, dur: 0.006, g: gg * 0.6 });
    tt += gap;
    gap *= rand(0.55, 0.7);
    gg *= 0.5;
  }
}

// ---------- 槍聲 ----------
const GUN = {
  pistol: { out: 0.62, vol: 0.62, crack: 4400, body: 1350, bq: 1.4, thump: 160, thumpEnd: 50, tdur: 0.11, bdur: 0.14, room: 0.55, hall: 0.18, mech: 2700, slide: 2500, casing: 4100, sharp: 1, drive: 3 },
  revolver: { out: 0.56, vol: 0.95, crack: 3000, body: 820, bq: 1.1, thump: 92, thumpEnd: 33, tdur: 0.26, bdur: 0.34, room: 0.8, hall: 0.45, mech: 1900, ring: 3600, sharp: 1.35, drive: 4 },
  ak47: { out: 0.52, vol: 0.86, crack: 3300, body: 650, bq: 1.6, thump: 86, thumpEnd: 36, tdur: 0.16, bdur: 0.23, room: 0.65, hall: 0.32, mech: 1500, bolt: 1150, casing: 2700, sharp: 1.15, drive: 4.5 },
  m4a1: { out: 0.6, vol: 0.74, crack: 5800, body: 1600, bq: 1.2, thump: 118, thumpEnd: 44, tdur: 0.12, bdur: 0.16, room: 0.55, hall: 0.26, mech: 2500, bolt: 1950, spring: 840, casing: 4500, sharp: 0.9, drive: 3.5 },
};

let reloadH = null;

export const foley = {
  shot(id) {
    const g = GUN[id] || GUN.pistol;
    const h = emit({ bus: 'sfx', room: g.room, hall: g.hall, dur: 1.3, gain: g.out });
    if (!h) return;
    const t = h.t, v = g.vol * rand(0.9, 1.04), k = rand(0.95, 1.05);
    // 1 擊發機構
    click(h.in, t, g.mech * 1.8 * k, 0.18 * v);
    // 2 爆音瞬態(飽和處理,提供衝擊感)
    const sat = shaper(g.drive, h.in);
    burst(sat, t + 0.002, { type: 'highpass', f: 900, dur: 0.03 * g.sharp, a: 0.0004, g: 1.1 * v });
    // 3 主爆裂聲
    burst(h.in, t + 0.002, { type: 'lowpass', f: g.crack * k, f1: 420, q: 0.9, dur: g.tdur * 1.6, a: 0.0006, g: 0.95 * v });
    // 4 中頻 "吠" 聲(各槍音色差異主要在這)
    burst(h.in, t + 0.003, { type: 'bandpass', f: g.body * k, f1: g.body * 0.45, q: g.bq, dur: g.bdur, g: 0.85 * v });
    // 5 低頻身體
    tone(h.in, t + 0.001, { f: g.thump * k, f1: g.thumpEnd, dur: g.tdur * 1.6, a: 0.001, g: 1.0 * v });
    tone(h.in, t + 0.001, { type: 'triangle', f: g.thump * 2.1 * k, f1: g.thumpEnd * 1.5, dur: g.tdur, g: 0.3 * v });
    // 6 室內近距反射(拍擊回聲)
    burst(h.in, t + rand(0.035, 0.065), { type: 'bandpass', f: 1300, q: 0.8, dur: 0.16, g: 0.2 * v });
    burst(h.in, t + rand(0.09, 0.13), { type: 'bandpass', f: 800, q: 0.7, dur: 0.22, g: 0.09 * v });
    // 7 機件作動
    if (g.slide) { burst(h.in, t + 0.026, { type: 'bandpass', f: g.slide, q: 4, dur: 0.02, g: 0.2 * v }); click(h.in, t + 0.07, 3200, 0.12 * v); }
    if (g.bolt) { burst(h.in, t + 0.03, { type: 'bandpass', f: g.bolt, q: 3, dur: 0.03, g: 0.2 * v }); metal(h.in, t + 0.055, g.bolt * 1.6, 0.06 * v, 0.05); }
    if (g.spring) tone(h.in, t + 0.045, { type: 'triangle', f: g.spring, f1: g.spring * 0.92, dur: 0.1, g: 0.035 * v });
    if (g.ring) metal(h.in, t + 0.002, g.ring, 0.09 * v, 0.35, [1, 1.47, 2.09, 2.9]);
    // 8 彈殼落地
    if (g.casing) casing(h.in, t + rand(0.38, 0.6), g.casing, 0.05 * v * rand(0.7, 1.1), 3);
    duck(0.5, 0.3);
  },

  dry() {
    const h = emit({ bus: 'sfx', room: 0.15, dur: 0.3, gain: 1.4 });
    if (!h) return;
    click(h.in, h.t, 3600, 0.3);
    burst(h.in, h.t + 0.012, { type: 'bandpass', f: 1700, q: 3, dur: 0.025, g: 0.18 });
    metal(h.in, h.t + 0.012, 2900, 0.04, 0.05);
  },

  reload(id) {
    if (reloadH) reloadH.kill();
    const len = { pistol: 1.5, revolver: 2.6, ak47: 2.5, m4a1: 2.1 }[id] || 1.5;
    const h = emit({ bus: 'sfx', room: 0.2, dur: len + 0.6, gain: 0.38 });
    if (!h) return;
    reloadH = h;
    const d = h.in, t = h.t;
    cloth(d, t, 0.25, 0.1);
    if (id === 'revolver') {
      click(d, t + 0.1, 2200, 0.3); // 彈巢卡榫
      slide(d, t + 0.2, 1500, 2600, 0.1, 0.18);
      clack(d, t + 0.31, 2600, 0.28); // 甩出
      slide(d, t + 0.55, 1300, 800, 0.08, 0.15); // 退殼桿
      for (let i = 0; i < 6; i++) casing(d, t + rand(0.6, 0.95), rand(3700, 5200), rand(0.05, 0.09), 2);
      for (let i = 0; i < 6; i++) { // 逐發裝填
        const tt = t + 1.05 + i * 0.13 + rand(-0.015, 0.015);
        metal(d, tt, rand(2600, 3000), 0.07, 0.05);
        click(d, tt + 0.02, 2000, 0.14);
      }
      clack(d, t + 2.05, 2400, 0.42); // 合上
      for (let i = 0; i < 5; i++) click(d, t + 2.12 + i * 0.03, 3000, 0.1 * (1 - i * 0.15)); // 彈巢轉動棘輪
      click(d, t + 2.35, 1700, 0.3); // 擊錘待擊
      click(d, t + 2.39, 2600, 0.22);
    } else if (id === 'ak47') {
      clack(d, t + 0.15, 1100, 0.4); // 撥下彈匣
      slide(d, t + 0.24, 1200, 700, 0.15, 0.2);
      rattle(d, t + 0.85, 'metal', 0.14);
      slide(d, t + 1.0, 700, 1300, 0.12, 0.18);
      click(d, t + 1.12, 1600, 0.2); // 前緣勾住
      clack(d, t + 1.32, 1000, 0.55); // 後壓上膛卡入
      tone(d, t + 1.32, { f: 140, f1: 70, dur: 0.08, g: 0.2 });
      slide(d, t + 1.72, 2100, 1100, 0.13, 0.25); // 拉機柄
      tone(d, t + 1.72, { type: 'triangle', f: 620, f1: 540, dur: 0.12, g: 0.03 });
      clack(d, t + 1.88, 1400, 0.65); // 槍機復進
    } else if (id === 'm4a1') {
      click(d, t + 0.1, 3000, 0.28); // 彈匣釋放鈕
      slide(d, t + 0.13, 2200, 1500, 0.09, 0.18);
      rattle(d, t + 0.62, 'alu', 0.12);
      slide(d, t + 0.78, 1400, 2400, 0.12, 0.2);
      clack(d, t + 0.95, 1800, 0.45);
      burst(d, t + 1.05, { type: 'lowpass', f: 320, dur: 0.06, g: 0.3 }); // 手掌拍入
      tone(d, t + 1.05, { f: 120, f1: 70, dur: 0.07, g: 0.22 });
      slide(d, t + 1.45, 2600, 1600, 0.1, 0.22); // 拉柄
      for (let i = 0; i < 3; i++) click(d, t + 1.46 + i * 0.025, 3400, 0.08);
      clack(d, t + 1.62, 2300, 0.55);
      tone(d, t + 1.62, { type: 'triangle', f: 900, f1: 820, dur: 0.14, g: 0.04 }); // 緩衝彈簧
    } else {
      click(d, t + 0.08, 2600, 0.28); // 彈匣釋放
      slide(d, t + 0.12, 1800, 900, 0.12, 0.18);
      rattle(d, t + 0.55, 'plastic', 0.12);
      slide(d, t + 0.62, 900, 1800, 0.14, 0.18);
      clack(d, t + 0.8, 1500, 0.42);
      tone(d, t + 0.8, { f: 140, f1: 80, dur: 0.06, g: 0.2 });
      slide(d, t + 1.1, 2200, 1200, 0.06, 0.25); // 滑套後拉
      clack(d, t + 1.18, 2100, 0.5); // 放開復進
      metal(d, t + 1.18, 3300, 0.05, 0.12);
    }
  },

  switch() {
    if (reloadH) { reloadH.kill(); reloadH = null; }
    const h = emit({ bus: 'sfx', room: 0.15, dur: 0.6 });
    if (!h) return;
    cloth(h.in, h.t, 0.22, 0.13);
    clack(h.in, h.t + 0.13, 2200, 0.16);
    click(h.in, h.t + 0.22, 2800, 0.12);
    metal(h.in, h.t + 0.24, 3500, 0.025, 0.08);
  },

  step(sprint = false) {
    const h = emit({ bus: 'sfx', room: 0.14, dur: 0.4, gain: 1.2 });
    if (!h) return;
    const d = h.in, t = h.t, v = (sprint ? 0.62 : 0.3) * rand(0.85, 1.12), r = rand(0.85, 1.2);
    // 腳跟
    burst(d, t, { type: 'lowpass', f: 420 * r, f1: 130, dur: 0.07, g: v });
    burst(d, t, { type: 'bandpass', f: 1900 * r, q: 1.3, dur: 0.018, g: v * 0.35 });
    // 腳尖
    const tt = t + (sprint ? 0.028 : 0.05) * rand(0.8, 1.2);
    burst(d, tt, { type: 'lowpass', f: 650 * r, dur: 0.04, g: v * 0.5 });
    burst(d, tt, { type: 'bandpass', f: 2700 * r, q: 2, dur: 0.012, g: v * 0.2 });
    // 地上的砂礫 / 碎玻璃
    if (Math.random() < 0.25) burst(d, t + 0.01, { type: 'highpass', f: 4200, dur: 0.06, a: 0.01, g: v * 0.14 });
    if (Math.random() < 0.05) for (let i = 0; i < 5; i++) burst(d, t + rand(0, 0.08), { type: 'bandpass', f: rand(4500, 7500), q: 6, dur: 0.01, g: v * 0.25 });
    if (sprint) {
      cloth(d, t, 0.12, 0.04);
      if (Math.random() < 0.3) metal(d, t + 0.02, rand(3000, 4500), 0.012, 0.05); // 裝備晃動
    }
  },

  hurt() {
    const h = emit({ bus: 'sfx', room: 0.12, dur: 0.8, gain: 0.75 });
    if (!h) return;
    tone(h.in, h.t, { f: 95, f1: 38, dur: 0.3, g: 0.75 });
    burst(h.in, h.t, { type: 'lowpass', f: 500, f1: 100, dur: 0.22, g: 0.45 });
    burst(h.in, h.t, { type: 'bandpass', f: 900, q: 1, dur: 0.06, g: 0.2 }); // 皮肉
    grunt(h.in, h.t + 0.03);
  },

  knock() {
    const h = emit({ bus: 'sfx', room: 0.2, dur: 1, gain: 0.75 });
    if (!h) return;
    burst(h.in, h.t, { buf: 'pink', type: 'bandpass', f: 400, f1: 1600, q: 1.2, dur: 0.22, a: 0.12, g: 0.3 }); // 風切
    tone(h.in, h.t + 0.12, { f: 80, f1: 32, dur: 0.35, g: 0.95 });
    burst(h.in, h.t + 0.12, { type: 'lowpass', f: 700, f1: 90, dur: 0.3, g: 0.6 });
    rattle(h.in, h.t + 0.16, 'metal', 0.06);
    grunt(h.in, h.t + 0.14, true);
    duck(0.6, 0.4);
  },

  hit() {
    const h = emit({ bus: 'sfx', room: 0.12, dur: 0.4, gain: 0.95 });
    if (!h) return;
    const t = h.t, r = rand(0.85, 1.2);
    burst(h.in, t, { type: 'bandpass', f: 950 * r, f1: 280, q: 1, dur: 0.09, g: 0.45 });
    tone(h.in, t, { f: 150 * r, f1: 50, dur: 0.08, g: 0.32 });
    burst(h.in, t + 0.008, { type: 'lowpass', f: 2600, f1: 500, dur: 0.05, g: 0.22 }); // 濕潤噴濺
    burst(h.in, t + 0.012, { type: 'bandpass', f: 420, f1: 180, q: 5, dur: 0.07, g: 0.2 }); // squelch
    if (Math.random() < 0.3) burst(h.in, t + 0.002, { type: 'highpass', f: 2500, dur: 0.012, g: 0.18 }); // 骨裂
  },

  headshot() {
    const h = emit({ bus: 'sfx', room: 0.18, dur: 0.6, gain: 0.8 });
    if (!h) return;
    const t = h.t;
    burst(h.in, t, { type: 'highpass', f: 2400, dur: 0.016, g: 0.55 }); // 頭骨碎裂
    burst(h.in, t, { type: 'bandpass', f: 1600, q: 3, dur: 0.05, g: 0.4 });
    tone(h.in, t, { f: 180, f1: 60, dur: 0.09, g: 0.3 });
    for (let i = 0; i < 4; i++) burst(h.in, t + 0.015 + i * rand(0.02, 0.04), { type: 'lowpass', f: rand(1500, 3000), f1: 400, dur: 0.045, g: 0.16 }); // 噴濺
    tone(h.in, t + 0.01, { f: 1900, dur: 0.09, g: 0.07 }); // 爆頭提示音(輕)
    tone(h.in, t + 0.01, { f: 2870, dur: 0.07, g: 0.04 });
  },

  wall() {
    const h = emit({ bus: 'sfx', room: 0.25, dur: 0.8, gain: 1.2 });
    if (!h) return;
    const t = h.t;
    burst(h.in, t, { type: 'bandpass', f: rand(2800, 3800), q: 2, dur: 0.03, g: 0.24 });
    burst(h.in, t, { type: 'lowpass', f: 1300, f1: 300, dur: 0.06, g: 0.14 });
    for (let i = 0; i < 6; i++) burst(h.in, t + rand(0.03, 0.35), { type: 'bandpass', f: rand(4000, 7000), q: 5, dur: 0.01, g: rand(0.02, 0.05) }); // 碎屑落下
    burst(h.in, t + 0.02, { type: 'highpass', f: 5000, dur: 0.25, a: 0.05, g: 0.025 }); // 粉塵
    if (Math.random() < 0.15) { // 跳彈
      const p = A.ctx.createStereoPanner();
      p.pan.setValueAtTime(rand(-0.6, 0), t);
      p.pan.linearRampToValueAtTime(rand(0.4, 0.9) * (Math.random() < 0.5 ? -1 : 1), t + 0.35);
      p.connect(h.in);
      tone(p, t + 0.01, { f: rand(2600, 3400), f1: rand(1200, 1600), dur: 0.35, g: 0.05, a: 0.005 });
    }
  },

  coin(i = 0) {
    const h = emit({ bus: 'ui', room: 0.15, dur: 0.5, gain: 0.8 });
    if (!h) return;
    const f = 2093 * Math.pow(2, ((i % 6) * 2) / 12);
    metal(h.in, h.t, f, 0.1, 0.3, [1, 2.756, 5.404]);
    metal(h.in, h.t + 0.035, f * 1.5, 0.05, 0.2, [1, 2.756]);
    burst(h.in, h.t, { type: 'highpass', f: 6000, dur: 0.01, g: 0.05 });
  },

  buy() {
    const h = emit({ bus: 'ui', room: 0.2, dur: 1.2 });
    if (!h) return;
    clack(h.in, h.t, 900, 0.25); // 收銀機械
    [1319, 1661, 1976].forEach((f, k) => metal(h.in, h.t + 0.08 + k * 0.07, f, 0.07, 0.6, [1, 2.0, 3.01, 4.1]));
    for (let k = 0; k < 5; k++) metal(h.in, h.t + 0.2 + k * 0.05, rand(2600, 3600), 0.03, 0.15, [1, 2.756]);
  },

  deny() {
    const h = emit({ bus: 'ui', room: 0.1, dur: 0.5 });
    if (!h) return;
    const lp = filter('lowpass', 700, 1, h.in);
    tone(lp, h.t, { type: 'sawtooth', f: 110, dur: 0.11, hold: 0.04, g: 0.18 });
    tone(lp, h.t + 0.15, { type: 'sawtooth', f: 104, dur: 0.16, hold: 0.06, g: 0.18 });
    burst(h.in, h.t, { type: 'lowpass', f: 300, dur: 0.08, g: 0.2 });
  },

  roundStart() {
    const h = emit({ bus: 'sfx', room: 0.3, hall: 0.8, dur: 4, gain: 0.5 });
    if (!h) return;
    const t = h.t;
    burst(h.in, t, { type: 'bandpass', f: 700, f1: 3200, q: 2, dur: 0.15, a: 0.55, g: 0.06 }); // 金屬刮升
    tone(h.in, t + 0.6, { f: 55, f1: 28, dur: 2.2, g: 0.7 }); // 深沉撞擊
    burst(h.in, t + 0.6, { buf: 'brown', type: 'lowpass', f: 260, f1: 60, dur: 1.6, g: 0.6 });
    const lp = filter('lowpass', 200, 2, h.in); // 不和諧銅管刺擊
    lp.frequency.setValueAtTime(200, t + 0.6);
    lp.frequency.exponentialRampToValueAtTime(1300, t + 1.0);
    lp.frequency.exponentialRampToValueAtTime(260, t + 2.8);
    for (const f of [73.4, 77.8, 110, 146.8 * 1.01]) tone(lp, t + 0.6, { type: 'sawtooth', f, dur: 1.8, a: 0.3, g: 0.07 });
  },

  roundEnd() {
    const h = emit({ bus: 'sfx', room: 0.3, hall: 0.7, dur: 4 });
    if (!h) return;
    metal(h.in, h.t, 110, 0.22, 3.2, [1, 2.24, 3.38, 4.57, 5.9]); // 低沉銅鑼
    [1175, 1047, 880].forEach((f, k) => metal(h.in, h.t + 0.5 + k * 0.42, f * rand(0.985, 1.0), 0.035, 1.1, [1, 3.98, 6.3]));
  },

  // ---------- 殭屍動作 ----------
  bite(pos) {
    const h = emit({ pos, cat: 'fx', prio: 3, room: 0.15, dur: 0.6, ref: 1.5, gain: 1.5 });
    if (!h) return;
    const t = h.t;
    click(h.in, t, 3200, 0.3); // 牙齒
    const tear = burst(h.in, t + 0.02, { type: 'bandpass', f: 1300, q: 1.4, dur: 0.22, a: 0.02, g: 0.5 });
    tear.g.gain.cancelScheduledValues(t + 0.02);
    tear.g.gain.setValueCurveAtTime(curve(48, (u) => 0.5 * Math.pow(1 - u, 1.4) * (Math.random() < 0.35 ? 1 : 0.25)), t + 0.02, 0.22); // 撕裂的斷續顆粒
    tone(h.in, t + 0.03, { f: 300, f1: 110, dur: 0.15, g: 0.3 });
    burst(h.in, t + 0.04, { type: 'lowpass', f: 1800, f1: 400, dur: 0.1, g: 0.3 });
  },

  zStep(type, pos) {
    const h = emit({ pos, cat: 'step', room: 0.12, dur: 0.5, maxDist: 22, ref: 1.2, gain: 3.5 * ({ walker: 1.9, runner: 0.35, crawler: 0.45, bloater: 1.3, brute: 0.4 }[type] ?? 1) });
    if (!h) return;
    const d = h.in, t = h.t, r = rand(0.85, 1.15);
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
      burst(d, t + 0.04, { type: 'bandpass', f: 1500 * r, f1: 800, q: 1.2, dur: 0.18, a: 0.06, g: 0.12 });
    }
  },

  crawl(pos) {
    const h = emit({ pos, cat: 'step', room: 0.15, dur: 0.9, maxDist: 22, gain: 3.2 });
    if (!h) return;
    const t = h.t;
    burst(h.in, t, { type: 'lowpass', f: 1100, f1: 260, dur: 0.06, g: 0.4 }); // 手拍地
    burst(h.in, t + 0.08, { buf: 'pink', type: 'bandpass', f: 700, f1: 450, q: 1.3, dur: 0.4, a: 0.2, g: 0.35 }); // 身體拖行
    burst(h.in, t + 0.12, { type: 'highpass', f: 3000, dur: 0.3, a: 0.1, g: 0.03 });
    if (Math.random() < 0.5) bubble(h.in, t + 0.2, rand(180, 300), 0.06);
  },

  stomp(pos) {
    const h = emit({ pos, cat: 'fx', prio: 2, room: 0.45, hall: 0.15, dur: 1, ref: 3, roll: 0.9, gain: 0.6 });
    if (!h) return;
    const t = h.t;
    tone(h.in, t, { f: 50, f1: 27, dur: 0.45, g: 1 });
    burst(h.in, t, { type: 'lowpass', f: 280, f1: 60, dur: 0.35, g: 0.8 });
    burst(h.in, t, { type: 'bandpass', f: 900, q: 1, dur: 0.04, g: 0.3 });
    for (let i = 0; i < 8; i++) burst(h.in, t + rand(0.05, 0.5), { type: 'bandpass', f: rand(2500, 6000), q: 4, dur: 0.012, g: rand(0.02, 0.05) }); // 震落碎屑
  },

  wallImpact(pos) {
    const h = emit({ pos, cat: 'fx', prio: 4, room: 0.6, hall: 0.45, dur: 2, ref: 4, roll: 0.8, gain: 0.7 });
    if (!h) return;
    const t = h.t;
    tone(h.in, t, { f: 62, f1: 24, dur: 0.9, g: 1 });
    burst(h.in, t, { type: 'lowpass', f: 1600, f1: 90, dur: 0.7, g: 0.9 });
    burst(h.in, t, { type: 'highpass', f: 1800, dur: 0.05, g: 0.6 }); // 混凝土碎裂
    for (let i = 0; i < 5; i++) metal(h.in, t + rand(0, 0.15), rand(380, 900), 0.08, 0.25); // 金屬框架
    for (let i = 0; i < 18; i++) burst(h.in, t + rand(0.15, 1.4), { type: 'bandpass', f: rand(1500, 6000), q: 3, dur: 0.02, g: rand(0.02, 0.07) });
    duck(0.5, 0.6);
  },

  thud(pos, heavy = false) {
    const h = emit({ pos, cat: 'fx', prio: 2, room: 0.3, dur: 0.8, ref: heavy ? 3 : 1.8, gain: heavy ? 0.7 : 0.8 });
    if (!h) return;
    const t = h.t;
    tone(h.in, t, { f: heavy ? 60 : 95, f1: heavy ? 26 : 40, dur: heavy ? 0.4 : 0.22, g: heavy ? 1 : 0.65 });
    burst(h.in, t, { type: 'lowpass', f: heavy ? 400 : 550, f1: 110, dur: heavy ? 0.3 : 0.18, g: heavy ? 0.85 : 0.55 });
    burst(h.in, t + 0.01, { buf: 'pink', type: 'bandpass', f: 1200, q: 0.7, dur: 0.1, g: 0.15 }); // 衣物
    burst(h.in, t + rand(0.1, 0.16), { type: 'lowpass', f: 700, f1: 200, dur: 0.06, g: 0.25 }); // 四肢落地
    burst(h.in, t + rand(0.18, 0.26), { type: 'lowpass', f: 600, f1: 200, dur: 0.05, g: 0.15 });
    if (heavy) duck(0.7, 0.4);
  },

  spit(pos) {
    const h = emit({ pos, cat: 'fx', prio: 3, room: 0.3, dur: 0.8, ref: 2, gain: 2.3 });
    if (!h) return;
    const t = h.t;
    burst(h.in, t, { buf: 'pink', type: 'bandpass', f: 1100, f1: 1600, q: 1.2, dur: 0.12, a: 0.18, g: 0.35 }); // 喉嚨蓄痰 "khh"
    burst(h.in, t + 0.3, { type: 'bandpass', f: 700, q: 2, dur: 0.05, g: 0.55 }); // 噴出 "ptuh"
    burst(h.in, t + 0.3, { type: 'lowpass', f: 2200, f1: 500, dur: 0.08, g: 0.3 });
    for (let i = 0; i < 4; i++) bubble(h.in, t + 0.32 + i * 0.03, rand(250, 500), 0.06);
  },

  splash(pos) {
    const h = emit({ pos, cat: 'fx', prio: 2, room: 0.25, dur: 1, ref: 1.8 });
    if (!h) return;
    const t = h.t;
    burst(h.in, t, { type: 'lowpass', f: 1900, f1: 300, dur: 0.12, g: 0.6 });
    for (let i = 0; i < 8; i++) bubble(h.in, t + rand(0.02, 0.3), rand(400, 900), rand(0.03, 0.07), 0.03);
    burst(h.in, t + 0.04, { type: 'highpass', f: 3200, dur: 0.6, a: 0.06, g: 0.12 }); // 腐蝕滋滋
  },

  sizzle(pos) {
    const h = emit({ pos, cat: 'fx', prio: 0, room: 0.15, dur: 0.9, maxDist: 16, ref: 1.2, gain: 0.7 });
    if (!h) return;
    const t = h.t, dur = rand(0.55, 0.8);
    const b = burst(h.in, t, { type: 'highpass', f: rand(2600, 3400), dur, a: 0.05, g: 0.12 });
    b.g.gain.cancelScheduledValues(t);
    b.g.gain.setValueCurveAtTime(curve(64, (u) => 0.12 * Math.sin(Math.PI * u) * (Math.random() < 0.2 ? 1.8 : 0.6)), t, dur); // 劈啪顆粒
    for (let i = 0; i < 3; i++) bubble(h.in, t + rand(0, dur), rand(300, 600), 0.03, 0.04);
  },

  burst(pos) {
    const h = emit({ pos, cat: 'fx', prio: 5, room: 0.5, hall: 0.4, dur: 2, ref: 4, roll: 0.85, gain: 0.97 });
    if (!h) return;
    const t = h.t;
    tone(h.in, t, { f: 72, f1: 24, dur: 0.6, g: 1 });
    burst(h.in, t, { type: 'lowpass', f: 950, f1: 80, dur: 0.5, g: 1 });
    burst(h.in, t + 0.005, { type: 'bandpass', f: 600, f1: 250, q: 0.8, dur: 0.3, g: 0.7 }); // 濕爆
    for (let i = 0; i < 25; i++) burst(h.in, t + rand(0.08, 1.3), { type: 'lowpass', f: rand(900, 2600), f1: 300, dur: 0.05, g: rand(0.04, 0.12) }); // 血肉雨
    for (let i = 0; i < 14; i++) bubble(h.in, t + rand(0.05, 0.8), rand(120, 380), rand(0.05, 0.12), 0.07);
    duck(0.45, 0.6);
  },
};
