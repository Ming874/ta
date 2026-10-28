// [scene r5] 其餘房間的故事層(STORY_v2):ICU、小兒病房、產房、院長室(萬嵐層)、廣播室、監控室的光、洗衣房、六間病房
// 全部用共用道具材質(tpl → 自動帶 src/mats 表面資料);文字是道具上的字。
import { tpl, L, G } from './parts.js';
import { labRect } from './atlas.js';
import { glowSwatch } from './art.js';
import { plasticWall } from './sars.js';
import { kidBed } from './decor.js';

const rnd = (seed) => { let s = seed >>> 0 || 1; return () => ((s = (s * 16807) % 2147483647) / 2147483647); };
const glowScr = (c) => G(glowSwatch(c, c));

// ---------------- ICU ----------------
const vitalMon = () => tpl('r5:vitalmon', (b) => {
  b.box('pl_beige', 0.36, 0.3, 0.32, 0, 0.15, 0, { r: 0.02 });
  b.plane(glowScr('#2a7a50'), 0.26, 0.19, 0, 0.165, 0.161);
  b.box('pl_dark', 0.3, 0.03, 0.02, 0, 0.02, 0.16);
});
const ventilator = () => tpl('r5:vent', (b) => {
  b.box('pl_cream', 0.42, 0.9, 0.38, 0, 0.55, 0, { r: 0.02 });
  b.plane(glowScr('#3a8a9a'), 0.22, 0.14, 0, 0.82, 0.191);
  for (const s of [-1, 1]) b.cyl('rubber', 0.03, 0.04, s * 0.16, 0.05, 0.14, { seg: 8, axis: 'x' });
  b.tube('pl_clear', [[0.12, 0.7, 0.2], [0.3, 0.75, 0.45], [0.55, 0.62, 0.5], [0.75, 0.68, 0.35]], 0.012, { seg: 5, bend: 0.06 });
});
const o2Tank = () => tpl('r5:o2', (b) => { b.cyl('enamel_green', 0.09, 1.1, 0, 0.55, 0, { seg: 12 }); b.cyl('chrome', 0.03, 0.08, 0, 1.14, 0, { seg: 8 }); });

// ---------------- 小兒病房 ----------------
const kidDrawing = (k) => labRect(`r5:kid:${k}`, 96, 72, (c, w, h) => {
  c.fillStyle = '#f6f2e8'; c.fillRect(0, 0, w, h);
  c.lineWidth = 3; const cols = ['#e05050', '#3a70d0', '#30a050', '#e0a020'];
  c.strokeStyle = cols[k % 4]; c.beginPath(); c.arc(30, 32, 12, 0, 6.28); c.stroke(); c.beginPath(); c.moveTo(30, 44); c.lineTo(30, 64); c.moveTo(18, 52); c.lineTo(42, 52); c.stroke();
  c.strokeStyle = cols[(k + 1) % 4]; c.beginPath(); c.arc(64, 36, 9, 0, 6.28); c.stroke(); c.beginPath(); c.moveTo(64, 45); c.lineTo(64, 62); c.stroke();
  c.fillStyle = '#2a2a2a'; c.font = 'bold 11px sans-serif'; c.fillText(['媽媽 我想回家', '我很乖 不哭', '護士阿姨', '五月 要出院'][k % 4], 8, 14);
});
const maskedTeddy = () => tpl('r5:teddy', (b) => {
  b.sph('plush_brown', 0.12, 0, 0.12, 0, { sy: 0.95 }); b.sph('plush_brown', 0.085, 0, 0.29, 0.01);
  for (const s of [-1, 1]) { b.sph('plush_brown', 0.03, s * 0.06, 0.36, 0, {}); b.sph('plush_brown', 0.04, s * 0.11, 0.05, 0.05, {}); }
  b.box('fab_white', 0.1, 0.05, 0.03, 0, 0.27, 0.08, { r: 0.012 }); // 小熊也戴口罩
});
const craneMobile = () => tpl('r5:cranes', (b) => {
  b.rod('wood_toy', 0.004, [-0.25, 0, 0], [0.25, 0, 0], { seg: 3 });
  for (let i = 0; i < 5; i++) { const x = -0.22 + i * 0.11, yy = -0.15 - (i % 3) * 0.08; b.rod('pl_white', 0.0012, [x, 0, 0], [x, yy, 0], { seg: 3 }); b.box(['fab_pink', 'fab_yellow', 'fab_blue', 'fab_red', 'fab_green'][i], 0.05, 0.02, 0.03, x, yy - 0.01, 0, { ry: i, rz: 0.4 }); }
});

// ---------------- 產房 ----------------
const birthCard = () => labRect('r5:birth', 72, 48, (c, w, h) => {
  c.fillStyle = '#f9d8e0'; c.fillRect(0, 0, w, h); c.fillStyle = '#7a2a3a'; c.font = 'bold 10px sans-serif';
  c.fillText('女  2950g', 6, 14); c.fillText('92.5.2  03:17', 6, 28); c.fillText('母:林○○', 6, 42);
});
const bassinet = () => tpl('r5:bassinet', (b) => {
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.rod('chrome', 0.01, [sx * 0.25, 0, sz * 0.18], [sx * 0.25, 0.62, sz * 0.18], { seg: 5 });
  b.box('pl_clear', 0.6, 0.26, 0.42, 0, 0.75, 0, { r: 0.02 });
  b.box('fab_pink', 0.54, 0.05, 0.36, 0, 0.65, 0);
  b.plane(L(birthCard()), 0.12, 0.08, 0, 0.8, 0.212);
});
const driedFlowers = () => tpl('r5:dried', (b) => {
  b.cyl('ceramic', 0.06, 0.2, 0, 0.1, 0, { seg: 10, r2: 0.045 });
  for (let i = 0; i < 6; i++) { const a = i * 1.05; b.rod('leaf_dead', 0.003, [0, 0.18, 0], [Math.cos(a) * 0.08, 0.42, Math.sin(a) * 0.08], { seg: 3 }); b.sph('leaf_dead', 0.022, Math.cos(a) * 0.08, 0.43, Math.sin(a) * 0.08, { ws: 6, hs: 4 }); }
});

// ---------------- 院長室:萬嵐 2024 的白 ----------------
const plaqueRect = () => labRect('r5:wanlan', 160, 64, (c, w, h) => {
  c.fillStyle = '#f4f5f2'; c.fillRect(0, 0, w, h); c.fillStyle = '#1d8a86'; c.beginPath(); c.arc(30, h / 2, 16, 0, 6.28); c.fill();
  c.fillStyle = '#f4f5f2'; c.beginPath(); c.arc(35, h / 2 - 4, 10, 0, 6.28); c.fill();
  c.fillStyle = '#16615e'; c.font = 'bold 20px sans-serif'; c.fillText('大新生技', 56, 30); c.font = '9px sans-serif'; c.fillText('DAXIN BIOTECH · 大新照護中心', 56, 48);
});
const boxRect = () => labRect('r5:confbox', 96, 48, (c, w, h) => {
  c.fillStyle = '#e8e2d2'; c.fillRect(0, 0, w, h); c.fillStyle = '#9a1a12'; c.font = 'bold 13px sans-serif'; c.fillText('喚醒針 臨床', 8, 20); c.fillText('機密 銷毀', 8, 38);
});
const shredder = () => tpl('r5:shred', (b) => {
  b.box('pl_dark', 0.36, 0.55, 0.26, 0, 0.275, 0, { r: 0.015 }); b.box('pl_gray', 0.38, 0.1, 0.28, 0, 0.6, 0, { r: 0.01 });
  for (let i = 0; i < 9; i++) b.box('paper', 0.006, 0.12, 0.002, -0.12 + i * 0.03, 0.47, 0.135, { rz: (i % 3 - 1) * 0.2 });
});
const docBox = () => tpl('r5:docbox', (b) => { b.box('pi_cardboard', 0.42, 0.28, 0.32, 0, 0.14, 0, { r: 0.006 }); b.plane(L(boxRect()), 0.3, 0.15, 0, 0.15, 0.161); });
const trophy = () => tpl('r5:trophy', (b) => { b.box('wood_dark', 0.12, 0.05, 0.08, 0, 0.025, 0); b.lathe('gold', [[0.02, 0], [0.012, 0.08], [0.05, 0.16], [0.055, 0.2], [0, 0.2]], 0, 0.05, 0, { seg: 12 }); });

// ---------------- 廣播室 ----------------
const zoneRect = () => labRect('r5:pazones', 128, 72, (c, w, h) => {
  c.fillStyle = '#d9d4c6'; c.fillRect(0, 0, w, h); c.fillStyle = '#222'; c.font = '9px sans-serif';
  ['B1', '1F 大廳', '1F 門診', '2F 北', '2F 南', '3F', '頂樓', '全館'].forEach((t, i) => {
    const x = 6 + (i % 4) * 30, y = 16 + ((i / 4) | 0) * 30;
    c.fillStyle = '#222'; c.fillText(t, x, y); c.fillStyle = i === 1 ? '#c02010' : '#555'; c.fillRect(x + 4, y + 4, 12, 8);
  });
});
const paDesk = () => tpl('r5:padesk', (b) => {
  b.box('wood_dark', 1.3, 0.04, 0.6, 0, 0.74, 0); for (const sx of [-1, 1]) b.box('wood_dark', 0.04, 0.74, 0.58, sx * 0.62, 0.37, 0);
  b.box('pl_beige', 0.62, 0.14, 0.4, -0.2, 0.83, 0.05, { r: 0.01 });
  for (let i = 0; i < 6; i++) b.cyl('pl_dark', 0.012, 0.03, -0.44 + i * 0.07, 0.91, 0.13, { seg: 8 });
  b.plane(L(zoneRect()), 0.3, 0.17, -0.08, 0.95, -0.05, { rx: -0.6 });
  b.cyl('pl_dark', 0.05, 0.02, -0.4, 0.91, -0.05, { seg: 10 });
  b.tube('chrome', [[-0.4, 0.92, -0.05], [-0.4, 1.1, -0.03], [-0.36, 1.2, 0.05]], 0.006, { seg: 5, bend: 0.05 });
  b.cyl('pl_dark', 0.018, 0.07, -0.35, 1.21, 0.08, { seg: 8, rx: 1.1 });
  b.box('wood_dark', 0.2, 0.14, 0.12, 0.35, 0.83, -0.05, { r: 0.01 }); // 叮咚音箱
  b.sph(glowScr('#ff3020'), 0.018, -0.2, 0.93, 0.25, {}); // ON AIR
});
const ampRack = () => tpl('r5:amprack', (b) => {
  b.box('pl_dark', 0.5, 1.2, 0.45, 0, 0.6, 0, { r: 0.01 });
  for (let i = 0; i < 5; i++) { b.box('alu', 0.46, 0.14, 0.02, 0, 0.25 + i * 0.19, 0.226); b.sph(glowScr(i % 2 ? '#30ff60' : '#ffb030'), 0.007, 0.18, 0.25 + i * 0.19, 0.24, {}); }
});

// ---------------- 洗衣房 ----------------
const washer = () => tpl('r5:washer', (b) => {
  b.box('enamel_white', 1.1, 1.4, 1.0, 0, 0.7, 0, { r: 0.03 });
  b.cyl('chrome', 0.32, 0.05, 0, 0.8, 0.5, { axis: 'z', seg: 18 }); b.cyl('glass_dark', 0.26, 0.03, 0, 0.8, 0.52, { axis: 'z', seg: 18 });
  b.box('pl_gray', 0.9, 0.18, 0.02, 0, 1.25, 0.505);
});
const linenBag = (k) => tpl(`r5:linenbag:${k}`, (b) => { const m = k ? 'fab_yellow' : 'fab_white'; b.sph(m, 0.28, 0, 0.24, 0, { sy: 0.85 }); b.cyl(m, 0.05, 0.12, 0, 0.5, 0, { seg: 8 }); });

// ---------------- 病房的小東西 ----------------
const radio = () => tpl('r5:radio', (b) => { b.box('pl_red', 0.22, 0.13, 0.07, 0, 0.065, 0, { r: 0.015 }); b.cyl('alu', 0.04, 0.005, -0.05, 0.07, 0.036, { axis: 'z', seg: 12 }); b.rod('chrome', 0.002, [0.08, 0.13, 0], [0.12, 0.42, -0.04], { seg: 3 }); });
const suitcase = () => tpl('r5:suitcase', (b) => { b.box('vinyl_blue', 0.45, 0.62, 0.2, 0, 0.32, 0, { r: 0.02 }); b.tor('pl_dark', 0.06, 0.008, 0, 0.66, 0, { ts: 10, rs: 4, arc: Math.PI }); });
const chessBoard = () => tpl('r5:xiangqi', (b) => { b.box('wood_yellow', 0.36, 0.015, 0.4, 0, 0.0075, 0); for (let i = 0; i < 12; i++) b.cyl(i % 2 ? 'wood_red' : 'wood_old', 0.016, 0.01, -0.14 + (i % 4) * 0.09, 0.02, -0.15 + ((i / 4) | 0) * 0.13, { seg: 10 }); });
const altar = () => tpl('r5:altar', (b) => {
  b.box('wood_red', 0.5, 0.03, 0.3, 0, 0.015, 0.15);
  b.lathe('ceramic', [[0, 0], [0.04, 0], [0.035, 0.08], [0.02, 0.16], [0.03, 0.2], [0, 0.24]], -0.1, 0.03, 0.15, { seg: 10 });
  b.cyl('brass', 0.045, 0.05, 0.1, 0.055, 0.15, { seg: 12 }); for (let i = 0; i < 3; i++) b.rod('wood_red', 0.0025, [0.09 + i * 0.01, 0.08, 0.15], [0.09 + i * 0.012, 0.2, 0.15], { seg: 3 });
  b.box('fab_yellow', 0.05, 0.08, 0.004, 0.0, 0.07, 0.29); // 平安符
});
const plasticCover = () => tpl('r5:wrap', (b) => { b.box('pl_clear', 1.0, 0.9, 2.1, 0, 0.45, 0, { r: 0.05 }); b.box('fab_white', 0.25, 0.12, 0.004, 0.2, 0.72, 1.051); });
const newsRect = () => labRect('r5:news', 96, 120, (c, w, h) => {
  c.fillStyle = '#e8e2cf'; c.fillRect(0, 0, w, h); c.fillStyle = '#222'; c.font = 'bold 13px serif'; c.fillText('聖心封院', 6, 18); c.font = 'bold 10px serif'; c.fillText('第九天 家屬院外守候', 6, 33);
  c.fillStyle = 'rgba(40,40,40,0.55)'; for (let i = 0; i < 12; i++) c.fillRect(6, 42 + i * 6, 40 + (i * 13) % 44, 2);
  c.fillStyle = '#555'; c.font = '8px serif'; c.fillText('2003年5月7日', 6, 116);
});
const newspaper = (k) => tpl(`r5:news:${k}`, (b) => b.plane(L(newsRect()), 0.38, 0.48, 0, 0.003, 0, { rx: -Math.PI / 2, rz: k }));
const railNote = () => labRect('r5:railnote', 64, 80, (c, w, h) => {
  c.fillStyle = '#f2ecd8'; c.fillRect(0, 0, w, h); c.fillStyle = '#1f2f6e'; c.font = 'bold 11px serif';
  ['爸爸', '收音機', '開著喔', '小美陪你'].forEach((t, i) => c.fillText(t, 6, 16 + i * 17));
});

export function roomStory(R, zone) {
  const id = zone.id, y = R.y;
  const x0 = R.c0 * 2, z0 = R.r0 * 2, x1 = (R.c1 + 1) * 2, z1 = (R.r1 + 1) * 2;
  const r = rnd(id.length * 31 + R.c0 * 7);
  const W = R.run('W'), E = R.run('E'), N = R.run('N'), S = R.run('S');
  const ceil = () => R.L.ceilY(R.li, R.c0, R.r0) - y;
  if (id === 'f2_icu') {
    // SARS 加護:每床一台呼吸器 + 綠色監視器 + 氧氣瓶;入口一道負壓塑膠前室;監視器的綠光是這裡唯一「活著」的光
    for (let i = 0; i < 3; i++) {
      const x = x0 + 2.4 + i * 5.2, z = z0 + 1.5;
      if (R.freeAt(x, z, 0.35)) R.tryPut(ventilator(), x, z, 0.2, {});
      if (R.freeAt(x - 0.65, z + 0.2, 0.15)) R.tryPut(o2Tank(), x - 0.65, z + 0.2, 0, {});
      R.put(vitalMon(), x + 0.55, z + 0.05, 0.1, { y: y + 1.05 });
    }
    R.light({ x: (x0 + x1) / 2, y: y + 1.3, z: z0 + 2.4, color: 0x6ad0a0, intensity: 2.6, distance: 7, kind: 'monitor', flicker: 0.4 });
    if (S) R.put(plasticWall(3.2, Math.min(2.9, ceil() - 0.1), 2), (x0 + x1) / 2, z1 - 1.8, 0, { collide: false });
  } else if (id === 'f2_peds') {
    // 小兒病房:牆上兒童畫、床上戴口罩的小熊、紙鶴吊飾;一盞粉紅夜燈
    const DW = S || W;
    if (DW) for (let i = 0; i < 4; i++) R.atWall(tpl(`r5:kidsheet:${i}`, (b) => b.plane(L(kidDrawing(i)), 0.4, 0.3, 0, 0.15, 0.004)), DW, DW.t0 + 1.2 + i * 1.3, { mount: 1.2 + (i % 2) * 0.12 });
    // 一排兒童床(靠北牆),床上戴口罩的小熊
    if (N) for (let i = 0; i < 4; i++) { const t = N.t0 + 1.0 + i * 2.6; if (t > N.t1 - 0.8) break; const p = R.atWall(kidBed(i), N, t, { gap: 0.05 }); if (p && i % 2 === 0) { const tp = R.topOf(p, 0); if (tp) R.put(maskedTeddy(), (tp.x0 + tp.x1) / 2, (tp.z0 + tp.z1) / 2, r() * 6, { y: tp.y }); } }
    R.put(craneMobile(), x0 + 4.0, z0 + 2.4, 0.3, { y: y + 2.4 });
    R.light({ x: x0 + 1.2, y: y + 0.45, z: z1 - 1.0, color: 0xff9ab4, intensity: 1.8, distance: 6, kind: 'nightlight', flicker: 0 });
  } else if (id === 'f2_delivery') {
    // 產房:嬰兒推床與出生卡(92.5.2,封院前一天出生)、一瓶乾掉的花
    const c = R.center();
    for (const [dx, dz] of [[1.6, 1.2], [-1.4, 1.6], [2.4, -0.8]]) if (R.freeAt(c.x + dx, c.z + dz, 0.4)) { R.tryPut(bassinet(), c.x + dx, c.z + dz, 0.4, {}); break; }
    if (S) R.atWall(driedFlowers(), S, S.t0 + 1.0, { gap: 0.1, collide: false });
  } else if (id === 'f3_director') {
    // 院長室的萬嵐層:白色企業識別牌、獎盃、碎紙機、成箱「回神 臨床 機密 銷毀」與一地碎紙
    if (W) R.atWall(tpl('r5:plaque', (b) => { b.box('pl_white', 0.86, 0.38, 0.03, 0, 0.19, 0.015); b.plane(L(plaqueRect()), 0.8, 0.32, 0, 0.19, 0.032); }), W, (z0 + z1) / 2, { mount: 1.55 });
    if (E) R.atWall(shredder(), E, z0 + 1.2, { gap: 0.05 });
    for (let i = 0; i < 4; i++) R.put(docBox(), x1 - 1.4 - (i % 2) * 0.48, z0 + 2.2, 0.05 * i, { y: y + (i > 1 ? 0.28 : 0) });
    const bit = tpl('r5:shredbit', (b) => b.box('paper', 0.006, 0.002, 0.12, 0, 0.001, 0));
    for (let i = 0; i < 24; i++) R.put(bit, x1 - 1.0 + (r() - 0.5) * 1.3, z0 + 1.4 + (r() - 0.5) * 1.1, r() * 6, { collide: false });
    if (N) { R.atWall(tpl('r5:shelf', (b) => { b.box('pl_white', 1.2, 0.03, 0.25, 0, 0.015, 0.125); b.add(trophy(), -0.3, 0.03, 0.12); b.add(trophy(), 0.25, 0.03, 0.12); }), N, x0 + 2.0, { mount: 1.5 }); }
  } else if (id === 'f1_security') {
    // 廣播室:2003 年的院內廣播主機就在這裡(「不要相信廣播」的源頭)
    if (S) { R.atWall(paDesk(), S, S.t1 - 1.0, { gap: 0.03 }); R.atWall(ampRack(), S, S.t1 - 2.2, { gap: 0.03 }); }
  } else if (id === 'f3_monitor') {
    // 監控室的 CRT 藍光從門口漏到 3F 走廊(「被錄下來的真相」的顏色)
    R.light({ x: (x0 + x1) / 2, y: y + 1.4, z: z1 - 0.6, color: 0x7ab8e0, intensity: 3.2, distance: 7.5, kind: 'monitor', flicker: 0.4 });
  } else if (id === 'b1_laundry') {
    // 洗衣房入口:兩台大型滾筒洗衣機、裝感染布單的黃袋
    const ent = z0 + 1.6;
    for (let i = 0; i < 2; i++) R.tryPut(washer(), x0 + 1.0, ent + i * 1.3, Math.PI / 2, {});
    for (let i = 0; i < 5; i++) { const x = x0 + 3.0 + r() * 1.6, z = ent + r() * 2.2; if (R.freeAt(x, z, 0.3)) R.put(linenBag(i % 2), x, z, r() * 6, { collide: false }); }
  }
}

// 其餘病房各一層故事(201、202、205、206、208、210;203/209 在 story.js)
export function wardStory2(R, n) {
  const E = R.run('E'), W = R.run('W');
  const z0 = R.r0 * 2, c = R.center();
  if (n === 201) {
    // 小鈴的頻道:床頭的紅色收音機(AM 1207),床欄上家屬的字條
    if (E) R.atWall(radio(), E, z0 + 0.42, { mount: 0.66, collide: false });
    if (W) R.atWall(tpl('r5:railnotesheet', (b) => b.plane(L(railNote()), 0.15, 0.19, 0, 0.1, 0.004)), W, z0 + 2.1, { mount: 0.6 });
  } else if (n === 202) {
    for (let i = 0; i < 4; i++) { const x = c.x - 0.8 + (i % 2) * 0.6, z = z0 + 3.0 + ((i / 2) | 0) * 0.55; if (R.freeAt(x, z, 0.25)) R.put(newspaper(i * 0.4), x, z, 0, { collide: false }); }
  } else if (n === 205) {
    // 阿嬤照顧過的阿伯(鐵網上:「護理長 謝謝您 照顧我爸爸 2F 205」):床邊桌上一盤沒下完的象棋
    R.put(chessBoard(), c.x + 0.6, z0 + 2.1, 0.3, { y: R.y + 0.78, collide: false });
  } else if (n === 206) {
    if (E) R.atWall(suitcase(), E, z0 + 2.6, { gap: 0.04 }); // 收拾好的行李:五月十三號要接回家
  } else if (n === 208) {
    if (W) R.atWall(altar(), W, z0 + 3.2, { mount: 1.25, collide: false }); // 家屬帶來的小神桌
  } else if (n === 210) {
    for (const [run, t] of [[E, z0 + 1.3], [W, z0 + 1.3]]) if (run) { const p = R.at(run, t, 1.08); R.put(plasticCover(), p.x, p.z, Math.PI / 2, { y: R.y + 0.05, collide: false }); } // 萬嵐 2024 的「封存」
  }
}
