import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { WEAPONS } from './weapons/weapon.js';
import { sfx } from './audio.js';

// 殭屍掉落物:彈藥箱、大彈藥箱、醫療包。
// 掉落時從屍體彈出一道拋物線落地,之後懸浮旋轉;地面發光圓環 + 淡淡光柱方便在黑暗中找到。
// 走近自動撿取(支援多樓層:比對腳下高度)。不使用任何動態光源。

// ---------- 掉落數值(集中調整) ----------
// ammo / med 為機率;big = 必掉大彈藥箱(取代一般彈藥)
export const DROP_TABLE = {
  walker: { ammo: 0.14, med: 0.04 },
  runner: { ammo: 0.16, med: 0.05 },
  crawler: { ammo: 0.14, med: 0.04 },
  bloater: { ammo: 0.25, med: 0.1 },
  brute: { ammo: 0, med: 0.6, big: true },
};

export const DROP_RULES = {
  lowAmmoMul: 2.5, // 目前武器 彈匣+備彈 不到一個彈匣 → 彈藥機率 ×2.5
  pity: 12, // 仁慈機制:連續沒掉彈藥的擊殺到第 12 殺必掉
  lowHp: 0.4, // 血量低於 40%…
  lowHpMul: 2, // …醫療包機率 ×2
  heal: 35, // 醫療包回復量
  life: 35, // 存在秒數
  blink: 6, // 最後幾秒閃爍
  reach: 1.1, // 撿取水平距離
  reachY: 1.2, // 撿取高度差(多樓層)
  max: 32, // 場上上限,超過時移除最舊的
};

// 外觀:光色、圓環/光柱大小、懸浮高度、模型縮放
const LOOK = {
  ammo: { color: 0xffa52e, css: '#ffc35a', ring: 1.3, beam: 2.5, beamW: 0.55, glow: 0.95, hover: 0.42, scale: 1.12 },
  bigammo: { color: 0xffb83a, css: '#ffd27a', ring: 1.9, beam: 3.4, beamW: 0.8, glow: 1.4, hover: 0.5, scale: 1.08 },
  med: { color: 0x3cff86, css: '#7dffae', ring: 1.3, beam: 2.5, beamW: 0.55, glow: 0.95, hover: 0.44, scale: 1.1 },
};

const FLY = 0.62; // 拋物線飛行時間
const ARC = 0.75; // 拋物線額外高度
const SETTLE = 0.28; // 落地小彈跳時間
const RISE = 0.75; // 浮起時間

// 音效:武器代理會在 audio 裡實作 pickupAmmo / pickupMed / pickupDeny;未合併前退回現有音效
const say = (name, fallback, ...a) => (sfx[name] || sfx[fallback])?.(...a);

// ---------- 程式貼圖 ----------
let seed = 7331;
const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
const rr = (a, b) => a + rnd() * (b - a);

function cv(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')];
}

function toTex(c, srgb = true) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

function blot(x, S, n, r0, r1, rgb, a0, a1) {
  for (let i = 0; i < n; i++) {
    const px = rnd() * S, py = rnd() * S, r = rr(r0, r1);
    const g = x.createRadialGradient(px, py, 0, px, py, r);
    g.addColorStop(0, `rgba(${rgb},${rr(a0, a1)})`);
    g.addColorStop(1, `rgba(${rgb},0)`);
    x.fillStyle = g;
    x.fillRect(px - r, py - r, r * 2, r * 2);
  }
}

function grain(x, S, amt) {
  const img = x.getImageData(0, 0, S, S), d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (rnd() - 0.5) * amt;
    d[i] += n; d[i + 1] += n; d[i + 2] += n;
  }
  x.putImageData(img, 0, 0);
}

// 沿貼圖邊緣取點(每個面的 UV 都是 0..1,貼圖邊 = 面的邊 → 邊角磨損)
function edgePt(S, depth) {
  const side = (rnd() * 4) | 0, t = rnd() * S, d = Math.pow(rnd(), 2) * depth;
  return side === 0 ? [t, d] : side === 1 ? [t, S - d] : side === 2 ? [d, t] : [S - d, t];
}

// 烤漆金屬:斑駁、刮痕、邊角掉漆、底部污垢
function paintTex(base, chips = 120) {
  const S = 256;
  const [c, x] = cv(S, S);
  x.fillStyle = base;
  x.fillRect(0, 0, S, S);
  blot(x, S, 26, 10, 50, '255,255,225', 0.03, 0.08);
  blot(x, S, 30, 12, 60, '18,20,8', 0.05, 0.14);
  const g = x.createLinearGradient(0, S * 0.5, 0, S);
  g.addColorStop(0, 'rgba(32,26,14,0)');
  g.addColorStop(1, 'rgba(32,26,14,0.5)');
  x.fillStyle = g;
  x.fillRect(0, 0, S, S);
  for (let i = 0; i < 70; i++) {
    x.strokeStyle = `rgba(185,182,160,${rr(0.12, 0.4)})`;
    x.lineWidth = rr(0.5, 1.2);
    const px = rnd() * S, py = rnd() * S, a = rnd() * 6.28, l = rr(4, 34);
    x.beginPath();
    x.moveTo(px, py);
    x.lineTo(px + Math.cos(a) * l, py + Math.sin(a) * l);
    x.stroke();
  }
  for (let i = 0; i < chips; i++) {
    const [px, py] = edgePt(S, 14), r = rr(1, 4.5);
    x.fillStyle = `rgba(70,48,28,${rr(0.4, 0.7)})`; // 鏽圈
    x.beginPath();
    x.ellipse(px, py, r * 1.5, r * 1.2, rnd() * 3, 0, 6.28);
    x.fill();
    x.fillStyle = `rgba(128,126,114,${rr(0.6, 0.95)})`; // 裸金屬
    x.beginPath();
    x.ellipse(px, py, r, r * 0.7, rnd() * 3, 0, 6.28);
    x.fill();
  }
  grain(x, S, 16);
  return toTex(c);
}

// 白色硬殼塑膠:污漬、磨痕,一角有乾掉的血手印
function shellTex() {
  const S = 256;
  const [c, x] = cv(S, S);
  x.fillStyle = '#e2dfd4';
  x.fillRect(0, 0, S, S);
  blot(x, S, 24, 12, 60, '120,110,90', 0.03, 0.08);
  const g = x.createRadialGradient(S / 2, S / 2, S * 0.3, S / 2, S / 2, S * 0.75);
  g.addColorStop(0, 'rgba(70,60,45,0)');
  g.addColorStop(1, 'rgba(70,60,45,0.35)');
  x.fillStyle = g;
  x.fillRect(0, 0, S, S);
  for (let i = 0; i < 50; i++) {
    x.strokeStyle = `rgba(90,85,75,${rr(0.08, 0.25)})`;
    x.lineWidth = rr(0.5, 1.5);
    const px = rnd() * S, py = rnd() * S, a = rnd() * 6.28, l = rr(5, 30);
    x.beginPath();
    x.moveTo(px, py);
    x.lineTo(px + Math.cos(a) * l, py + Math.sin(a) * l);
    x.stroke();
  }
  // 沾血的手抓過留下的拖痕:四道指痕往斜下拖 + 掌緣 + 噴濺
  const bx = S * 0.74, by = S * 0.2;
  x.lineCap = 'round';
  for (let k = 0; k < 4; k++) {
    const sx = bx + k * 11 + rr(-2, 2), sy = by + Math.abs(k - 1.6) * 5, len = rr(34, 62);
    for (let n = 0; n < 7; n++) {
      x.strokeStyle = `rgba(88,9,7,${rr(0.07, 0.2)})`;
      x.lineWidth = rr(2, 6.5) * (1 - n * 0.07);
      x.beginPath();
      x.moveTo(sx + rr(-1.5, 1.5), sy + rr(0, 4));
      x.quadraticCurveTo(sx - len * 0.12, sy + len * 0.5, sx - len * rr(0.2, 0.3), sy + len * rr(0.75, 1));
      x.stroke();
    }
  }
  blot(x, S, 5, 4, 12, '84,8,6', 0.2, 0.45);
  for (let i = 0; i < 40; i++) {
    x.fillStyle = `rgba(80,8,6,${rr(0.25, 0.6)})`;
    x.beginPath();
    x.arc(bx + rr(-30, 60), by + rr(-20, 70), rr(0.5, 2), 0, 6.28);
    x.fill();
  }
  grain(x, S, 10);
  return toTex(c);
}

const BRIDGE = 'ABDOPQRU0689';
// 模板噴字:per-char 繪製,圓形字母切出模板橋,噴漆邊緣、剝落
function stencilTex(lines, color, { bridges = true, wear = 1 } = {}, W = 512, H = 256) {
  const [c, x] = cv(W, H);
  x.textBaseline = 'middle';
  x.textAlign = 'center';
  for (const [txt, size, yy] of lines) {
    x.font = `700 ${size}px Impact, "Arial Narrow", "Microsoft JhengHei", sans-serif`;
    const chars = [...txt], gap = size * 0.08;
    const ws = chars.map((ch) => x.measureText(ch).width + gap);
    let px = W / 2 - ws.reduce((s, v) => s + v, 0) / 2;
    const py = yy * H;
    chars.forEach((ch, i) => {
      const cx = px + ws[i] / 2;
      x.save();
      x.fillStyle = color;
      x.shadowColor = color;
      x.shadowBlur = 2.5;
      x.fillText(ch, cx, py);
      x.restore();
      if (bridges && BRIDGE.includes(ch)) {
        x.save();
        x.globalCompositeOperation = 'destination-out';
        x.fillRect(cx - size * 0.035, py - size * 0.7, size * 0.07, size * 1.4);
        x.restore();
      }
      px += ws[i];
    });
  }
  x.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < 1600 * wear; i++) {
    x.globalAlpha = rr(0.2, 0.9);
    x.fillRect(rnd() * W, rnd() * H, rr(1, 4), rr(1, 3));
  }
  for (let i = 0; i < 18 * wear; i++) { // 刮痕
    x.globalAlpha = rr(0.5, 1);
    x.lineWidth = rr(1, 2.5);
    const px = rnd() * W, py = rnd() * H, a = rr(-0.6, 0.6);
    x.beginPath();
    x.moveTo(px, py);
    x.lineTo(px + Math.cos(a) * rr(20, 90), py + Math.sin(a) * rr(10, 40));
    x.stroke();
  }
  return toTex(c);
}

// 地面發光圓環(白色,由材質上色)
function ringTex() {
  const S = 256, h = S / 2;
  const [c, x] = cv(S, S);
  const g = x.createRadialGradient(h, h, 0, h, h, h * 0.62);
  g.addColorStop(0, 'rgba(255,255,255,0.32)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g;
  x.fillRect(0, 0, S, S);
  x.strokeStyle = '#fff';
  x.shadowColor = '#fff';
  x.shadowBlur = 10;
  x.lineWidth = h * 0.05;
  x.beginPath();
  x.arc(h, h, h * 0.62, 0, 6.2832);
  x.stroke();
  x.lineWidth = h * 0.028;
  x.globalAlpha = 0.85;
  for (let i = 0; i < 12; i++) { // 外圈刻度
    const a = (i / 12) * 6.2832;
    x.beginPath();
    x.arc(h, h, h * 0.82, a, a + 0.32);
    x.stroke();
  }
  return toTex(c);
}

// 垂直光柱:水平高斯 + 由下往上淡出,帶細微條紋
function beamTex() {
  const W = 64, H = 256;
  const [c, x] = cv(W, H);
  const img = x.createImageData(W, H), d = img.data;
  const streak = Array.from({ length: W }, () => 0.75 + rnd() * 0.25);
  for (let j = 0; j < H; j++) {
    const v = 1 - j / H; // 0 = 底部
    const vf = Math.pow(1 - v, 1.7) * Math.min(1, v * 14 + 0.25);
    for (let i = 0; i < W; i++) {
      const u = (i / (W - 1)) * 2 - 1;
      const a = (Math.exp(-u * u * 9) * 0.55 + Math.exp(-u * u * 60) * 0.45) * vf * streak[i];
      const k = (j * W + i) * 4;
      d[k] = d[k + 1] = d[k + 2] = 255;
      d[k + 3] = Math.min(255, a * 255);
    }
  }
  x.putImageData(img, 0, 0);
  return toTex(c);
}

function glowTex() {
  const S = 128, h = S / 2;
  const [c, x] = cv(S, S);
  const g = x.createRadialGradient(h, h, 0, h, h, h);
  g.addColorStop(0, 'rgba(255,255,255,0.9)');
  g.addColorStop(0.25, 'rgba(255,255,255,0.35)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g;
  x.fillRect(0, 0, S, S);
  return toTex(c);
}

// ---------- 幾何工具 ----------
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _p = new THREE.Vector3(), _one = new THREE.Vector3(1, 1, 1);
function at(g, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
  if (g.index) g = g.toNonIndexed();
  for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') g.deleteAttribute(k);
  g.clearGroups();
  return g.applyMatrix4(_m.compose(_p.set(x, y, z), _q.setFromEuler(_e.set(rx, ry, rz)), _one));
}
const rbox = (w, h, d, r = 0.004, s = 2) => new RoundedBoxGeometry(w, h, d, s, r);
const cyl = (r, l, n = 12) => new THREE.CylinderGeometry(r, r, l, n);
function tube(pts, r, n = 24) {
  return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(...p))), n, r, 6);
}
function mesh(parts, mat, shadow = true) {
  const m = new THREE.Mesh(mergeGeometries(parts), mat);
  m.castShadow = shadow;
  return m;
}
function decal(w, h, mat, x, y, z, ry) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
  m.position.set(x, y, z);
  m.rotation.y = ry;
  m.renderOrder = 1;
  return m;
}

// ---------- 共用材質 / 模型樣板(第一次用到時建立) ----------
const R = {};

function shared() {
  if (R.ready) return R;
  R.ready = true;
  const std = (o) => new THREE.MeshStandardMaterial(o);
  const decalMat = (map, emissive) => std({
    map, transparent: true, depthWrite: false, roughness: 0.75, metalness: 0.1,
    emissive, emissiveMap: map, emissiveIntensity: 0.35, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  });
  R.mat = {
    olive: std({ map: paintTex('#4a5233'), roughness: 0.64, metalness: 0.35 }),
    yellow: std({ map: paintTex('#a88a2a', 60), roughness: 0.6, metalness: 0.25 }),
    steel: std({ color: 0x3e403c, roughness: 0.38, metalness: 0.9 }),
    rubber: std({ color: 0x141412, roughness: 0.92 }),
    mag: std({ color: 0x2a2c30, roughness: 0.45, metalness: 0.6 }), // 鋁合金彈匣(黑色陽極)
    pmag: std({ color: 0x8a7652, roughness: 0.7 }), // 聚合物彈匣(沙色)
    strap: std({ color: 0x7a6a48, roughness: 0.95 }),
    brass: std({ color: 0xc89b44, roughness: 0.28, metalness: 1 }),
    copper: std({ color: 0xa8603a, roughness: 0.32, metalness: 1 }),
    shell: std({ map: shellTex(), roughness: 0.36, metalness: 0 }),
    red: std({ color: 0xb3121a, roughness: 0.42, emissive: 0x5a0408, emissiveIntensity: 0.5 }),
    plastic: std({ color: 0x2a2c2e, roughness: 0.55 }),
    stencilS: decalMat(stencilTex([['CTG 5.56MM M855', 54, 0.27], ['840 RDS  BALL', 46, 0.53], ['LOT  LC-24K113-007', 30, 0.78]], '#d6c15a'), 0x6a5a20),
    stencilB: decalMat(stencilTex([['AMMUNITION', 66, 0.25], ['7.62MM · 5.56MM · 9MM', 36, 0.52], ['彈藥補給  M2A1', 34, 0.77]], '#dccb6a'), 0x6a5a20),
    label: decalMat(stencilTex([['聖心醫院', 50, 0.3], ['FIRST AID', 70, 0.7]], '#a8121a', { bridges: false, wear: 0.35 }), 0x400004),
  };
  R.tex = { ring: ringTex(), beam: beamTex(), glow: glowTex() };
  R.geo = {
    ring: new THREE.PlaneGeometry(1, 1),
    beam: new THREE.PlaneGeometry(1, 1).translate(0, 0.5, 0),
  };
  R.proto = {
    ring: new THREE.MeshBasicMaterial({ map: R.tex.ring, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }),
    beam: new THREE.MeshBasicMaterial({ map: R.tex.beam, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
    glow: new THREE.SpriteMaterial({ map: R.tex.glow, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }),
  };
  R.tmpl = { ammo: buildAmmoCan(), bigammo: buildBigCrate(), med: buildMedkit() };
  return R;
}

// 軍綠色金屬彈藥箱(M19A1 風格):箱蓋、密封膠條、壓筋、鉸鏈、側邊凸輪扣環、提把、模板噴字
// 原點在箱體中心,回傳 { group, half: 中心到底部的距離 }
function canParts(L, H, W, big) {
  const M = R.mat, olive = [], steel = [], rubber = [];
  const lidH = big ? 0.036 : 0.03, bodyTop = H / 2 - lidH;
  olive.push(at(rbox(L, H - lidH, W, big ? 0.014 : 0.011), 0, -lidH / 2));
  olive.push(at(rbox(L + 0.008, lidH, W + 0.008, 0.009), 0, bodyTop + lidH / 2));
  olive.push(at(rbox(L - 0.07, 0.006, W - 0.045, 0.003, 1), 0, H / 2 + 0.002)); // 箱蓋壓印凸面
  rubber.push(at(new THREE.BoxGeometry(L - 0.004, 0.006, W - 0.004), 0, bodyTop - 0.001)); // 密封膠條
  for (const s of [-1, 1]) {
    olive.push(at(rbox(L - 0.05, 0.011, 0.006, 0.0025, 1), 0, -H / 2 + (big ? 0.012 : 0.016), s * (W / 2 + 0.0012))); // 長邊壓筋
    for (const zz of [-1, 1]) olive.push(at(rbox(0.007, H - lidH - 0.05, 0.012, 0.003, 1), s * (L / 2 + 0.0015), -lidH / 2 - 0.006, zz * W * 0.26)); // 端面壓筋
  }
  // 鉸鏈(-X 端)
  steel.push(at(cyl(0.0075, W - 0.03), -L / 2 - 0.006, bodyTop + 0.004, 0, Math.PI / 2));
  for (const zz of [-0.32, 0, 0.32]) olive.push(at(rbox(0.012, 0.022, W * 0.18, 0.003, 1), -L / 2 - 0.004, bodyTop - 0.004, zz * W));
  // 凸輪扣環(+X 端):扣片 + 轉軸 + 下方掛鉤
  olive.push(at(rbox(0.009, H * 0.58, W * 0.36, 0.003, 1), L / 2 + 0.011, bodyTop - H * 0.27, 0, 0, 0, -0.05));
  olive.push(at(rbox(0.014, 0.018, W * 0.4, 0.004, 1), L / 2 + 0.013, bodyTop - H * 0.56, 0)); // 扣片末端加厚
  steel.push(at(cyl(0.0065, W * 0.44), L / 2 + 0.011, bodyTop + 0.006, 0, Math.PI / 2));
  steel.push(at(rbox(0.01, 0.016, W * 0.24, 0.003, 1), L / 2 + 0.005, -H * 0.36, 0));
  return { olive, steel, rubber, bodyTop };
}

function buildAmmoCan() {
  const M = R.mat, L = 0.3, H = 0.19, W = 0.13;
  const { olive, steel, rubber } = canParts(L, H, W, false);
  // 提把:立起的鋼線提把 + 箱蓋上的固定耳
  const top = H / 2;
  steel.push(at(tube([[-0.072, top + 0.004, 0], [-0.066, top + 0.03, 0], [-0.04, top + 0.04, 0], [0.04, top + 0.04, 0], [0.066, top + 0.03, 0], [0.072, top + 0.004, 0]], 0.0055)));
  for (const s of [-1, 1]) olive.push(at(rbox(0.02, 0.012, 0.024, 0.003, 1), s * 0.072, top + 0.004));
  rubber.push(at(cyl(0.0085, 0.07, 10), 0, top + 0.04, 0, 0, 0, Math.PI / 2)); // 提把握套
  const g = new THREE.Group();
  g.add(mesh(olive, M.olive), mesh(steel, M.steel), mesh(rubber, M.rubber));
  for (const s of [-1, 1]) g.add(decal(0.24, 0.12, M.stencilS, 0, -0.005, s * (W / 2 + 0.0035), s > 0 ? 0 : Math.PI));
  return { group: g, half: H / 2 };
}

// STANAG 彈匣側面輪廓(x = 前後, y = 長度,頂端為供彈口),擠出厚度 = z
function magParts() {
  const s = new THREE.Shape();
  s.moveTo(0, 0);
  s.lineTo(0.064, 0);
  s.quadraticCurveTo(0.067, -0.09, 0.082, -0.172);
  s.lineTo(0.088, -0.186);
  s.lineTo(0.024, -0.19);
  s.lineTo(0.021, -0.176);
  s.quadraticCurveTo(0.006, -0.09, 0, 0);
  const body = new THREE.ExtrudeGeometry(s, { depth: 0.022, bevelEnabled: true, bevelThickness: 0.0016, bevelSize: 0.0016, bevelSegments: 1, curveSegments: 10 });
  body.translate(0, 0, -0.011);
  // 供彈口上的兩發子彈(彈殼 + 彈頭朝前)
  const brass = [at(cyl(0.0046, 0.042, 10), 0.03, 0.0035, -0.004, 0, 0, Math.PI / 2), at(cyl(0.0046, 0.042, 10), 0.028, -0.004, 0.004, 0, 0, Math.PI / 2)];
  const tip = [at(new THREE.ConeGeometry(0.0042, 0.016, 10), 0.059, 0.0035, -0.004, 0, 0, -Math.PI / 2), at(new THREE.ConeGeometry(0.0042, 0.016, 10), 0.057, -0.004, 0.004, 0, 0, -Math.PI / 2)];
  return { body: at(body), brass, tip };
}

// 大彈藥箱(M2A1 風格,更大):黃色識別帶、兩端繩把、箱蓋上綁著兩個 M4 彈匣
function buildBigCrate() {
  const M = R.mat, L = 0.48, H = 0.27, W = 0.22;
  const { olive, steel, rubber } = canParts(L, H, W, true);
  const yellow = [at(rbox(L + 0.005, 0.026, W + 0.005, 0.004, 1), 0, 0.075)];
  const strap = [];
  for (const s of [-1, 1]) { // 端面繩把
    strap.push(at(tube([[s * (L / 2 + 0.006), H * 0.02, -0.07], [s * (L / 2 + 0.03), -H * 0.06, -0.045], [s * (L / 2 + 0.036), -H * 0.1, 0], [s * (L / 2 + 0.03), -H * 0.06, 0.045], [s * (L / 2 + 0.006), H * 0.02, 0.07]], 0.007, 20)));
    for (const zz of [-0.07, 0.07]) steel.push(at(rbox(0.012, 0.03, 0.022, 0.003, 1), s * (L / 2 + 0.004), H * 0.02, zz));
  }
  // 彈匣:平躺在箱蓋上,長度沿 X,左右兩個
  const mag = [], pmag = [], brass = [], copper = [];
  const basis = new THREE.Matrix4().makeBasis(new THREE.Vector3(0, 0, 1), new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0));
  const top = H / 2 + 0.006;
  [[-0.046, 0.03, 0], [0.042, -0.01, 0.05]].forEach(([zz, xx, rot], k) => {
    const P = magParts();
    const place = new THREE.Matrix4().makeRotationY(rot).multiply(new THREE.Matrix4().makeTranslation(xx + 0.095, top + 0.0127, zz - 0.044)).multiply(basis);
    (k ? pmag : mag).push(P.body.applyMatrix4(place));
    for (const g of P.brass) brass.push(g.applyMatrix4(place));
    for (const g of P.tip) copper.push(g.applyMatrix4(place));
  });
  for (const xx of [-0.045, 0.065]) { // 尼龍綁帶繞過彈匣與箱蓋
    strap.push(at(new THREE.BoxGeometry(0.03, 0.004, W - 0.02), xx, top + 0.028, 0));
    for (const s of [-1, 1]) strap.push(at(new THREE.BoxGeometry(0.03, 0.03, 0.004), xx, top + 0.012, s * (W / 2 - 0.012)));
  }
  steel.push(at(rbox(0.036, 0.008, 0.03, 0.002, 1), -0.045, top + 0.031, 0.04)); // 綁帶扣
  const g = new THREE.Group();
  g.add(mesh(olive, M.olive), mesh(steel, M.steel), mesh(rubber, M.rubber), mesh(yellow, M.yellow), mesh(strap, M.strap), mesh(mag, M.mag), mesh(pmag, M.pmag), mesh(brass, M.brass), mesh(copper, M.copper));
  for (const s of [-1, 1]) g.add(decal(0.34, 0.17, M.stencilB, 0, -0.03, s * (W / 2 + 0.0035), s > 0 ? 0 : Math.PI));
  return { group: g, half: H / 2 };
}

function crossShape(a, t) {
  const h = a / 2, k = t / 2, s = new THREE.Shape();
  [[-k, h], [k, h], [k, k], [h, k], [h, -k], [k, -k], [k, -h], [-k, -h], [-k, -k], [-h, -k], [-h, k], [-k, k]].forEach(([x, y], i) => (i ? s.lineTo(x, y) : s.moveTo(x, y)));
  return new THREE.ExtrudeGeometry(s, { depth: 0.003, bevelEnabled: true, bevelThickness: 0.001, bevelSize: 0.0012, bevelSegments: 1 });
}

// 白/紅硬殼急救箱:前後兩片外殼(中間接縫 + 密封條)、紅十字、提把、兩個扣件、底部鉸鏈
function buildMedkit() {
  const M = R.mat, W = 0.36, H = 0.25, D = 0.11;
  const shell = [], red = [], plastic = [], steel = [];
  for (const s of [-1, 1]) shell.push(at(rbox(W, H, D / 2 - 0.002, 0.022, 3), 0, 0, s * (D / 4 + 0.001)));
  plastic.push(at(new THREE.BoxGeometry(W - 0.012, H - 0.012, 0.008), 0, 0, 0)); // 接縫密封條
  for (const s of [-1, 1]) {
    red.push(at(crossShape(0.112, 0.037), 0, 0.03, s * (D / 2 - 0.0005), 0, s > 0 ? 0 : Math.PI));
  }
  // 提把
  plastic.push(at(rbox(0.13, 0.022, 0.03, 0.009, 2), 0, H / 2 + 0.036));
  for (const s of [-1, 1]) plastic.push(at(rbox(0.02, 0.042, 0.026, 0.006, 1), s * 0.058, H / 2 + 0.016));
  // 扣件:跨過接縫的扣座 + 翻扣片 + 鋼製轉軸
  for (const s of [-1, 1]) {
    plastic.push(at(rbox(0.04, 0.016, 0.046, 0.004, 1), s * 0.128, H / 2 + 0.004));
    plastic.push(at(rbox(0.034, 0.006, 0.032, 0.002, 1), s * 0.128, H / 2 + 0.014, 0.003, 0.12));
    steel.push(at(cyl(0.0035, 0.046, 8), s * 0.128, H / 2 + 0.012, 0.019, 0, 0, Math.PI / 2));
  }
  // 底部鉸鏈
  for (const s of [-1, 1]) plastic.push(at(cyl(0.0085, 0.06, 10), s * 0.1, -H / 2 - 0.002, 0, 0, 0, Math.PI / 2));
  const g = new THREE.Group();
  g.add(mesh(shell, M.shell), mesh(red, M.red), mesh(plastic, M.plastic), mesh(steel, M.steel));
  for (const s of [-1, 1]) g.add(decal(0.17, 0.085, M.label, 0, -0.068, s * (D / 2 + 0.0015), s > 0 ? 0 : Math.PI));
  return { group: g, half: H / 2 };
}

const ease = (t) => t * t * (3 - 2 * t);

// ---------- 掉落物管理 ----------
export class Pickups {
  constructor(scene, world = null) {
    this.scene = scene;
    this.world = world; // 可選:落點避開牆、貼地
    this.items = [];
    this.dry = 0; // 連續沒掉彈藥的擊殺數
    this.denyT = 0;
    this.warmed = false;
    this._v = new THREE.Vector3();
  }

  // 擊殺時依類型擲骰(game.onKill 呼叫);回傳掉出的種類
  roll(z, game) {
    const T = DROP_TABLE[z.type] || DROP_TABLE.walker, Q = DROP_RULES;
    const w = game.weapons, a = w.ammo, p = game.player;
    const kinds = [];
    if (T.big) kinds.push('bigammo');
    else {
      const pa = T.ammo * (a && a.mag + a.reserve < w.def.mag ? Q.lowAmmoMul : 1);
      if (this.dry + 1 >= Q.pity || Math.random() < pa) kinds.push('ammo');
    }
    this.dry = kinds.length ? 0 : this.dry + 1;
    if (Math.random() < T.med * (p.hp < p.maxHp * Q.lowHp ? Q.lowHpMul : 1)) kinds.push('med');
    const y = z.pos.y || 0;
    const h = z.type === 'crawler' ? 0.45 : z.type === 'brute' ? 1.45 : 1.05;
    const a0 = Math.random() * Math.PI * 2;
    kinds.forEach((k, i) => this.drop(z.pos.x, y, z.pos.z, k, { h, ang: a0 + i * 2.6 }));
    return kinds;
  }

  // 在 (x, y, z) 掉落一個 kind('ammo' | 'bigammo' | 'med');y = 腳下地面高度
  drop(x, y, z, kind = 'ammo', o = {}) {
    const L = LOOK[kind];
    if (!L) return null;
    shared();
    // 落點:往隨機方向彈出 0.55–0.9 m(避開屍體與金幣),不穿牆、貼地
    const ang = o.ang ?? Math.random() * Math.PI * 2, dx = Math.cos(ang), dz = Math.sin(ang);
    let d = 0.55 + Math.random() * 0.35;
    const w = this.world, tgt = new THREE.Vector3();
    if (w) d = Math.max(0, Math.min(d, w.rayDistance(x, y + 0.4, z, dx, 0, dz, d + 0.4) - 0.4));
    tgt.set(x + dx * d, y, z + dz * d);
    if (w) {
      w.resolve(tgt, 0.3);
      const g = w.groundY ? w.groundY(tgt.x, tgt.z, y) : y;
      if (g == null || Math.abs(g - y) > 1) tgt.set(x, y, z);
      else tgt.y = g;
    }

    const root = new THREE.Group();
    root.position.copy(tgt);
    const holder = new THREE.Group();
    const model = R.tmpl[kind].group.clone();
    model.scale.setScalar(L.scale);
    holder.add(model);
    const col = new THREE.Color(L.color);
    const ring = new THREE.Mesh(R.geo.ring, R.proto.ring.clone());
    ring.material.color.copy(col);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.03;
    const beam = new THREE.Mesh(R.geo.beam, R.proto.beam.clone());
    beam.material.color.copy(col).multiplyScalar(1.5); // 核心略超過 1,讓 Bloom 帶出一點光暈
    beam.scale.set(L.beamW, L.beam, 1);
    const glow = new THREE.Sprite(R.proto.glow.clone());
    glow.material.color.copy(col);
    glow.scale.setScalar(L.glow);
    root.add(ring, beam, glow, holder);
    const from = new THREE.Vector3(x - tgt.x, y + (o.h ?? 1.05) - tgt.y, z - tgt.z);
    holder.position.copy(from);
    const it = {
      kind, L, root, holder, ring, beam, glow, from, half: R.tmpl[kind].half * L.scale,
      age: 0, ground: -1, state: 'fly', yaw: Math.random() * 6.28, tx: (Math.random() - 0.5) * 4, tz: (Math.random() - 0.5) * 4,
      blink: 0, denied: false, take: 0, takeFrom: new THREE.Vector3(),
    };
    this.scene.add(root);
    this.items.push(it);
    if (this.items.length > DROP_RULES.max) this._remove(0);
    return it;
  }

  // 預先編譯掉落物用到的 shader(第一次掉落時才不會卡頓)
  _warm(game) {
    this.warmed = true;
    shared();
    const r = game.renderer, prev = r.getRenderTarget();
    const g = new THREE.Group();
    for (const k in R.tmpl) g.add(R.tmpl[k].group.clone());
    g.add(new THREE.Mesh(R.geo.ring, R.proto.ring), new THREE.Mesh(R.geo.beam, R.proto.beam), new THREE.Sprite(R.proto.glow));
    try {
      if (game.composer) r.setRenderTarget(game.composer.renderTarget1); // 與實際繪製同樣的(不做色調映射)設定
      r.compile(g, game.camera, game.scene);
    } catch { /* 略過 */ }
    r.setRenderTarget(prev);
  }

  update(dt, game) {
    if (!this.warmed && game.renderer) this._warm(game);
    const p = game.player, cam = game.camera.position, Q = DROP_RULES;
    const py = p.pos.y || 0;
    this.denyT -= dt;
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i], L = it.L, h = it.holder, pos = it.root.position;
      it.age += dt;
      let glowK = 0;

      if (it.state === 'fly') {
        const t = Math.min(1, it.age / FLY), u = 1 - t;
        h.position.set(it.from.x * u, it.from.y * u + it.half * t + ARC * 4 * t * u, it.from.z * u);
        it.yaw += dt * 7 * u + dt;
        h.rotation.set(it.tx * u, it.yaw, it.tz * u);
        if (t >= 1) { it.state = 'idle'; it.ground = 0; say('pickupLand', null, pos, it.kind); }
      } else if (it.state === 'idle') {
        it.ground += dt;
        it.yaw += dt * 0.9;
        const bob = Math.sin(it.age * 2.3) * 0.035;
        let y;
        if (it.ground < SETTLE) y = it.half + Math.sin((it.ground / SETTLE) * Math.PI) * 0.06; // 落地小彈跳
        else y = it.half + (L.hover + bob - it.half) * ease(Math.min(1, (it.ground - SETTLE) / RISE));
        h.position.set(0, y, 0);
        h.rotation.set(Math.sin(it.age * 1.3) * 0.05, it.yaw, Math.cos(it.age * 1.1) * 0.05);
        glowK = ease(Math.min(1, it.ground / (SETTLE + RISE)));
      } else { // taken:縮小飛向玩家
        it.take += dt / 0.22;
        const u = Math.min(1, it.take), e = u * u;
        h.position.set(
          it.takeFrom.x + (p.pos.x - pos.x - it.takeFrom.x) * e,
          it.takeFrom.y + (py + 1.15 - pos.y - it.takeFrom.y) * e,
          it.takeFrom.z + (p.pos.z - pos.z - it.takeFrom.z) * e,
        );
        h.scale.setScalar(1 - 0.85 * u);
        it.ring.material.opacity = (1 - u) * 1.1;
        it.ring.scale.setScalar(L.ring * (1 + u * 0.7));
        it.beam.material.opacity = (1 - u) * 0.35;
        it.glow.material.opacity = (1 - u) * 0.6;
        if (u >= 1) this._remove(i);
        continue;
      }

      // 壽命:最後幾秒閃爍(越來越快),最後 0.35 秒縮小消失
      const rem = Q.life - it.age;
      let vis = 1;
      if (rem < Q.blink) {
        it.blink += dt * (2.2 + (1 - rem / Q.blink) * 7);
        const on = it.blink % 1 < 0.62;
        h.visible = on;
        vis = on ? 1 : 0.2;
        if (rem < 0.35) h.scale.setScalar(Math.max(0.01, rem / 0.35));
        if (rem <= 0) { this._remove(i); continue; }
      }

      // 遠距補償:越遠光暈與光柱越寬,在黑暗的長廊盡頭也找得到
      const far = Math.min(1, Math.max(0, (Math.hypot(cam.x - pos.x, cam.z - pos.z) - 6) / 20));
      const pulse = Math.sin(it.age * 3.1);
      it.ring.material.opacity = (0.62 + 0.22 * pulse) * glowK * vis;
      it.ring.scale.setScalar(L.ring * (1 + 0.035 * pulse));
      it.ring.rotation.z += dt * 0.5;
      it.beam.material.opacity = (0.26 + 0.04 * Math.sin(it.age * 1.7)) * (1 + far * 0.6) * glowK * vis;
      it.beam.scale.x = L.beamW * (1 + far * 1.3);
      it.beam.rotation.y = Math.atan2(cam.x - pos.x, cam.z - pos.z); // 只繞 Y 軸面向鏡頭
      it.glow.position.y = h.position.y;
      it.glow.scale.setScalar(L.glow * (1 + far * 1.8));
      it.glow.material.opacity = (0.3 + 0.08 * pulse) * (1 + far * 0.4) * Math.max(glowK, it.state === 'fly' ? 0.5 : 0) * vis;

      // 撿取
      if (it.state !== 'idle' || p.hp <= 0) continue;
      const near = Math.hypot(p.pos.x - pos.x, p.pos.z - pos.z) < Q.reach && Math.abs(py - pos.y) < Q.reachY;
      if (!near) { it.denied = false; continue; }
      if (this.apply(it, game)) {
        it.state = 'take';
        it.take = 0;
        it.takeFrom.copy(h.position);
        h.visible = true;
      } else if (!it.denied) {
        it.denied = true;
        if (this.denyT <= 0) {
          this.denyT = 1.6;
          game.ui.pickup(it.kind === 'med' ? '生命已滿' : '彈藥已滿', '#a3a39a');
          say('pickupDeny', 'deny');
        }
      }
    }
  }

  // 套用效果;已滿時回傳 false(留在地上)
  apply(it, game) {
    const w = game.weapons, p = game.player, ui = game.ui, L = it.L;
    if (it.kind === 'med') {
      const gain = Math.min(DROP_RULES.heal, p.maxHp - p.hp);
      if (gain <= 0) return false;
      p.hp += gain;
      ui.setHP(p.hp, p.maxHp);
      ui.pickup(`+${Math.round(gain)} 生命`, L.css, { icon: 'med', panel: 'health' });
      say('pickupMed', 'switch');
      return true;
    }
    const ids = Object.keys(w.inv).sort((a, b) => (b === w.current) - (a === w.current)); // 目前武器優先
    if (it.kind === 'bigammo') {
      if (ids.every((id) => w.inv[id].mag >= WEAPONS[id].mag && w.inv[id].reserve >= WEAPONS[id].reserveCap)) return false;
      w.refillAll();
      ui.pickup('大彈藥箱', L.css, { icon: 'ammo', sub: '所有武器彈藥補滿', panel: 'ammo' });
    } else {
      const got = [];
      for (const id of ids) {
        const d = WEAPONS[id], a = w.inv[id];
        const n = Math.min(id === w.current ? d.mag : Math.ceil(d.mag / 2), d.reserveCap - a.reserve);
        if (n > 0) { a.reserve += n; got.push(`+${n} ${d.name}`); }
      }
      if (!got.length) return false;
      ui.pickup(`${got[0]} 彈藥`, L.css, { icon: 'ammo', sub: got.slice(1).join(' · '), panel: 'ammo' });
    }
    if (w.ammo.mag === 0) w.startReload(); // 空槍撿到彈藥直接換彈
    if (game.updateAmmoHud) game.updateAmmoHud();
    say('pickupAmmo', 'switch');
    return true;
  }

  _remove(i) {
    const it = this.items[i];
    this.scene.remove(it.root);
    it.ring.material.dispose();
    it.beam.material.dispose();
    it.glow.material.dispose();
    this.items.splice(i, 1);
  }

  clear() {
    while (this.items.length) this._remove(this.items.length - 1);
    this.dry = 0;
    this.denyT = 0;
  }
}
