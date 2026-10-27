// 擬音:槍聲(分層:錄音樣本 + 合成低頻/機件/彈殼)、換彈、開鏡、投擲/爆炸、近戰、玩家受傷、命中、殭屍動作。
// 合成版本是完整的備援:樣本沒載入或缺檔時一樣好聽。
import { A, emit, burst, tone, metal, bubble, shaper, gain, filter, rand, pick, curve, duck, muffle, playBuf, baked, clamp } from './core.js';
import { grunt } from './voices.js';
import * as S from './samples.js';

// ---------- 小積木 ----------
export function click(d, t, f, g) {
  burst(d, t, { type: 'bandpass', f, q: 6, dur: 0.008, g });
  burst(d, t + 0.002, { type: 'bandpass', f: f * 0.55, q: 3, dur: 0.018, g: g * 0.6 });
}
export function clack(d, t, f, g) {
  burst(d, t, { type: 'highpass', f: 1600, dur: 0.018, g: g * 0.8 });
  burst(d, t, { type: 'bandpass', f, q: 3.5, dur: 0.05, g });
  tone(d, t, { f: f * 0.18, f1: f * 0.09, dur: 0.05, g: g * 0.5 });
  metal(d, t + 0.001, f * 1.7, g * 0.22, 0.07);
}
export function slide(d, t, f0, f1, dur, g) {
  burst(d, t, { type: 'bandpass', f: f0, f1, q: 2.2, dur: dur * 0.6, a: dur * 0.4, g });
}
export function cloth(d, t, dur, g) {
  burst(d, t, { buf: 'pink', type: 'bandpass', f: rand(1300, 2200), f1: rand(900, 1500), q: 0.8, dur: dur * 0.6, a: dur * 0.4, g });
}
function rattle(d, t, kind, g, surf = 'tile') {
  const f = kind === 'metal' ? 2300 : kind === 'alu' ? 3100 : kind === 'heavy' ? 1300 : 1500;
  const soft = surf === 'carpet' || surf === 'grass' ? 0.25 : surf === 'wood' ? 0.6 : 1;
  let tt = t, gg = g;
  for (let i = 0; i < 4; i++) {
    burst(d, tt, { type: 'bandpass', f: f * rand(0.85, 1.15) * (soft < 1 ? 0.6 : 1), q: 3, dur: 0.04, g: gg * soft });
    burst(d, tt, { type: 'lowpass', f: 600, dur: 0.05, g: gg * 0.6 });
    if (kind !== 'plastic' && soft > 0.5) metal(d, tt, f * rand(0.9, 1.3), gg * 0.25 * soft, kind === 'heavy' ? 0.16 : 0.09);
    tt += rand(0.06, 0.12) * (1 - i * 0.2);
    gg *= 0.55;
  }
  if (surf === 'water') for (let i = 0; i < 3; i++) bubble(d, t + rand(0, 0.08), rand(300, 700), g * 0.4, 0.05);
}
// 刮擦/卡頓摩擦(stick-slip)
export function squeal(d, t, f0, f1, dur, g, q = 18, rate = [25, 45]) {
  const b = burst(d, t, { type: 'bandpass', f: f0, f1, q, dur: dur * 0.5, a: dur * 0.5, g });
  const r = rand(rate[0], rate[1]);
  b.g.gain.cancelScheduledValues(t);
  b.g.gain.setValueCurveAtTime(curve(Math.max(32, Math.ceil(dur * 120)), (u) => g * Math.sin(Math.PI * u) * (0.45 + 0.55 * Math.abs(Math.sin(u * dur * r * Math.PI))) * (Math.random() < 0.08 ? 0.3 : 1)), t, dur);
  return b;
}

// ---------- 地面材質 ----------
// 玩家腳下材質:有 World 就直接查(快取 0.2s),否則用最近一次腳步回報的值
let surfT = -1;
export function surfaceHere() {
  const w = A.world, L = A.L, n = A.ctx ? A.ctx.currentTime : 0;
  if (w && w.surfaceAt && n - surfT > 0.2) {
    surfT = n;
    try { A.surface = w.surfaceAt(L.x, L.y - 1.65, L.z) || A.surface; } catch { /* 保留舊值 */ }
  }
  return A.surface;
}
export function surfaceAt(pos) {
  const w = A.world;
  if (w && w.surfaceAt && pos) { try { return w.surfaceAt(pos.x, (pos.y ?? 0) - 0.2, pos.z) || A.surface; } catch { /* 忽略 */ } }
  return A.surface;
}

// 彈殼/霰彈殼落地(依地面材質):kind 'brass' | 'heavy'(.50)| 'hull'(塑膠霰彈殼)
export function casing(d, t, f, g, kind = 'brass', surf = 'tile') {
  if (surf === 'water') { // 撲通
    bubble(d, t, rand(500, 800), g * 0.8, 0.06);
    burst(d, t, { type: 'lowpass', f: 1600, f1: 400, dur: 0.06, g: g * 0.4 });
    return;
  }
  const soft = { carpet: 0.15, grass: 0.12, gravel: 0.45, wood: 0.55, concrete: 0.8, asphalt: 0.75, metal: 1.3, tile: 1 }[surf] ?? 1;
  const ringDecay = { metal: 1.6, tile: 1, concrete: 0.7, asphalt: 0.6, wood: 0.35, gravel: 0.3, carpet: 0.1, grass: 0.08 }[surf] ?? 1;
  const bounces = surf === 'carpet' || surf === 'grass' ? 1 : surf === 'gravel' || surf === 'wood' ? 2 : kind === 'heavy' ? 2 : 3;
  let tt = t, gg = g, gap = rand(0.08, 0.11);
  for (let i = 0; i < bounces; i++) {
    if (kind === 'hull') { // 塑膠殼:空心的「咚」,沒有金屬鈴聲
      burst(d, tt, { type: 'bandpass', f: rand(900, 1400) * (soft < 0.5 ? 0.7 : 1), q: 4, dur: 0.03, g: gg * 1.6 * Math.min(1, soft + 0.3) });
      burst(d, tt, { type: 'lowpass', f: 700, dur: 0.03, g: gg * 0.8 });
      if (surf === 'metal') metal(d, tt, 1800, gg * 0.2, 0.05, [1, 2.4]); // 底部銅蓋
    } else {
      if (soft > 0.3) metal(d, tt, f * rand(0.94, 1.06), gg * soft, (kind === 'heavy' ? 0.16 : 0.09) * ringDecay * (1 - i * 0.18), kind === 'heavy' ? [1, 2.32, 4.1, 6.3] : [1, 2.71, 4.93, 7.6]);
      burst(d, tt, { type: soft > 0.5 ? 'highpass' : 'bandpass', f: soft > 0.5 ? 5000 : 2200, dur: 0.008, g: gg * 0.6 * Math.max(soft, 0.3) });
      if (soft < 0.5) burst(d, tt, { type: 'lowpass', f: 900, dur: 0.03, g: gg * 0.5 }); // 悶的落地
    }
    if (surf === 'gravel') for (let k = 0; k < 4; k++) burst(d, tt + rand(0, 0.05), { type: 'bandpass', f: rand(2500, 6000), q: 4, dur: 0.008, g: gg * 0.25 });
    tt += gap;
    gap *= rand(0.55, 0.7);
    gg *= 0.5;
  }
  if (bounces > 2 && (surf === 'tile' || surf === 'concrete' || surf === 'metal')) // 滾動
    burst(d, tt, { type: 'bandpass', f: f * 0.8, q: 6, dur: 0.18, a: 0.05, g: g * 0.06 });
}

// ---------- 槍聲 ----------
// out 輸出增益、vol 層總量、crack 爆裂頻率、body 中頻吠聲、thump 低頻、room/hall 殘響、mech 擊發機構
export const GUN = {
  pistol: { out: 1.8, vol: 0.62, crack: 4400, body: 1350, bq: 1.4, thump: 160, thumpEnd: 50, tdur: 0.11, bdur: 0.14, room: 0.55, hall: 0.18, mech: 2700, slide: 2500, casing: 4100, sharp: 1, drive: 3 },
  revolver: { out: 0.9, vol: 0.95, crack: 3000, body: 820, bq: 1.1, thump: 92, thumpEnd: 33, tdur: 0.26, bdur: 0.34, room: 0.8, hall: 0.45, mech: 1900, ring: 3600, sharp: 1.35, drive: 4 },
  shotgun: { out: 1.1, vol: 1.0, crack: 2500, body: 540, bq: 0.9, thump: 72, thumpEnd: 30, tdur: 0.24, bdur: 0.36, room: 0.95, hall: 0.6, mech: 1500, sharp: 1.7, drive: 5, pump: 0.36 },
  ak47: { out: 1.3, vol: 0.86, crack: 3300, body: 650, bq: 1.6, thump: 86, thumpEnd: 36, tdur: 0.16, bdur: 0.23, room: 0.65, hall: 0.32, mech: 1500, bolt: 1150, casing: 2700, sharp: 1.15, drive: 4.5 },
  m4a1: { out: 1.75, vol: 0.74, crack: 5800, body: 1600, bq: 1.2, thump: 118, thumpEnd: 44, tdur: 0.12, bdur: 0.16, room: 0.55, hall: 0.26, mech: 2500, bolt: 1950, spring: 840, casing: 4500, sharp: 0.9, drive: 3.5 },
  barrett: { out: 0.74, vol: 1.15, crack: 7200, body: 430, bq: 0.8, thump: 54, thumpEnd: 22, tdur: 0.42, bdur: 0.5, room: 1.1, hall: 1.1, mech: 1100, casing: 2050, sharp: 2.4, drive: 6, big: true },
};
const CASE_T = { pistol: [0.38, 0.6], ak47: [0.42, 0.62], m4a1: [0.38, 0.58], barrett: [0.7, 0.9] };

// 槍聲本體(不含彈殼、泵動):合成。d 輸出、t 起點、v 音量、k 音高
function gunBody(d, t, g, v, k) {
  click(d, t, g.mech * 1.8 * k, 0.18 * v); // 擊發機構
  const sat = shaper(g.drive, d);
  burst(sat, t + 0.002, { type: 'highpass', f: 900, dur: 0.03 * g.sharp, a: 0.0004, g: 1.1 * v }); // 爆音瞬態
  burst(d, t + 0.002, { type: 'lowpass', f: g.crack * k, f1: 420, q: 0.9, dur: g.tdur * 1.6, a: 0.0006, g: 0.95 * v }); // 主爆裂
  burst(d, t + 0.003, { type: 'bandpass', f: g.body * k, f1: g.body * 0.45, q: g.bq, dur: g.bdur, g: 0.85 * v }); // 中頻吠聲(各槍音色差異主要在這)
  tone(d, t + 0.001, { f: g.thump * k, f1: g.thumpEnd, dur: g.tdur * 1.6, a: 0.001, g: 1.0 * v }); // 低頻身體
  tone(d, t + 0.001, { type: 'triangle', f: g.thump * 2.1 * k, f1: g.thumpEnd * 1.5, dur: g.tdur, g: 0.3 * v });
  burst(d, t + rand(0.035, 0.065), { type: 'bandpass', f: 1300, q: 0.8, dur: 0.16, g: 0.2 * v }); // 近距反射
  burst(d, t + rand(0.09, 0.13), { type: 'bandpass', f: 800, q: 0.7, dur: 0.22, g: 0.09 * v });
  if (g.slide) { burst(d, t + 0.026, { type: 'bandpass', f: g.slide, q: 4, dur: 0.02, g: 0.2 * v }); click(d, t + 0.07, 3200, 0.12 * v); }
  if (g.bolt) { burst(d, t + 0.03, { type: 'bandpass', f: g.bolt, q: 3, dur: 0.03, g: 0.2 * v }); metal(d, t + 0.055, g.bolt * 1.6, 0.06 * v, 0.05); }
  if (g.spring) tone(d, t + 0.045, { type: 'triangle', f: g.spring, f1: g.spring * 0.92, dur: 0.1, g: 0.035 * v });
  if (g.ring) metal(d, t + 0.002, g.ring, 0.09 * v, 0.35, [1, 1.47, 2.09, 2.9]);
  if (g.big) bigLayers(d, t, v);
}

// 巴雷特 .50 BMG:制退器側噴的爆壓、胸腔低頻壓力波、長尾音與遠處回聲、槍管後座的沉重機件
function bigLayers(d, t, v) {
  const sat = shaper(7, d);
  burst(sat, t + 0.001, { type: 'bandpass', f: 2600, q: 0.5, dur: 0.05, a: 0.0003, g: 0.9 * v }); // 制退器側噴
  tone(d, t, { f: 40, f1: 18, dur: 0.75, a: 0.003, g: 1.25 * v }); // 壓力波
  tone(d, t + 0.004, { f: 68, f1: 30, dur: 0.4, g: 0.6 * v });
  burst(d, t + 0.01, { buf: 'brown', type: 'lowpass', f: 260, f1: 55, dur: 1.4, a: 0.02, g: 0.95 * v }); // 長低頻轟鳴
  burst(d, t + 0.02, { buf: 'pink', type: 'bandpass', f: 900, f1: 260, q: 0.6, dur: 0.9, a: 0.03, g: 0.25 * v }); // 空氣的撕裂尾音
  for (const [dt, g] of [[0.11, 0.22], [0.24, 0.14], [0.43, 0.09], [0.7, 0.05]]) burst(d, t + dt * rand(0.92, 1.08), { type: 'lowpass', f: 1400, f1: 300, dur: 0.3, g: g * v }); // 牆面/遠處拍擊回聲
  clack(d, t + 0.05, 700, 0.35 * v); // 槍管後座 + 槍機
  metal(d, t + 0.06, 520, 0.12 * v, 0.3, [1, 1.9, 3.1, 4.6]);
}

// 預烘焙:每把槍 4 個合成變體(自動連射時每發只剩一個 BufferSource)
const bakedBody = (id, g) => baked(`gun|${id}`, 4, g.big ? 2.2 : 1.1 + g.tdur * 2, (dst, t0) => gunBody(dst, t0, g, g.vol * rand(0.93, 1.03), rand(0.96, 1.04)));
// 彈殼:依材質 × 種類各 3 個變體
function casingAt(d, t, f, g, kind, surf) {
  const set = baked(`case|${kind}|${surf}|${f}`, 3, 0.7, (dst, t0) => casing(dst, t0, f, g, kind, surf));
  if (set) playBuf(d, t, pick(set), { rate: rand(0.94, 1.06) });
  else casing(d, t, f, g, kind, surf);
}

let reloadH = null, lastShot = 0;

export const foley = {
  shot(id, pos, remote = false) {
    const g = GUN[id] || GUN.pistol;
    const out = remote ? g.out * 0.55 : g.out;
    const h = pos
      ? emit({ pos, cat: 'gun', prio: 5, room: g.room, hall: g.hall * 1.4, echo: g.room * 1.2, dur: g.big ? 2.4 : 1.4, ref: g.big ? 9 : 5, roll: 0.75, maxDist: g.big ? 200 : 140, gain: out, track: false })
      : emit({ bus: 'sfx', room: g.room, hall: g.big ? 0.5 : 0, echo: g.room * (g.big ? 1.6 : 1), dur: g.big ? 2.4 : 1.4, gain: out * rand(0.92, 1.04) });
    if (!h) return;
    const t = h.t, v = g.vol, k = rand(0.96, 1.04);
    const smp = S.play(`gun.${id}`, { h, g: 1.0, p: 0.35 });
    if (smp) { // 錄音 + 合成低頻(衝擊感)與機件
      tone(h.in, t + 0.001, { f: g.thump * k, f1: g.thumpEnd, dur: g.tdur * 1.4, a: 0.001, g: 0.55 * v });
      if (g.big) { tone(h.in, t, { f: 40, f1: 18, dur: 0.7, a: 0.003, g: 0.9 * v }); burst(h.in, t + 0.01, { buf: 'brown', type: 'lowpass', f: 240, f1: 55, dur: 1.3, a: 0.02, g: 0.6 * v }); }
    } else {
      const bk = bakedBody(id, g);
      if (bk) playBuf(h.in, t, pick(bk), { rate: k });
      else gunBody(h.in, t, g, v, k);
    }
    if (!remote) {
      const surf = surfaceHere();
      const ct = CASE_T[id];
      if (ct && g.casing) casingAt(h.in, t + rand(ct[0], ct[1]), g.casing, (g.big ? 0.09 : 0.05) * v * rand(0.7, 1.1), g.big ? 'heavy' : 'brass', surf);
      if (g.pump) pump(h.in, t + g.pump, 0.9, surf, true);
      duck(g.big ? 0.3 : 0.5, g.big ? 0.9 : 0.3);
      if (g.big && A.ctx.currentTime - lastShot > 0.5) muffle(0.25, 0.08, 0.6); // 巨響後耳朵短暫一悶
      lastShot = A.ctx.currentTime;
    } else if (g.pump) pump(h.in, t + g.pump, 0.6, 'tile', false);
  },

  dry() {
    const h = emit({ bus: 'sfx', room: 0.15, dur: 0.3, gain: 1.4 });
    if (!h) return;
    click(h.in, h.t, 3600, 0.3);
    burst(h.in, h.t + 0.012, { type: 'bandpass', f: 1700, q: 3, dur: 0.025, g: 0.18 });
    metal(h.in, h.t + 0.012, 2900, 0.04, 0.05);
  },

  // 換彈:dur = 實際換彈秒數(改裝後會變快),整段時間軸依比例縮放;shells = 霰彈槍裝填發數
  reload(id, dur, shells) {
    if (reloadH) reloadH.kill();
    const NOM = { pistol: 1.5, revolver: 2.6, shotgun: 2.9, ak47: 2.5, m4a1: 2.1, barrett: 3.4 };
    const nom = NOM[id] || 1.5;
    const len = Number.isFinite(dur) && dur > 0 ? dur : nom;
    const h = emit({ bus: 'sfx', room: 0.2, dur: len + 0.8, gain: 0.38 });
    if (!h) return;
    reloadH = h;
    const surf = surfaceHere(), q = Math.round(len * 20) / 20, sh = Number.isFinite(shells) ? shells | 0 : -1;
    const set = baked(`reload|${id}|${q}|${sh}|${surf}`, 2, q + 0.7, (dst, t0) => reloadSeq(dst, t0, id, q, shells, surf));
    if (set) playBuf(h.in, h.t, pick(set), { rate: rand(0.98, 1.02) });
    else reloadSeq(h.in, h.t, id, len, shells, surf);
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

  // 開鏡/收鏡:衣物摩擦 + 槍托貼臉的輕微碰觸
  adsIn() {
    const h = emit({ bus: 'sfx', room: 0.06, dur: 0.4, gain: 1.4 });
    if (!h) return;
    burst(h.in, h.t, { buf: 'pink', type: 'bandpass', f: 1700, f1: 2600, q: 0.9, dur: 0.08, a: 0.05, g: 0.09 });
    click(h.in, h.t + 0.11, 2400, 0.05);
    burst(h.in, h.t + 0.11, { type: 'lowpass', f: 380, dur: 0.05, g: 0.08 });
  },
  adsOut() {
    const h = emit({ bus: 'sfx', room: 0.06, dur: 0.35, gain: 1.4 });
    if (!h) return;
    burst(h.in, h.t, { buf: 'pink', type: 'bandpass', f: 1900, f1: 1200, q: 0.9, dur: 0.07, a: 0.04, g: 0.08 });
    click(h.in, h.t + 0.07, 1900, 0.035);
  },

  // ---------- 投擲 / 爆炸 / 近戰 ----------
  grenadeThrow() {
    const h = emit({ bus: 'sfx', room: 0.15, dur: 1 });
    if (!h) return;
    const t = h.t;
    slide(h.in, t, 3000, 4600, 0.07, 0.12); // 拉環摩擦
    metal(h.in, t + 0.07, 3900, 0.07, 0.12, [1, 2.2, 3.6]); // 拉環叮
    metal(h.in, t + 0.28, 2650, 0.08, 0.18, [1, 2.76, 4.3]); // 保險片彈開
    click(h.in, t + 0.28, 2000, 0.12);
    burst(h.in, t + 0.36, { buf: 'pink', type: 'bandpass', f: 600, f1: 2400, glide: 0.1, q: 1.1, dur: 0.22, a: 0.06, g: 0.35 }); // 揮臂風切
    cloth(h.in, t + 0.33, 0.25, 0.1);
  },
  grenadeBounce(pos) {
    const surf = surfaceAt(pos);
    const h = emit({ pos, cat: 'fx', prio: 3, room: 0.3, dur: 0.6, ref: 2, track: false });
    if (!h) return;
    const t = h.t, soft = surf === 'grass' || surf === 'carpet' ? 0.35 : surf === 'wood' ? 0.7 : 1;
    if (surf === 'water') { burst(h.in, t, { type: 'lowpass', f: 1500, f1: 300, dur: 0.12, g: 0.6 }); for (let i = 0; i < 4; i++) bubble(h.in, t + rand(0, 0.15), rand(300, 700), 0.15, 0.06); return; }
    burst(h.in, t, { type: 'lowpass', f: 700, f1: 160, dur: 0.06, g: 0.55 }); // 鑄鐵殼體的悶擊
    metal(h.in, t, rand(780, 1100), 0.2 * soft, 0.1 * soft, [1, 2.2, 3.7, 5.1]);
    burst(h.in, t, { type: 'bandpass', f: 2200, q: 2, dur: 0.015, g: 0.3 * soft });
    if (surf === 'gravel') for (let i = 0; i < 6; i++) burst(h.in, t + rand(0, 0.08), { type: 'bandpass', f: rand(2500, 6000), q: 4, dur: 0.01, g: 0.12 });
    if (surf === 'metal') metal(h.in, t, rand(380, 520), 0.15, 0.4, [1, 1.8, 2.9]);
  },
  explosion(pos, size = 1) {
    const sz = clamp(Number.isFinite(size) ? size : 1, 0.2, 1.5);
    const h = pos
      ? emit({ pos, cat: 'fx', prio: 7, room: 1, hall: 0.7, echo: 1.1, dur: 4.5, ref: 5 + sz * 4, roll: 0.6, maxDist: 160, gain: 0.95, track: false })
      : emit({ bus: 'sfx', room: 1, hall: 0.7, echo: 1.1, dur: 4.5, gain: 0.95 });
    if (!h) return;
    const t = h.t, d = h.in, v = 0.6 + sz * 0.4;
    if (!S.play('explosion', { h, g: 0.9 * v, p: 1.2 })) {
      const sat = shaper(5, d);
      burst(sat, t, { type: 'highpass', f: 700, dur: 0.035, a: 0.0005, g: 1.1 * v }); // 衝擊波的爆裂
      burst(d, t + 0.002, { type: 'lowpass', f: 3200, f1: 180, dur: 0.6, a: 0.001, g: 1.0 * v }); // 爆炸主體
      burst(d, t + 0.01, { type: 'bandpass', f: 420, f1: 120, q: 0.7, dur: 0.8, g: 0.7 * v });
      for (let i = 0; i < 26; i++) burst(d, t + rand(0.25, 2.6) * (i < 10 ? 0.5 : 1), { type: 'bandpass', f: rand(1500, 6500), q: 3, dur: rand(0.01, 0.03), g: rand(0.02, 0.08) * v }); // 碎屑落下
      for (let i = 0; i < 5; i++) metal(d, t + rand(0.3, 1.4), rand(3500, 7000), 0.02 * v, 0.2, [1, 1.53, 2.31]); // 玻璃碎片
    }
    tone(d, t, { f: 58, f1: 20, dur: 1.4 + sz * 0.6, a: 0.002, g: 1.2 * v }); // 次低頻壓力
    burst(d, t + 0.03, { buf: 'brown', type: 'lowpass', f: 320, f1: 50, dur: 2.6 + sz, a: 0.04, g: 0.9 * v }); // 長轟鳴
    duck(0.25, 1.2);
    const dist = h.d || 0;
    if (dist < 9 * sz) { // 太近:耳鳴 + 世界變悶
      const c = 1 - dist / (9 * sz);
      muffle(0.55 + 0.4 * c, 0.4 + sz * 0.6, 3);
      tinnitus(0.04 + 0.06 * c, 2.5 + sz * 1.5);
    }
  },
  knifeSwing() {
    const h = emit({ bus: 'sfx', room: 0.08, dur: 0.5, gain: 0.9 });
    if (!h) return;
    const t = h.t, r = rand(0.9, 1.15);
    burst(h.in, t, { buf: 'pink', type: 'bandpass', f: 700 * r, f1: 3000 * r, glide: 0.09, q: 1.4, dur: 0.17, a: 0.05, g: 0.4 }); // 刀刃劃破空氣
    burst(h.in, t + 0.1, { buf: 'pink', type: 'bandpass', f: 2400 * r, f1: 900, q: 1.2, dur: 0.1, g: 0.15 });
    cloth(h.in, t, 0.2, 0.08);
    metal(h.in, t + 0.02, 5200, 0.012, 0.08, [1, 1.7]);
  },
  knifeHit(pos, flesh = true) {
    const h = emit(pos ? { pos, cat: 'fx', prio: 3, room: 0.18, dur: 0.6, ref: 1.5, gain: 1.4, track: false } : { bus: 'sfx', room: 0.18, dur: 0.6, gain: 1.1 });
    if (!h) return;
    const t = h.t;
    if (flesh) {
      if (S.play('flesh.stab', { h, g: 0.9 })) return;
      burst(h.in, t, { type: 'bandpass', f: 440, f1: 170, q: 5, dur: 0.1, g: 0.55 }); // 刺入
      tone(h.in, t, { f: 150, f1: 55, dur: 0.1, g: 0.4 });
      burst(h.in, t + 0.005, { type: 'lowpass', f: 2400, f1: 500, dur: 0.07, g: 0.3 }); // 濕
      burst(h.in, t + 0.002, { type: 'highpass', f: 2600, dur: 0.012, g: 0.16 }); // 軟骨
      burst(h.in, t + 0.12, { type: 'bandpass', f: 600, f1: 300, q: 3, dur: 0.08, g: 0.2 }); // 拔出
    } else {
      metal(h.in, t, rand(2900, 3500), 0.12, 0.18, [1, 2.4, 4.1, 5.9]);
      burst(h.in, t, { type: 'highpass', f: 3000, dur: 0.02, g: 0.3 });
      burst(h.in, t + 0.01, { type: 'bandpass', f: 3200, f1: 1900, q: 2, dur: 0.08, g: 0.1 }); // 刮
      for (let i = 0; i < 4; i++) burst(h.in, t + rand(0.03, 0.25), { type: 'bandpass', f: rand(3500, 6500), q: 5, dur: 0.01, g: 0.04 });
    }
  },

  // ---------- 玩家 ----------
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
    rattle(h.in, h.t + 0.16, 'metal', 0.06, surfaceHere());
    grunt(h.in, h.t + 0.14, true);
    duck(0.6, 0.4);
    muffle(0.35, 0.15, 0.8);
  },
  armorHit() { // 防彈板吸收:悶的拍擊 + 陶瓷板的「叩」
    const h = emit({ bus: 'sfx', room: 0.1, dur: 0.5, gain: 1.2 });
    if (!h) return;
    const t = h.t;
    burst(h.in, t, { type: 'lowpass', f: 1300, f1: 280, dur: 0.08, g: 0.5 });
    burst(h.in, t, { type: 'bandpass', f: 1800, q: 4, dur: 0.03, g: 0.3 });
    metal(h.in, t + 0.002, rand(2700, 3100), 0.05, 0.08, [1, 2.3]);
    tone(h.in, t, { f: 125, f1: 60, dur: 0.12, g: 0.4 });
    burst(h.in, t + 0.01, { buf: 'pink', type: 'bandpass', f: 2500, q: 0.8, dur: 0.07, g: 0.08 }); // 尼龍布
  },

  // ---------- 命中回饋 ----------
  hit() {
    const h = emit({ bus: 'sfx', room: 0.12, dur: 0.4, gain: 0.95 });
    if (!h) return;
    const t = h.t, r = rand(0.85, 1.2);
    if (S.play('flesh.hit', { h, g: 0.7, p: 1 })) { tone(h.in, t, { f: 150 * r, f1: 50, dur: 0.08, g: 0.25 }); return; }
    const set = baked('hit', 6, 0.35, (dst, t0) => { const hh = { in: dst, t: t0 }; hitSynth(hh, rand(0.85, 1.2)); });
    if (set) { playBuf(h.in, t, pick(set), { rate: rand(0.95, 1.05) }); return; }
    hitSynth(h, r);
  },
  headshot() {
    const h = emit({ bus: 'sfx', room: 0.18, dur: 0.6, gain: 0.8 });
    if (!h) return;
    const set = baked('headshot', 4, 0.45, (dst, t0) => headSynth({ in: dst, t: t0 }));
    if (set) { playBuf(h.in, h.t, pick(set), { rate: rand(0.96, 1.04) }); return; }
    headSynth(h);
  },
  // 子彈打到牆/地:pos 有給就定位,surface 決定音色(混凝土碎屑/金屬跳彈/木頭/磁磚碎片/水花)
  wall(pos, surface) {
    const surf = surface || (pos ? surfaceAt(pos) : 'concrete');
    const h = pos ? emit({ pos, cat: 'fx', prio: 1, room: 0.3, dur: 0.8, ref: 2, gain: 1.6, maxDist: 40, track: false }) : emit({ bus: 'sfx', room: 0.25, dur: 0.8, gain: 1.2 });
    if (!h) return;
    const t = h.t;
    if (surf === 'water') { burst(h.in, t, { type: 'lowpass', f: 2600, f1: 500, dur: 0.1, g: 0.35 }); for (let i = 0; i < 5; i++) bubble(h.in, t + rand(0, 0.12), rand(500, 1200), 0.08, 0.04); return; }
    if (surf === 'metal' || Math.random() < 0.05) { // 金屬板:叮 + 跳彈
      metal(h.in, t, rand(1800, 2600), 0.14, 0.25, [1, 2.2, 3.5, 5.3]);
      burst(h.in, t, { type: 'highpass', f: 3000, dur: 0.02, g: 0.3 });
    } else if (surf === 'wood') {
      burst(h.in, t, { type: 'bandpass', f: rand(900, 1300), q: 2.5, dur: 0.05, g: 0.32 });
      burst(h.in, t, { type: 'lowpass', f: 700, f1: 200, dur: 0.06, g: 0.2 });
      for (let i = 0; i < 4; i++) burst(h.in, t + rand(0.02, 0.2), { type: 'bandpass', f: rand(2000, 4000), q: 3, dur: 0.015, g: 0.04 }); // 木屑
    } else {
      burst(h.in, t, { type: 'bandpass', f: rand(2800, 3800), q: 2, dur: 0.03, g: 0.24 });
      burst(h.in, t, { type: 'lowpass', f: 1300, f1: 300, dur: 0.06, g: 0.14 });
      const chips = surf === 'tile' ? 8 : 6;
      for (let i = 0; i < chips; i++) burst(h.in, t + rand(0.03, 0.35), { type: 'bandpass', f: rand(4000, 7000), q: 5, dur: 0.01, g: rand(0.02, 0.05) }); // 碎屑落下
      if (surf === 'tile') metal(h.in, t + 0.01, rand(3500, 4500), 0.03, 0.06, [1, 1.6]); // 磁磚碎片
      burst(h.in, t + 0.02, { type: 'highpass', f: 5000, dur: 0.25, a: 0.05, g: 0.025 }); // 粉塵
    }
    if (Math.random() < (surf === 'metal' ? 0.45 : 0.12)) { // 跳彈呼嘯
      const p = A.ctx.createStereoPanner();
      p.pan.setValueAtTime(rand(-0.6, 0), t);
      p.pan.linearRampToValueAtTime(rand(0.4, 0.9) * (Math.random() < 0.5 ? -1 : 1), t + 0.35);
      p.connect(h.in);
      tone(p, t + 0.01, { f: rand(2600, 3400), f1: rand(1200, 1600), dur: 0.35, g: 0.05, a: 0.005 });
    }
  },

  // ---------- 殭屍動作 ----------
  bite(pos) {
    const h = emit({ pos, cat: 'fx', prio: 3, room: 0.15, dur: 0.6, ref: 1.5, gain: 1.5, track: false });
    if (!h) return;
    const t = h.t;
    click(h.in, t, 3200, 0.3); // 牙齒
    if (S.play('flesh.bite', { h, g: 0.8, at: 0.015 })) return;
    const tear = burst(h.in, t + 0.02, { type: 'bandpass', f: 1300, q: 1.4, dur: 0.22, a: 0.02, g: 0.5 });
    tear.g.gain.cancelScheduledValues(t + 0.02);
    tear.g.gain.setValueCurveAtTime(curve(48, (u) => 0.5 * Math.pow(1 - u, 1.4) * (Math.random() < 0.35 ? 1 : 0.25)), t + 0.02, 0.22); // 撕裂顆粒
    tone(h.in, t + 0.03, { f: 300, f1: 110, dur: 0.15, g: 0.3 });
    burst(h.in, t + 0.04, { type: 'lowpass', f: 1800, f1: 400, dur: 0.1, g: 0.3 });
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
    const h = emit({ pos, cat: 'fx', prio: 2, room: 0.45, dur: 1, ref: 3, roll: 0.9, gain: 0.6, maxDist: 60 });
    if (!h) return;
    const t = h.t;
    tone(h.in, t, { f: 50, f1: 27, dur: 0.45, g: 1 });
    burst(h.in, t, { type: 'lowpass', f: 280, f1: 60, dur: 0.35, g: 0.8 });
    burst(h.in, t, { type: 'bandpass', f: 900, q: 1, dur: 0.04, g: 0.3 });
    for (let i = 0; i < 8; i++) burst(h.in, t + rand(0.05, 0.5), { type: 'bandpass', f: rand(2500, 6000), q: 4, dur: 0.012, g: rand(0.02, 0.05) }); // 震落碎屑
  },
  wallImpact(pos) {
    const h = emit({ pos, cat: 'fx', prio: 4, room: 0.6, hall: 0.45, dur: 2, ref: 4, roll: 0.8, gain: 0.7, maxDist: 80, track: false });
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
    const h = emit({ pos, cat: 'fx', prio: 2, room: 0.3, dur: 0.8, ref: heavy ? 3 : 1.8, gain: heavy ? 0.7 : 0.8, track: false });
    if (!h) return;
    const t = h.t, surf = surfaceAt(pos);
    tone(h.in, t, { f: heavy ? 60 : 95, f1: heavy ? 26 : 40, dur: heavy ? 0.4 : 0.22, g: heavy ? 1 : 0.65 });
    burst(h.in, t, { type: 'lowpass', f: heavy ? 400 : 550, f1: 110, dur: heavy ? 0.3 : 0.18, g: heavy ? 0.85 : 0.55 });
    burst(h.in, t + 0.01, { buf: 'pink', type: 'bandpass', f: 1200, q: 0.7, dur: 0.1, g: 0.15 }); // 衣物
    burst(h.in, t + rand(0.1, 0.16), { type: 'lowpass', f: 700, f1: 200, dur: 0.06, g: 0.25 }); // 四肢落地
    burst(h.in, t + rand(0.18, 0.26), { type: 'lowpass', f: 600, f1: 200, dur: 0.05, g: 0.15 });
    if (surf === 'water') for (let i = 0; i < 8; i++) bubble(h.in, t + rand(0, 0.4), rand(200, 600), 0.12, 0.07);
    else if (surf === 'metal') metal(h.in, t, rand(300, 420), 0.12, 0.5, [1, 1.8, 2.9, 4.2]);
    if (heavy) duck(0.7, 0.4);
  },
  spit(pos) {
    const h = emit({ pos, cat: 'fx', prio: 3, room: 0.3, dur: 0.8, ref: 2, gain: 2.3 });
    if (!h) return;
    const t = h.t;
    burst(h.in, t, { buf: 'pink', type: 'bandpass', f: 1100, f1: 1600, q: 1.2, dur: 0.12, a: 0.18, g: 0.35 }); // 喉嚨蓄痰
    burst(h.in, t + 0.3, { type: 'bandpass', f: 700, q: 2, dur: 0.05, g: 0.55 }); // 噴出
    burst(h.in, t + 0.3, { type: 'lowpass', f: 2200, f1: 500, dur: 0.08, g: 0.3 });
    for (let i = 0; i < 4; i++) bubble(h.in, t + 0.32 + i * 0.03, rand(250, 500), 0.06);
  },
  splash(pos) {
    const h = emit({ pos, cat: 'fx', prio: 2, room: 0.25, dur: 1, ref: 1.8, track: false });
    if (!h) return;
    const t = h.t;
    burst(h.in, t, { type: 'lowpass', f: 1900, f1: 300, dur: 0.12, g: 0.6 });
    for (let i = 0; i < 8; i++) bubble(h.in, t + rand(0.02, 0.3), rand(400, 900), rand(0.03, 0.07), 0.03);
    burst(h.in, t + 0.04, { type: 'highpass', f: 3200, dur: 0.6, a: 0.06, g: 0.12 }); // 腐蝕滋滋
  },
  sizzle(pos) {
    const h = emit({ pos, cat: 'fx', prio: 0, room: 0.15, dur: 0.9, maxDist: 16, ref: 1.2, gain: 0.7, track: false });
    if (!h) return;
    const t = h.t, dur = rand(0.55, 0.8);
    const b = burst(h.in, t, { type: 'highpass', f: rand(2600, 3400), dur, a: 0.05, g: 0.12 });
    b.g.gain.cancelScheduledValues(t);
    b.g.gain.setValueCurveAtTime(curve(64, (u) => 0.12 * Math.sin(Math.PI * u) * (Math.random() < 0.2 ? 1.8 : 0.6)), t, dur); // 劈啪
    for (let i = 0; i < 3; i++) bubble(h.in, t + rand(0, dur), rand(300, 600), 0.03, 0.04);
  },
  burst(pos) {
    const h = emit({ pos, cat: 'fx', prio: 5, room: 0.5, hall: 0.4, dur: 2, ref: 4, roll: 0.85, gain: 0.97, track: false });
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

// 換彈時間軸(合成):len = 實際秒數,整段依名目長度縮放
function reloadSeq(d, t0, id, len, shells, surf) {
  const NOM = { pistol: 1.5, revolver: 2.6, shotgun: 2.9, ak47: 2.5, m4a1: 2.1, barrett: 3.4 };
  const k = id === 'shotgun' ? 1 : clamp(len / (NOM[id] || 1.5), 0.5, 1.8);
  const at = (x) => t0 + x * k;
  cloth(d, t0, 0.25, 0.1);
  if (id === 'revolver') {
    click(d, at(0.1), 2200, 0.3); // 彈巢卡榫
    slide(d, at(0.2), 1500, 2600, 0.1, 0.18);
    clack(d, at(0.31), 2600, 0.28); // 甩出
    slide(d, at(0.55), 1300, 800, 0.08, 0.15); // 退殼桿
    for (let i = 0; i < 6; i++) casing(d, at(rand(0.6, 0.95)), rand(3700, 5200), rand(0.05, 0.09), 'brass', surf);
    for (let i = 0; i < 6; i++) { // 逐發裝填
      const tt = at(1.05 + i * 0.13 + rand(-0.015, 0.015));
      metal(d, tt, rand(2600, 3000), 0.07, 0.05);
      click(d, tt + 0.02, 2000, 0.14);
    }
    clack(d, at(2.05), 2400, 0.42); // 合上
    for (let i = 0; i < 5; i++) click(d, at(2.12 + i * 0.03), 3000, 0.1 * (1 - i * 0.15)); // 棘輪
    click(d, at(2.35), 1700, 0.3); // 擊錘待擊
    click(d, at(2.39), 2600, 0.22);
  } else if (id === 'shotgun') {
    const n = Number.isFinite(shells) ? clamp(shells | 0, 1, 8) : clamp(Math.round((len - 0.8) / 0.42), 1, 8);
    const gap = Math.max(0.28, (len - 0.85) / n);
    cloth(d, t0 + 0.05, 0.2, 0.08); // 翻轉槍身
    for (let i = 0; i < n; i++) {
      const tt = t0 + 0.22 + i * gap + rand(-0.02, 0.02);
      cloth(d, tt - 0.08, 0.08, 0.05); // 從彈帶拿殼
      burst(d, tt, { type: 'bandpass', f: 1100, f1: 750, q: 2, dur: 0.05, g: 0.22 }); // 壓入彈倉
      click(d, tt + 0.045, 2300, 0.2); // 托彈板卡榫
      burst(d, tt + 0.05, { type: 'lowpass', f: 500, dur: 0.04, g: 0.18 });
      metal(d, tt + 0.05, rand(1700, 1900), 0.025, 0.05, [1, 2.5]);
    }
    pump(d, t0 + Math.max(0.5, len - 0.42), 1, surf, false); // 上膛(不再退殼)
  } else if (id === 'barrett') {
    click(d, at(0.22), 2100, 0.3); // 彈匣卡榫
    slide(d, at(0.3), 900, 600, 0.16, 0.24); // 沉重彈匣滑出
    rattle(d, at(0.95), 'heavy', 0.2, surf); // 掉地
    burst(d, at(0.95), { type: 'lowpass', f: 300, f1: 90, dur: 0.12, g: 0.3 });
    cloth(d, at(1.25), 0.25, 0.1);
    slide(d, at(1.6), 650, 1100, 0.18, 0.22); // 新彈匣推入
    clack(d, at(1.86), 800, 0.6);
    tone(d, at(1.86), { f: 110, f1: 55, dur: 0.12, g: 0.3 });
    slide(d, at(2.45), 1900, 950, 0.2, 0.3); // 拉拉柄(粗彈簧)
    tone(d, at(2.45), { type: 'triangle', f: 380, f1: 330, dur: 0.22, g: 0.05 });
    clack(d, at(2.9), 700, 0.85); // 放開:槍機猛力復進
    metal(d, at(2.9), 620, 0.1, 0.35, [1, 1.9, 3.1, 4.6]);
    tone(d, at(2.9), { f: 90, f1: 45, dur: 0.14, g: 0.35 });
  } else if (id === 'ak47') {
    clack(d, at(0.15), 1100, 0.4); // 撥下彈匣
    slide(d, at(0.24), 1200, 700, 0.15, 0.2);
    rattle(d, at(0.85), 'metal', 0.14, surf);
    slide(d, at(1.0), 700, 1300, 0.12, 0.18);
    click(d, at(1.12), 1600, 0.2); // 前緣勾住
    clack(d, at(1.32), 1000, 0.55); // 後壓卡入
    tone(d, at(1.32), { f: 140, f1: 70, dur: 0.08, g: 0.2 });
    slide(d, at(1.72), 2100, 1100, 0.13, 0.25); // 拉機柄
    tone(d, at(1.72), { type: 'triangle', f: 620, f1: 540, dur: 0.12, g: 0.03 });
    clack(d, at(1.88), 1400, 0.65); // 槍機復進
  } else if (id === 'm4a1') {
    click(d, at(0.1), 3000, 0.28); // 釋放鈕
    slide(d, at(0.13), 2200, 1500, 0.09, 0.18);
    rattle(d, at(0.62), 'alu', 0.12, surf);
    slide(d, at(0.78), 1400, 2400, 0.12, 0.2);
    clack(d, at(0.95), 1800, 0.45);
    burst(d, at(1.05), { type: 'lowpass', f: 320, dur: 0.06, g: 0.3 }); // 手掌拍入
    tone(d, at(1.05), { f: 120, f1: 70, dur: 0.07, g: 0.22 });
    slide(d, at(1.45), 2600, 1600, 0.1, 0.22); // 拉柄
    for (let i = 0; i < 3; i++) click(d, at(1.46 + i * 0.025), 3400, 0.08);
    clack(d, at(1.62), 2300, 0.55);
    tone(d, at(1.62), { type: 'triangle', f: 900, f1: 820, dur: 0.14, g: 0.04 }); // 緩衝彈簧
  } else {
    click(d, at(0.08), 2600, 0.28); // 彈匣釋放
    slide(d, at(0.12), 1800, 900, 0.12, 0.18);
    rattle(d, at(0.55), 'plastic', 0.12, surf);
    slide(d, at(0.62), 900, 1800, 0.14, 0.18);
    clack(d, at(0.8), 1500, 0.42);
    tone(d, at(0.8), { f: 140, f1: 80, dur: 0.06, g: 0.2 });
    slide(d, at(1.1), 2200, 1200, 0.06, 0.25); // 滑套後拉
    clack(d, at(1.18), 2100, 0.5); // 放開復進
    metal(d, at(1.18), 3300, 0.05, 0.12);
  }
}

function hitSynth(h, r) {
  const t = h.t;
  burst(h.in, t, { type: 'bandpass', f: 950 * r, f1: 280, q: 1, dur: 0.09, g: 0.45 });
  tone(h.in, t, { f: 150 * r, f1: 50, dur: 0.08, g: 0.32 });
  burst(h.in, t + 0.008, { type: 'lowpass', f: 2600, f1: 500, dur: 0.05, g: 0.22 }); // 濕潤噴濺
  burst(h.in, t + 0.012, { type: 'bandpass', f: 420, f1: 180, q: 5, dur: 0.07, g: 0.2 }); // squelch
  if (Math.random() < 0.3) burst(h.in, t + 0.002, { type: 'highpass', f: 2500, dur: 0.012, g: 0.18 }); // 骨裂
}
function headSynth(h) {
  const t = h.t;
  burst(h.in, t, { type: 'highpass', f: 2400, dur: 0.016, g: 0.55 }); // 頭骨碎裂
  burst(h.in, t, { type: 'bandpass', f: 1600, q: 3, dur: 0.05, g: 0.4 });
  tone(h.in, t, { f: 180, f1: 60, dur: 0.09, g: 0.3 });
  for (let i = 0; i < 4; i++) burst(h.in, t + 0.015 + i * rand(0.02, 0.04), { type: 'lowpass', f: rand(1500, 3000), f1: 400, dur: 0.045, g: 0.16 }); // 噴濺
  tone(h.in, t + 0.01, { f: 1900, dur: 0.09, g: 0.07 }); // 爆頭提示音(輕)
  tone(h.in, t + 0.01, { f: 2870, dur: 0.07, g: 0.04 });
}

// 泵動:滑套後拉(退殼)→ 前推上膛;eject 時塑膠殼落地
function pump(d, t, g, surf, eject) {
  slide(d, t, 900, 1500, 0.09, 0.3 * g);
  clack(d, t + 0.09, 1250, 0.5 * g);
  metal(d, t + 0.09, 2100, 0.05 * g, 0.08);
  slide(d, t + 0.17, 1500, 1000, 0.07, 0.25 * g);
  clack(d, t + 0.25, 1700, 0.6 * g);
  tone(d, t + 0.25, { f: 160, f1: 80, dur: 0.06, g: 0.2 * g });
  if (eject) casingAt(d, t + rand(0.5, 0.65), 0, 0.06 * g, 'hull', surf);
}

// 耳鳴:非定位、不受悶音影響
export function tinnitus(g, dur) {
  const h = emit({ bus: 'ui', dur: dur + 0.3, gain: 1 });
  if (!h) return;
  const f = rand(3700, 4300);
  tone(h.in, h.t, { f, dur, a: 0.05, g });
  tone(h.in, h.t, { f: f * 1.013, dur: dur * 0.8, a: 0.08, g: g * 0.4 });
}
