// [scene6] 醫院的「設備層」:走廊牆上與門邊那些真實建築一定有、但不起眼的東西,讓空間讀起來像真的醫院。
//  - 門上的緊急照明燈(台灣常見的白盒雙燈頭,有的燈頭掉了)
//  - 病房/加護/產房門邊的壁掛乾洗手機(2003 年 SARS 時期每扇門都有)+ 下方滴痕
//  - 低位避難方向指示燈(白底綠色奔跑人形 + 箭頭,指向最近的樓梯)
//  - 外轉角的不鏽鋼護角
//  - 磨耗:門框兩側的手垢、門腳踢痕、推床撞牆的擦痕、走廊中央的動線磨耗、門口的鞋跟刮痕、雨夜從外面踩進來的泥腳印
// 全部是共用道具材質 + pi_lab / pi_glow / pi_decal 圖集,經 Room.put 進區域合併(不新增材質、不新增 draw call)。
import { tpl, L, G, led } from './parts.js';
import { labRect, glowRect, atlasStats } from './atlas.js';
import { text } from './tex.js';
import { floorDecal, wallDecal, ctpl } from './clutter.js';

const HALF = Math.PI / 2;
const SIDE_YAW = { N: 0, S: Math.PI, W: HALF, E: -HALF };
const sideOf = (nx, nz) => (nz === 1 ? 'N' : nz === -1 ? 'S' : nx === 1 ? 'W' : 'E');
// 門的另一側是病人房間(門邊放乾洗手機)
const PATIENT = new Set(['ward', 'icu', 'peds_ward', 'nursery', 'delivery', 'surgery', 'er', 'playroom', 'psych_cell']);

// ---------------------------------------------------------------- 模板
// 緊急照明燈:白色塑膠盒 + 左右兩個可轉的圓燈頭 + 充電指示燈;k=1 一個燈頭掉了、只剩電線垂著
const emLight = (k = 0) => tpl(`svc:emlight:${k % 3}`, (b) => {
  b.box('pl_white', 0.34, 0.1, 0.07, 0, 0.05, 0.035);
  b.box('pl_gray', 0.3, 0.012, 0.004, 0, 0.026, 0.0715); // 下緣通風縫
  led(b, 0.12, 0.07, 0.071, k === 2 ? '#ff4020' : '#30ff60', 0.004);
  b.plane(L(emLabel()), 0.12, 0.03, -0.05, 0.068, 0.0712);
  for (const sx of [-1, 1]) {
    if (k === 1 && sx > 0) { b.tube('pl_dark', [[sx * 0.13, 0.1, 0.03], [sx * 0.14, 0.04, 0.05], [sx * 0.15, -0.06, 0.06]], 0.003, { seg: 3, bend: 0.03 }); continue; }
    b.cyl('pl_white', 0.012, 0.03, sx * 0.13, 0.11, 0.035, { seg: 6 }); // 轉軸
    b.push(sx * 0.13, 0.135, 0.04, -0.55, sx * 0.35, 0);
    b.cyl('pl_white', 0.042, 0.06, 0, 0, 0, { axis: 'z', seg: 8 });
    b.cyl('glass_frosted', 0.034, 0.004, 0, 0, 0.031, { axis: 'z', seg: 8 });
    b.pop();
  }
});
const emLabel = () => labRect('svc:emlabel', 96, 24, (c, w, h) => { c.fillStyle = '#eeeeea'; c.fillRect(0, 0, w, h); text(c, '緊急照明燈', w / 2, h / 2, { size: 13, color: '#333' }); });

// 壁掛乾洗手機(白色塑膠、按壓板、半透明窗看得到殘餘的酒精)+ 上方小告示
const sanRect = () => labRect('svc:sanit', 96, 72, (c, w, h) => {
  c.fillStyle = '#f2f0e6'; c.fillRect(0, 0, w, h); c.fillStyle = '#1d6e5a'; c.fillRect(0, 0, w, 16);
  text(c, '乾洗手', w / 2, 9, { size: 12, color: '#fff' });
  text(c, '進出病房', w / 2, 32, { size: 13, color: '#1a1a1a' });
  text(c, '請消毒雙手', w / 2, 50, { size: 13, color: '#b02020' });
  text(c, '感染管制委員會', w / 2, 64, { size: 8, color: '#555', weight: 'normal' });
});
const sanitizer = (k = 0) => tpl(`svc:sanit:${k % 2}`, (b) => {
  b.box('pl_white', 0.12, 0.24, 0.1, 0, 0.12, 0.05);
  b.box(k ? 'pl_gray' : 'pl_white', 0.1, 0.06, 0.03, 0, 0.06, 0.1, { rx: 0.25 }); // 按壓板
  b.box('pi_clear', 0.05, 0.08, 0.004, 0, 0.16, 0.1015); // 窗
  b.box('glass_amber', 0.044, k ? 0.012 : 0.03, 0.003, 0, k ? 0.128 : 0.137, 0.1005); // 殘餘的酒精
  b.cyl('pl_dark', 0.004, 0.012, 0, 0.012, 0.072, { seg: 6 }); // 出口
  b.box('paper', 0.13, 0.098, 0.002, 0, 0.36, 0.001); // 告示紙(貼在機器上方)
  b.plane(L(sanRect()), 0.124, 0.093, 0, 0.36, 0.0025);
});

// 低位避難方向指示燈(白底綠圖,箭頭 dir = 1 向右 / -1 向左;觀看者面對牆時的左右)
const evacRect = (dir) => glowRect(`svc:evac:${dir}`, 192, 72, (c, w, h) => {
  c.fillStyle = '#a3bca9'; c.fillRect(0, 0, w, h); // 白底(發光材質下偏暗一點,不要像一張亮白貼紙)
  c.strokeStyle = '#1a8a46'; c.lineWidth = 3; c.strokeRect(3, 3, w - 6, h - 6);
  const g = '#16924a';
  c.save(); if (dir < 0) { c.translate(w, 0); c.scale(-1, 1); }
  // 門框 + 奔跑的人(朝箭頭方向)
  c.fillStyle = g; c.fillRect(14, 12, 34, 50); c.fillStyle = '#a3bca9'; c.fillRect(18, 16, 26, 46);
  c.fillStyle = g; c.strokeStyle = g; c.lineCap = 'round'; c.lineWidth = 6;
  c.beginPath(); c.arc(70, 18, 6, 0, 6.28); c.fill();
  c.beginPath(); c.moveTo(68, 27); c.lineTo(62, 44); c.lineTo(72, 52); c.lineTo(70, 64); c.moveTo(62, 44); c.lineTo(52, 50); c.lineTo(46, 62); c.moveTo(66, 31); c.lineTo(78, 39); c.moveTo(66, 31); c.lineTo(54, 34); c.stroke();
  // 箭頭
  c.beginPath(); c.moveTo(96, 36); c.lineTo(156, 36); c.stroke();
  c.beginPath(); c.moveTo(178, 36); c.lineTo(150, 18); c.lineTo(150, 54); c.closePath(); c.fill();
  c.restore();
});
const evacSign = (dir) => tpl(`svc:evac:${dir}`, (b) => {
  b.box('alu', 0.4, 0.16, 0.035, 0, 0.08, 0.0175);
  b.box('pl_white', 0.37, 0.13, 0.004, 0, 0.08, 0.0365);
  b.plane(G(evacRect(dir)), 0.36, 0.125, 0, 0.08, 0.0386);
});

// 外轉角的不鏽鋼護角(L 形 6cm × 6cm,高 h;m = ±1 決定轉角在模板 +X 或 -X 側)
const cornerGuard = (h, m) => tpl(`svc:corner:${h.toFixed(2)}:${m}`, (b) => {
  b.box('steel', 0.065, h, 0.0025, -m * 0.0325, h / 2, 0.00125); // 貼在原牆面
  b.box('steel', 0.0025, h, 0.065, m * 0.00125, h / 2, -0.0325); // 包到側面
});

// ---------------------------------------------------------------- 擺放
export function dressServices(R, zone) {
  if (typeof window !== 'undefined' && !window.__piAtlas) window.__piAtlas = atlasStats; // 開發:圖集用量
  const th = zone.theme;
  if (th === 'corridor' || th === 'lobby' || th === 'waiting') corridor(R, zone);
  if (th === 'lobby' || th === 'corridor' || th === 'er' || th === 'store' || th === 'waiting') wetEntrance(R);
}

// 同一面牆上相鄰的門格合成一扇門:{ side, plane, t0, t1, other(另一側區域), out(另一側是戶外) }
function doorGroups(R) {
  const Lr = R.L, CELL = Lr.CELL, li = R.li;
  const list = R.doors.map((d) => {
    const side = sideOf(d.nx, d.nz), horiz = d.nx === 0;
    const plane = horiz ? d.z + d.nz * CELL / 2 : d.x + d.nx * CELL / 2;
    const t = horiz ? d.x : d.z;
    const oc = d.c - d.nx, or = d.r - d.nz; // 門的另一側
    return { side, horiz, plane, t, d, other: Lr.zoneAt(li, oc, or), out: (Lr.flagsAt(li, oc, or) & Lr.F.OUTDOOR) !== 0 };
  }).sort((a, b) => (a.side + a.plane).localeCompare(b.side + b.plane) || a.t - b.t);
  const out = [];
  for (const e of list) {
    const g = out[out.length - 1];
    if (g && g.side === e.side && g.plane === e.plane && Math.abs(e.t - CELL / 2 - g.t1) < 0.01) { g.t1 = e.t + CELL / 2; g.n++; continue; }
    out.push({ side: e.side, horiz: e.horiz, plane: e.plane, nx: e.d.nx, nz: e.d.nz, t0: e.t - CELL / 2, t1: e.t + CELL / 2, n: 1, other: e.other, out: e.out });
  }
  for (const g of out) g.h = g.out ? 2.5 : g.n >= 2 ? 2.6 : 2.3;
  return out;
}
// 牆段:找同一面牆、涵蓋 [a, b] 的實牆(不是窗)
const runAt = (R, g, a, b) => R.walls.find((r) => r.side === g.side && Math.abs(r.plane - g.plane) < 0.01 && r.t0 <= a && r.t1 >= b && !R.isWindow(r, a, b));
// 門洞上方沒有牆段 → 用門的平面做一個假的牆段給 atWall
const pseudoRun = (g) => ({ side: g.side, horiz: g.horiz, plane: g.plane, nx: g.nx, nz: g.nz, yaw: SIDE_YAW[g.side], t0: g.t0, t1: g.t1, len: g.t1 - g.t0, wins: [] });

function corridor(R, zone) {
  const Lr = R.L, li = R.li, rng = R.rng;
  const groups = doorGroups(R);
  const stairs = Lr.stairs.filter((s) => s.lower === li || s.upper === li).map((s) => ({ x: (s.x0 + s.x1) / 2, z: (s.z0 + s.z1) / 2 }));
  const exits = groups.filter((g) => g.out || g.other?.theme === 'stairwell').map((g) => (g.horiz ? { x: (g.t0 + g.t1) / 2, z: g.plane } : { x: g.plane, z: (g.t0 + g.t1) / 2 }));
  const targets = exits.length ? exits : stairs;
  const nearDoor = (side, plane, t, pad) => groups.some((g) => g.side === side && Math.abs(g.plane - plane) < 0.01 && t > g.t0 - pad && t < g.t1 + pad);

  for (const g of groups) {
    const mid = (g.t0 + g.t1) / 2, pr = pseudoRun(g);
    const exitSign = g.out || g.other?.theme === 'stairwell';
    // 門上的緊急照明燈(出口/樓梯門上方已經有綠色出口燈)
    if (!exitSign && rng() < 0.55) R.atWall(emLight(rng.int(0, 5) === 0 ? 1 : rng() < 0.15 ? 2 : 0), pr, mid + (g.n >= 2 ? 0 : rng.range(-0.3, 0.3)), { mount: g.h + 0.17, gap: 0.0 });
    // 門框兩側:手垢(手推門的高度)、門腳踢痕;病人房間的門邊再一台乾洗手機(把手那側,離門框 25cm)
    for (const [t, s] of [[g.t0 - 0.2, -1], [g.t1 + 0.2, 1]]) {
      const run = runAt(R, g, Math.min(t, t + s * 0.4), Math.max(t, t + s * 0.4));
      if (!run) continue;
      if (rng() < 0.85) wallDecal(R, run, t + s * 0.05, rng.range(0.95, 1.2), 'grime', rng.range(0.22, 0.32));
      if (rng() < 0.7) wallDecal(R, run, t + s * 0.18, 0.1, 'kick', rng.range(0.5, 0.8));
    }
    if (g.other && PATIENT.has(g.other.theme)) {
      const s = rng() < 0.5 ? 1 : -1, t = s > 0 ? g.t1 + 0.38 : g.t0 - 0.38;
      const run = runAt(R, g, t - 0.12, t + 0.12) || runAt(R, g, (s > 0 ? g.t0 - 0.38 : g.t1 + 0.38) - 0.12, (s > 0 ? g.t0 - 0.38 : g.t1 + 0.38) + 0.12);
      if (run) {
        const tt = run.t0 <= t - 0.12 && run.t1 >= t + 0.12 ? t : s > 0 ? g.t0 - 0.38 : g.t1 + 0.38;
        R.atWall(sanitizer(rng() < 0.4 ? 1 : 0), run, tt, { mount: 1.0, gap: 0.0 });
        if (rng() < 0.6) wallDecal(R, run, tt, 0.86, 'stain', 0.16); // 機器下方滴下來的酒精乾掉的黃漬
      }
    }
    // 門口地上:鞋跟/腳輪刮痕
    const inside = { x: g.horiz ? mid : g.plane + g.nx * 0.9, z: g.horiz ? g.plane + g.nz * 0.9 : mid };
    if (R.isReach(inside.x, inside.z) && rng() < 0.8) floorDecal(R, 'scuff', inside.x, inside.z, rng.range(1.2, 1.8));
  }
  // 走廊牆:低位避難方向指示燈(每 11~15m、避開門、窗、靠牆家具),推床擦痕
  for (const run of R.walls) {
    if (run.len < 3) continue;
    for (let t = run.t0 + rng.range(2, 6); t < run.t1 - 1; t += rng.range(11, 15)) {
      if (R.isWindow(run, t - 0.3, t + 0.3) || nearDoor(run.side, run.plane, t, 0.7)) continue;
      const f = R.at(run, t, 0.25);
      if (!R.freeAt(f.x, f.z)) continue;
      const p = R.at(run, t, 0);
      let best = null, bd = 1e9;
      for (const q of targets) { const d = (q.x - p.x) ** 2 + (q.z - p.z) ** 2; if (d < bd) { bd = d; best = q; } }
      if (!best) continue;
      const ax = Math.cos(run.yaw), az = -Math.sin(run.yaw); // 模板 +X(觀看者右手邊)
      const dir = (best.x - p.x) * ax + (best.z - p.z) * az >= 0 ? 1 : -1;
      R.atWall(evacSign(dir), run, t, { mount: 0.42, gap: 0.0 });
    }
    if (run.len > 4) for (let t = run.t0 + rng.range(1, 4); t < run.t1 - 1; t += rng.range(5, 9)) {
      if (R.isWindow(run, t - 0.6, t + 0.6) || nearDoor(run.side, run.plane, t, 0.5)) continue;
      wallDecal(R, run, t, rng.range(0.72, 0.9), 'rub', rng.range(0.7, 1.3));
    }
  }
  // 外轉角護角:牆段結束、沿牆下一格可走、且下一格的牆側也空著(牆往外轉)
  const solid = (c, r) => (Lr.flagsAt(li, c, r) & (Lr.F.WALL | Lr.F.WINDOW | Lr.F.ELEVATOR)) !== 0;
  const seen = new Set(); // 同一個外轉角會是兩段牆的端點:只放一次
  for (const run of R.walls) {
    const [dc, dr] = run.side === 'N' ? [0, -1] : run.side === 'S' ? [0, 1] : run.side === 'W' ? [-1, 0] : [1, 0];
    for (const end of [0, 1]) {
      const [c, r] = end ? run.cells[run.cells.length - 1] : run.cells[0];
      const step = end ? 1 : -1, nc = run.horiz ? c + step : c, nr = run.horiz ? r : r + step;
      if (!(Lr.flagsAt(li, nc, nr) & Lr.F.WALK) || solid(nc + dc, nr + dr) || Lr.charAt(li, nc + dc, nr + dr) === '+') continue;
      const t = end ? run.t1 : run.t0;
      const ax = Math.cos(run.yaw), az = -Math.sin(run.yaw), tx = run.horiz ? 1 : 0, tz = run.horiz ? 0 : 1;
      const m = (ax * tx + az * tz) * (end ? 1 : -1) > 0 ? 1 : -1; // 轉角在模板 +X 還是 -X
      const p = R.at(run, t, 0), key = `${p.x.toFixed(1)},${p.z.toFixed(1)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      R.put(cornerGuard(1.35, m), p.x, p.z, run.yaw, {});
      floorDecal(R, 'scuff', p.x + run.nx * 0.5 + (run.horiz ? step * 0.4 : 0), p.z + run.nz * 0.5 + (run.horiz ? 0 : step * 0.4), 1.1);
    }
  }
  // 牆腳的積塵堆:紙張、紙團、碎屑被腳步與推床推到牆邊(中間的動線反而乾淨),轉角與門邊最多
  const drift = (x, z, n, r, kinds) => {
    for (let k = 0, placed = 0; k < n * 3 && placed < n; k++) {
      const a = rng() * Math.PI * 2, d = Math.sqrt(rng()) * r, px = x + Math.cos(a) * d, pz = z + Math.sin(a) * d;
      if (!R.freeAt(px, pz, 0.04)) continue;
      const name = kinds[(rng() * kinds.length) | 0];
      R.I(name, ctpl(name), px, R.y, pz, rng() * Math.PI * 2);
      placed++;
    }
  };
  const lv1 = Lr.levels[li].id === '1F';
  const dk = lv1 ? ['paper', 'paper2', 'leaf', 'leaf', 'leaf', 'butt'] : ['paper', 'paper2', 'paper3', 'paper', 'gauze', 'glove'];
  for (const run of R.walls) {
    if (run.len < 2) continue;
    for (let t = run.t0 + 0.3; t < run.t1 - 0.3; t += rng.range(1.2, 2.6)) {
      if (rng() < 0.45) continue;
      const p = R.at(run, t, rng.range(0.12, 0.3));
      drift(p.x, p.z, rng.int(1, 3), 0.18, dk);
    }
  }
  // 往出口/樓梯的逃生動線:越靠近門,地上掉的病歷紙、表單、手套越多(當年把病人往外推時掉的)
  for (const g of groups) {
    if (!(g.out || g.other?.theme === 'stairwell')) continue;
    const mid = (g.t0 + g.t1) / 2;
    for (let k = 0; k < 9; k++) {
      const dd = 0.8 + Math.pow(rng(), 1.6) * 5.5, o = rng.range(-1.4, 1.4);
      const x = g.horiz ? mid + o : g.plane + g.nx * dd, z = g.horiz ? g.plane + g.nz * dd : mid + o;
      drift(x, z, rng.int(1, 3), 0.35, ['paper', 'paper2', 'paper3', 'file', 'glove', 'paper']);
    }
  }
  // 走廊中央的動線磨耗:沿每個長矩形的中線,一段一段的 lane 貼花
  if (zone.theme === 'corridor') for (const [c0, r0, c1, r1] of zone.rects) {
    const w = (c1 - c0 + 1) * 2, h = (r1 - r0 + 1) * 2;
    if (Math.min(w, h) > 6 || Math.max(w, h) < 8) continue;
    const alongX = w > h, len = Math.max(w, h), cx = c0 * 2 + w / 2, cz = r0 * 2 + h / 2;
    for (let s = 1.4; s < len - 1.4; s += 2.5) {
      const x = alongX ? c0 * 2 + s : cx + rng.range(-0.15, 0.15), z = alongX ? cz + rng.range(-0.15, 0.15) : r0 * 2 + s;
      if (!R.isReach(x, z)) continue;
      floorDecal(R, 'lane', x, z, rng.range(1.2, 1.5), { yaw: (alongX ? HALF : 0) + rng.range(-0.04, 0.04) + (rng() < 0.5 ? Math.PI : 0) });
    }
  }
}

// 通往戶外的門:門內 3m 的積水、泥腳印、樹葉(雨夜)
function wetEntrance(R) {
  const rng = R.rng;
  for (const g of doorGroups(R)) {
    if (!g.out) continue;
    const mid = (g.t0 + g.t1) / 2;
    const at = (d, o = 0) => ({ x: g.horiz ? mid + o : g.plane + g.nx * d, z: g.horiz ? g.plane + g.nz * d : mid + o });
    const yawIn = Math.atan2(g.nx, g.nz) + Math.PI; // 腳印朝裡走(貼花 +V 朝 -Z)
    for (let k = 0; k < 3; k++) { const p = at(0.7 + k * 0.9, rng.range(-0.5, 0.5)); if (R.isReach(p.x, p.z)) floorDecal(R, 'water', p.x, p.z, rng.range(1.0, 1.6)); }
    for (let k = 0; k < 2; k++) { const p = at(1.4 + k * 1.6, (k ? -0.35 : 0.3) * (g.n >= 2 ? 1.6 : 1)); if (R.isReach(p.x, p.z)) floorDecal(R, 'mud', p.x, p.z, 0.6, { yaw: yawIn + rng.range(-0.25, 0.25) }); }
    const p = at(0.5); if (R.isReach(p.x, p.z)) floorDecal(R, 'dirt', p.x, p.z, 1.4);
  }
}

// ---------------------------------------------------------------- 病床邊(病房最常被近看的地方)
// 床的本地座標(medical.hospitalBed):床頭在 -Z(貼牆)、床尾 +Z、寬 ±0.46、床墊面 y≈0.69
// 藍白拖(台灣人住院必備)、床下的臉盆、從床頭面板垂到枕邊的叫人鈴、床尾欄上掛的毛巾
const slippers = (k) => tpl(`svc:slipper:${k % 2}`, (b) => {
  for (const [sx, sz, ry] of [[-0.07, 0, 0.12 + k * 0.3], [0.08, 0.05 + k * 0.08, -0.2 - k * 0.5]]) {
    b.push(sx, 0, sz, 0, ry, 0);
    b.box('pl_white', 0.1, 0.018, 0.26, 0, 0.009, 0);
    b.tube('pl_blue', [[-0.048, 0.016, -0.06], [-0.035, 0.05, -0.04], [0.035, 0.05, -0.04], [0.048, 0.016, -0.06]], 0.012, { seg: 4, bend: 0.02 });
    b.box('pl_blue', 0.094, 0.006, 0.024, 0, 0.051, -0.04);
    b.pop();
  }
});
const basin = (k) => tpl(`svc:basin:${k % 2}`, (b) => {
  b.lathe(k ? 'pl_pink' : 'pl_ltblue', [[0, 0.004], [0.1, 0], [0.13, 0.03], [0.15, 0.085], [0.165, 0.09], [0.16, 0.095], [0.14, 0.06], [0.1, 0.012], [0, 0.016]], 0, 0, 0, { seg: 10 });
  b.box('fab_white', 0.18, 0.02, 0.12, 0.02, 0.03, 0.01, { ry: 0.4 }); // 一條毛巾
});
const callCord = (k) => tpl(`svc:callcord:${k % 2}`, (b) => {
  const s = k ? -1 : 1;
  b.tube('pl_gray', [[s * 0.28, 1.34, -0.9], [s * 0.36, 1.05, -0.86], [s * 0.42, 0.8, -0.78], [s * 0.37, 0.715, -0.66]], 0.004, { seg: 4, bend: 0.06 });
  b.push(s * 0.34, 0.73, -0.64, 0.1, 0.3 * s, HALF);
  b.box('pl_beige', 0.03, 0.1, 0.035, 0, 0, 0);
  b.cyl('pl_red', 0.008, 0.006, 0, 0.02, 0.019, { axis: 'z', seg: 8 });
  b.pop();
});
const railTowel = () => tpl('svc:railtowel', (b) => {
  b.box('fab_white', 0.38, 0.012, 0.06, 0.05, 0.875, 1.06, { r: 0.004 }); // 搭在床尾欄上
  b.box('fab_white', 0.38, 0.22, 0.008, 0.05, 0.76, 1.09, { r: 0.004, rx: 0.06 });
  b.box('fab_white', 0.38, 0.18, 0.008, 0.05, 0.79, 1.035, { r: 0.004, rx: -0.05 });
});
export function bedside(R, p, k, kind) {
  const r = R.rng;
  if (kind === 'body') return;
  if (r() < 0.75) R.putRel(callCord(k), p, 0, 0, 0);
  if (r() < 0.55) R.putRel(basin(k + 1), p, (r() - 0.5) * 0.3, 0, -0.45 + r() * 0.3, 0, r() * 6);
  if (kind !== 'stripped' && r() < 0.6) { const q = R.local(p, (r() < 0.5 ? -1 : 1) * 0.68, 0, 0.15 + r() * 0.5); if (R.freeAt(q.x, q.z, 0.1)) R.put(slippers(k), q.x, q.z, p.yaw + (r() - 0.5) * 1.2, { collide: false }); }
  if (kind === 'made' && r() < 0.35) R.putRel(railTowel(), p, 0, 0, 0);
}
