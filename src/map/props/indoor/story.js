// [scene r4] 故事場景(STORY_v2):冷開場的大廳、廣播室、B1 裝卸平台……
// 文字都是道具上的字(資料),不動 src/horror、src/interact 的台詞。
import { tpl, L, G } from './parts.js';
import { labRect, decalRect } from './atlas.js';
import { D } from './geo.js';
import { glowSwatch } from './art.js';

const PI = Math.PI;
const rnd = (seed) => { let s = seed >>> 0 || 1; return () => ((s = (s * 16807) % 2147483647) / 2147483647); };

// ================================================================ 大廳(冷開場)
// 萬嵐 2026 的白布條「回神照護中心 歡迎回家」(掛在 2F 迴廊欄杆之間,右端鬆脫垂下)
const bannerRect = () => labRect('story:banner', 448, 49, (c, w, h) => {
  c.save(); c.scale(0.875, 0.875); w = 512; h = 56;
  c.fillStyle = '#f3f4f1'; c.fillRect(0, 0, w, h);
  c.fillStyle = '#1d8a86'; c.fillRect(0, 0, w, 5); c.fillRect(0, h - 5, w, 5);
  c.fillStyle = '#1d8a86'; c.beginPath(); c.arc(30, h / 2, 14, 0, PI * 2); c.fill();
  c.fillStyle = '#f3f4f1'; c.beginPath(); c.arc(34, h / 2 - 3, 9, 0, PI * 2); c.fill();
  c.fillStyle = '#1d8a86'; c.font = 'bold 13px sans-serif'; c.textAlign = 'left'; c.fillText('萬嵐生醫', 52, h / 2 + 5);
  c.font = 'bold 30px sans-serif'; c.textAlign = 'center'; c.fillStyle = '#16615e'; c.fillText('回神照護中心  歡迎回家', w / 2 + 40, h / 2 + 11);
  c.fillStyle = 'rgba(90,80,60,0.14)'; for (let i = 0; i < 40; i++) c.fillRect((i * 97) % w, (i * 31) % h, 18, 2);
  c.restore();
});
// 北口柱子上褪色的紅漆(直書)
const paintRect = () => decalRect('story:dontrust', 64, 300, (c, w, h) => {
  c.clearRect(0, 0, w, h);
  c.fillStyle = 'rgba(150,22,16,0.78)'; c.font = 'bold 44px serif'; c.textAlign = 'center';
  [...'不要相信廣播'].forEach((ch, i) => c.fillText(ch, w / 2 + (i % 2 ? 2 : -2), 44 + i * 47));
  for (let i = 0; i < 9; i++) { const x = 10 + ((i * 37) % 44), y0 = 30 + ((i * 53) % 230); c.fillStyle = 'rgba(150,22,16,0.5)'; c.fillRect(x, y0, 2, 18 + (i % 4) * 9); }
  c.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < 120; i++) { c.fillStyle = `rgba(0,0,0,${0.3 + (i % 5) * 0.12})`; c.fillRect((i * 29) % w, (i * 71) % h, 3 + (i % 4), 2 + (i % 3)); }
  c.globalCompositeOperation = 'source-over';
});
const banner = () => tpl('story:banner', (b) => {
  // 11.6m 寬,左端與中段綁在欄杆上;右端鬆脫,斜斜垂下
  const rect = bannerRect();
  const g = b.plane(L(rect), 11.6, 0.95, 0, 0, 0, { ws: 12, hs: 1 });
  void g;
  b.rod('pl_white', 0.005, [-5.8, 0.47, 0], [-5.9, 0.62, 0], { seg: 3 });
  b.rod('pl_white', 0.005, [0, 0.47, 0], [0, 0.62, 0], { seg: 3 });
});
const balloon = (col, k) => tpl(`story:balloon:${col}:${k}`, (b) => {
  b.sph(col, 0.15, 0, 0, 0, { sy: 1.22, ws: 12, hs: 9 });
  b.cyl(col, 0.012, 0.03, 0, -0.19, 0, { seg: 6, r2: 0.004 });
  b.rod('pl_white', 0.0015, [0, -0.2, 0], [0.02 + (k % 3) * 0.02, -1.1 - (k % 4) * 0.25, 0.01], { seg: 3 });
});
// 拖鞋(藍/粉紅塑膠)、包包、被踩爛的花束
const slipper = (col) => tpl(`story:slipper:${col}`, (b) => {
  b.box(col, 0.1, 0.022, 0.26, 0, 0.011, 0, { r: 0.01 });
  b.box(col, 0.104, 0.035, 0.07, 0, 0.035, 0.05, { r: 0.012 });
});
const handbag = (col, k) => tpl(`story:bag:${col}:${k}`, (b) => {
  b.box(col, 0.32, 0.22, 0.12, 0, 0.11, 0, { r: 0.03, rz: k ? 1.45 : 0 });
  if (!k) b.tor(col, 0.09, 0.008, 0, 0.24, 0, { ts: 12, rs: 4, arc: PI });
});
const bouquet = (k) => tpl(`story:bouquet:${k}`, (b) => {
  const r = rnd(k + 5);
  b.cyl('pl_clear', 0.11, 0.42, 0, 0.05, 0, { r2: 0.02, rz: PI / 2 - 0.06, seg: 10, open: true });
  b.box('paper', 0.32, 0.01, 0.2, 0.02, 0.012, 0, { ry: 0.3 });
  for (let i = 0; i < 7; i++) b.sph(['fab_white', 'fab_pink', 'fab_yellow', 'fab_red'][(i + k) % 4], 0.034, -0.17 + r() * 0.08, 0.025, (r() - 0.5) * 0.18, { sy: 0.45, ws: 7, hs: 5 });
  for (let i = 0; i < 3; i++) b.box('leaf_dead', 0.08, 0.004, 0.03, -0.1 + r() * 0.3, 0.004, (r() - 0.5) * 0.3, { ry: r() * 3 });
});

export function lobbyColdOpen(R) {
  const y = R.y, LY = R.L, r = rnd(4217);
  // 布條:2F 迴廊兩側欄杆之間(挑空 x 54–66),z 57.8
  R.put(banner(), 60.2, 57.8, 0, { y: 4.2 + 0.55, rz: -0.035 });
  // 右端鬆脫垂下的一角(另一片,斜掛)
  R.put(tpl('story:bannerflap', (b) => { b.box('fab_white', 0.04, 0.9, 0.012, 0, -0.45, 0, { rz: 0.25 }); }), 66.0, 57.8, 0, { y: 4.2 + 1.0 });
  // 氣球:飄到挑空最高處(天窗下)聚成一團,繩子垂下來
  const top = (c, rr) => { const v = LY.ceilY?.(3, c, rr); return Number.isFinite(v) ? v : 8.4 + 4.2; };
  const cols = ['pl_red', 'pl_yellow', 'pl_blue', 'pl_white', 'pl_pink', 'pl_red', 'pl_teal'];
  for (let i = 0; i < 26; i++) {
    const a = r() * PI * 2, d = Math.sqrt(r()) * 3.2, x = 60 + Math.cos(a) * d * 1.3, z = 60.5 + Math.sin(a) * d * 0.8;
    const cy = top(Math.floor(x / 2), Math.floor(z / 2)) - 0.24 - r() * 0.22;
    const k = i % 7;
    R.put(balloon(cols[k], i % 5), x, z, r() * 6.28, { y: cy, rx: (r() - 0.5) * 0.3, rz: (r() - 0.5) * 0.3 });
  }
  // 地上:拖鞋(成雙的被踢散)、包包、花束 —— 從入口往服務台的方向
  const spots = [];
  for (let i = 0; i < 46; i++) spots.push([R.rand(51, 70), R.rand(57.8, 65.2)]);
  let ns = 0, nb = 0, nf = 0;
  for (const [x, z] of spots) {
    if (!R.freeAt(x, z, 0.25)) continue;
    const roll = r();
    if (roll < 0.55 && ns < 18) { R.put(slipper(['pl_blue', 'pl_pink', 'pl_white', 'pl_green'][ns % 4]), x, z, r() * 6.28, { collide: false, rz: r() < 0.25 ? PI : 0, y: y + (r() < 0.25 ? 0.024 : 0) }); ns++; }
    else if (roll < 0.75 && nb < 6) { R.put(handbag(['leather_brown', 'leather_black', 'fab_red', 'vinyl_cream'][nb % 4], nb % 2), x, z, r() * 6.28, { collide: false }); nb++; }
    else if (nf < 6) { R.put(bouquet(nf), x, z, r() * 6.28, { collide: false }); nf++; }
  }
  // 北口東側柱子(x 68–72, z 54–56)朝西那一面:褪色的紅漆直書
  R.put(tpl('story:dontrust', (b) => b.plane(D(paintRect()), 0.4, 1.9, 0, 0.95, 0)), 67.9, 55.0, -PI / 2, { y: y + 0.45 });
  return { ns, nb, nf };
}
void G; void glowSwatch;
