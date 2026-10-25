import * as THREE from 'three';
import { rng } from './anatomy.js';

// 殭屍共用材質。顏色細節(屍斑、瘀青、血、汙垢)都畫在頂點色上,
// 這裡的貼圖只負責可平鋪的微細節:毛孔、皺紋、血管、布料織紋、髮絲。

function cv(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')];
}
// 在 3x3 位移上重畫,讓圖案可無縫平鋪
function wrap(ctx, W, H, fn) {
  for (const ox of [-W, 0, W]) for (const oy of [-H, 0, H]) { ctx.save(); ctx.translate(ox, oy); fn(); ctx.restore(); }
}
function tex(c, srgb = true) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// 皮膚:毛孔、皺紋、分岔血管(色彩圖 + 凹凸圖共用同一組路徑)
function skinDetail() {
  const S = 512, r = rng(42);
  const [c, x] = cv(S, S);
  const [cb, xb] = cv(S, S);
  x.fillStyle = '#e6dfd8';
  x.fillRect(0, 0, S, S);
  xb.fillStyle = '#808080';
  xb.fillRect(0, 0, S, S);
  // 大片斑駁
  for (let i = 0; i < 220; i++) {
    const px = r() * S, py = r() * S, rad = 10 + r() * 60, a = 0.03 + r() * 0.07;
    wrap(x, S, S, () => {
      const g = x.createRadialGradient(px, py, 0, px, py, rad);
      g.addColorStop(0, `rgba(120,105,100,${a})`);
      g.addColorStop(1, 'rgba(120,105,100,0)');
      x.fillStyle = g;
      x.fillRect(px - rad, py - rad, rad * 2, rad * 2);
    });
  }
  // 血管:隨機分岔
  const veins = [];
  const branch = (px, py, ang, len, w, depth) => {
    const pts = [[px, py]];
    for (let k = 0; k < len; k++) {
      ang += (r() - 0.5) * 0.7;
      px += Math.cos(ang) * 5;
      py += Math.sin(ang) * 5;
      pts.push([px, py]);
      if (depth < 3 && r() < 0.07) branch(px, py, ang + (r() < 0.5 ? -1 : 1) * (0.5 + r() * 0.6), len * 0.5, w * 0.6, depth + 1);
    }
    veins.push({ pts, w });
  };
  for (let i = 0; i < 9; i++) branch(r() * S, r() * S, r() * Math.PI * 2, 30 + r() * 40, 1.6 + r() * 1.6, 0);
  for (const v of veins) {
    wrap(x, S, S, () => {
      x.strokeStyle = `rgba(70,45,85,${0.18 + v.w * 0.08})`;
      x.lineWidth = v.w;
      x.lineCap = 'round';
      x.beginPath();
      v.pts.forEach(([a, b], k) => (k ? x.lineTo(a, b) : x.moveTo(a, b)));
      x.stroke();
    });
    wrap(xb, S, S, () => {
      xb.strokeStyle = 'rgba(200,200,200,0.55)';
      xb.lineWidth = v.w * 1.4;
      xb.lineCap = 'round';
      xb.beginPath();
      v.pts.forEach(([a, b], k) => (k ? xb.lineTo(a, b) : xb.moveTo(a, b)));
      xb.stroke();
    });
  }
  // 皺紋
  for (let i = 0; i < 260; i++) {
    const px = r() * S, py = r() * S, l = 6 + r() * 18, ang = r() * Math.PI;
    const ex = px + Math.cos(ang) * l, ey = py + Math.sin(ang) * l;
    const mx = (px + ex) / 2 + (r() - 0.5) * 6, my = (py + ey) / 2 + (r() - 0.5) * 6;
    wrap(x, S, S, () => { x.strokeStyle = 'rgba(70,55,50,0.12)'; x.lineWidth = 0.8; x.beginPath(); x.moveTo(px, py); x.quadraticCurveTo(mx, my, ex, ey); x.stroke(); });
    wrap(xb, S, S, () => { xb.strokeStyle = 'rgba(40,40,40,0.5)'; xb.lineWidth = 1; xb.beginPath(); xb.moveTo(px, py); xb.quadraticCurveTo(mx, my, ex, ey); xb.stroke(); });
  }
  // 毛孔與顆粒
  const img = x.getImageData(0, 0, S, S), d = img.data;
  const imb = xb.getImageData(0, 0, S, S), db = imb.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (r() - 0.5) * 18;
    d[i] += n; d[i + 1] += n; d[i + 2] += n;
    db[i] += n * 1.5; db[i + 1] = db[i]; db[i + 2] = db[i];
    if (r() < 0.012) { d[i] -= 40; d[i + 1] -= 45; d[i + 2] -= 40; db[i] = db[i + 1] = db[i + 2] = 40; }
  }
  x.putImageData(img, 0, 0);
  xb.putImageData(imb, 0, 0);
  return { map: tex(c), bump: tex(cb, false) };
}

// 布料:織紋 + 纖維雜訊(alphaMap 用來讓破口邊緣毛躁)
function clothDetail() {
  const S = 256, r = rng(77);
  const [c, x] = cv(S, S);
  x.fillStyle = '#e8e8e8';
  x.fillRect(0, 0, S, S);
  for (let i = 0; i < S; i += 2) {
    x.fillStyle = `rgba(0,0,0,${0.05 + r() * 0.05})`;
    x.fillRect(0, i, S, 1);
    x.fillStyle = `rgba(0,0,0,${0.04 + r() * 0.04})`;
    x.fillRect(i, 0, 1, S);
  }
  for (let i = 0; i < 1400; i++) { x.fillStyle = `rgba(${r() < 0.5 ? '0,0,0' : '255,255,255'},${r() * 0.08})`; x.fillRect(r() * S, r() * S, 1 + r() * 3, 1); }
  const [ca, xa] = cv(S, S);
  const img = xa.createImageData(S, S), d = img.data;
  for (let i = 0; i < d.length; i += 4) { const v = 150 + r() * 105; d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 255; }
  xa.putImageData(img, 0, 0);
  xa.globalAlpha = 0.5;
  for (let i = 0; i < 900; i++) { // 纖維
    const px = r() * S, py = r() * S, a = r() * Math.PI;
    wrap(xa, S, S, () => { xa.strokeStyle = r() < 0.5 ? '#ffffff' : '#7a7a7a'; xa.lineWidth = 1; xa.beginPath(); xa.moveTo(px, py); xa.lineTo(px + Math.cos(a) * 9, py + Math.sin(a) * 9); xa.stroke(); });
  }
  return { map: tex(c), alpha: tex(ca, false) };
}

function hairDetail() {
  const S = 256, r = rng(5);
  const [c, x] = cv(S, S);
  x.clearRect(0, 0, S, S);
  for (let i = 0; i < 2200; i++) {
    const px = r() * S, py = r() * S, l = 30 + r() * 140, sway = (r() - 0.5) * 14;
    const a = 0.25 + r() * 0.7, sh = 150 + r() * 105;
    wrap(x, S, S, () => {
      x.strokeStyle = `rgba(${sh},${sh},${sh},${a})`;
      x.lineWidth = 0.6 + r() * 1.2;
      x.beginPath();
      x.moveTo(px, py);
      x.quadraticCurveTo(px + sway, py + l / 2, px + sway * 0.3, py + l);
      x.stroke();
    });
  }
  return tex(c);
}

// 眼球:混濁鞏膜 + 血絲 + 灰白虹膜(u=0.25 朝前);自發光貼圖只亮虹膜
function eyeTex(iris, glow) {
  const W = 128, H = 64, r = rng(11);
  const [c, x] = cv(W, H);
  x.fillStyle = '#d6d0bc';
  x.fillRect(0, 0, W, H);
  for (let i = 0; i < 40; i++) {
    let px = r() < 0.5 ? r() * 14 + 50 : r() * 14, py = r() * H;
    x.strokeStyle = `rgba(150,20,20,${0.3 + r() * 0.5})`;
    x.lineWidth = 0.5 + r() * 0.8;
    x.beginPath();
    x.moveTo(px, py);
    for (let k = 0; k < 6; k++) { px += (32 - px) * 0.12 + (r() - 0.5) * 4; py += (32 - py) * 0.1 + (r() - 0.5) * 4; x.lineTo(px, py); }
    x.stroke();
  }
  const g = x.createRadialGradient(32, 32, 0, 32, 32, 11);
  g.addColorStop(0, glow ? '#fff4c0' : '#2a2a28');
  g.addColorStop(0.25, iris);
  g.addColorStop(0.85, iris);
  g.addColorStop(1, 'rgba(120,110,90,0.2)');
  x.fillStyle = g;
  x.beginPath();
  x.arc(32, 32, 11, 0, Math.PI * 2);
  x.fill();
  x.fillStyle = 'rgba(235,232,215,0.35)'; // 白內障霧
  x.beginPath();
  x.arc(32, 32, 9, 0, Math.PI * 2);
  x.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  const [ce, xe] = cv(W, H);
  xe.fillStyle = '#000';
  xe.fillRect(0, 0, W, H);
  const ge = xe.createRadialGradient(32, 32, 0, 32, 32, 9);
  ge.addColorStop(0, glow ? '#ffffff' : '#555555');
  ge.addColorStop(0.6, glow ? '#c0c0c0' : '#303030');
  ge.addColorStop(1, '#000000');
  xe.fillStyle = ge;
  xe.fillRect(0, 0, W, H);
  const te = new THREE.CanvasTexture(ce);
  te.colorSpace = THREE.SRGBColorSpace;
  return { map: t, glow: te };
}

let M = null;
export function materials() {
  if (M) return M;
  const sk = skinDetail(), cl = clothDetail();
  const skinMat = new THREE.MeshStandardMaterial({ vertexColors: true, map: sk.map, bumpMap: sk.bump, bumpScale: 1.6, roughness: 0.7 });
  // 頂點色的 alpha 當作「濕潤度」:血與傷口較亮滑
  skinMat.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader.replace(
      '#include <roughnessmap_fragment>',
      '#include <roughnessmap_fragment>\n#ifdef USE_COLOR_ALPHA\nroughnessFactor = mix(roughnessFactor, 0.38, smoothstep(0.2, 1.0, vColor.a));\n#endif',
    );
  };
  skinMat.customProgramCacheKey = () => 'zskin';
  const eye = (iris, emissive, intensity) => {
    const e = eyeTex(iris, intensity > 0.9);
    return new THREE.MeshStandardMaterial({ map: e.map, roughness: 0.2, emissive, emissiveMap: e.glow, emissiveIntensity: intensity });
  };
  M = {
    skin: skinMat,
    cloth: new THREE.MeshStandardMaterial({
      vertexColors: true, map: cl.map, alphaMap: cl.alpha, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.93,
    }),
    gear: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.2 }),
    bone: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.42 }),
    hair: new THREE.MeshStandardMaterial({ vertexColors: true, map: hairDetail(), alphaTest: 0.38, side: THREE.DoubleSide, roughness: 0.75 }),
    glow: new THREE.MeshStandardMaterial({ vertexColors: true, color: 0xb8a878, emissive: 0x5a6a0a, emissiveIntensity: 0.6, roughness: 0.18 }),
    eye: {
      walker: eye('#8d9088', 0x3a3a30, 0.6),
      runner: eye('#a01808', 0xff3010, 1.6),
      crawler: eye('#b8b090', 0x403a28, 0.6),
      bloater: eye('#b8c020', 0xc8e020, 1.4),
      brute: eye('#ff5a10', 0xff4a08, 1.8),
    },
  };
  return M;
}
