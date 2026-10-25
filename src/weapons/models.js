import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

// 槍模座標:原點在握把,槍口朝 -Z,上方為 +Y,單位公尺。
// 配色依真槍:
//   Glock 17  黑色聚合物槍身 + 深灰氮化滑套
//   Colt Python 藍鋼(blued)槍身 + 胡桃木握把
//   AK-47     磷化黑鋼 + 胡桃木護木/槍托/握把
//   M4A1      黑色陽極氧化鋁 + 黑色聚合物

function woodTexture(base, dark) {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 128;
  const ctx = c.getContext('2d');
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 70; i++) {
    ctx.strokeStyle = dark;
    ctx.globalAlpha = 0.08 + Math.random() * 0.18;
    ctx.lineWidth = 0.6 + Math.random() * 1.6;
    ctx.beginPath();
    const y = Math.random() * 128;
    ctx.moveTo(0, y);
    ctx.bezierCurveTo(40, y + (Math.random() - 0.5) * 8, 90, y + (Math.random() - 0.5) * 8, 128, y + (Math.random() - 0.5) * 6);
    ctx.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

const M = {
  steel: new THREE.MeshStandardMaterial({ color: 0x2b2d2c, roughness: 0.55, metalness: 0.85 }),
  steelWorn: new THREE.MeshStandardMaterial({ color: 0x4a4c4a, roughness: 0.4, metalness: 0.9 }),
  slide: new THREE.MeshStandardMaterial({ color: 0x33373a, roughness: 0.42, metalness: 0.8 }),
  polymer: new THREE.MeshStandardMaterial({ color: 0x242424, roughness: 0.8, metalness: 0.05 }),
  anodized: new THREE.MeshStandardMaterial({ color: 0x232324, roughness: 0.5, metalness: 0.55 }),
  blued: new THREE.MeshStandardMaterial({ color: 0x1c2631, roughness: 0.22, metalness: 0.95 }),
  walnut: new THREE.MeshStandardMaterial({ map: woodTexture('#6a3a1c', '#2a1206'), color: 0xc2b0a0, roughness: 0.55 }),
  walnutDark: new THREE.MeshStandardMaterial({ map: woodTexture('#4e2813', '#220d04'), color: 0xc2b0a0, roughness: 0.5 }),
  glove: new THREE.MeshStandardMaterial({ color: 0x33342f, roughness: 0.85 }),
  sleeve: new THREE.MeshStandardMaterial({ color: 0x353d2f, roughness: 1 }),
  skin: new THREE.MeshStandardMaterial({ color: 0xb98a6f, roughness: 0.8 }),
};

function mk(parent, geo, mat, x, y, z, rx = 0, ry = 0, rz = 0) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.rotation.set(rx, ry, rz);
  m.castShadow = false;
  parent.add(m);
  return m;
}
const B = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const C = (r, len, seg = 14) => new THREE.CylinderGeometry(r, r, len, seg);
const HALF = Math.PI / 2;

// ---------- 各槍 ----------
function buildPistol(g) {
  mk(g, B(0.032, 0.034, 0.19), M.slide, 0, 0.03, -0.075);
  mk(g, B(0.034, 0.008, 0.19), M.slide, 0, 0.048, -0.075); // 滑套頂部倒角
  mk(g, B(0.028, 0.022, 0.15), M.polymer, 0, 0.004, -0.055);
  mk(g, B(0.032, 0.105, 0.05), M.polymer, 0, -0.05, 0.027, -0.25);
  mk(g, B(0.034, 0.012, 0.056), M.polymer, 0, -0.108, 0.048, -0.25); // 彈匣底板
  mk(g, B(0.012, 0.006, 0.05), M.polymer, 0, -0.016, -0.075); // 扳機護圈
  mk(g, B(0.012, 0.03, 0.006), M.polymer, 0, -0.03, -0.1);
  mk(g, B(0.006, 0.02, 0.006), M.steelWorn, 0, -0.008, -0.052, 0.2); // 扳機
  mk(g, C(0.0052, 0.004), M.steel, 0, 0.03, -0.171, HALF);
  mk(g, B(0.018, 0.008, 0.012), M.steel, 0, 0.052, 0.012); // 照門
  mk(g, B(0.006, 0.008, 0.01), M.steel, 0, 0.054, -0.165); // 準星
  mk(g, B(0.003, 0.008, 0.05), M.steelWorn, 0.0165, 0.032, -0.07); // 滑套紋路
  return { muzzle: new THREE.Vector3(0, 0.03, -0.18), length: 0.2 };
}

function buildRevolver(g) {
  mk(g, B(0.032, 0.07, 0.1), M.blued, 0, 0.012, -0.015);
  const drum = mk(g, C(0.03, 0.055, 18), M.blued, 0, 0.022, -0.045, HALF);
  for (let i = 0; i < 6; i++) { // 彈巢溝槽
    const a = (i / 6) * Math.PI * 2;
    mk(g, C(0.0075, 0.057, 8), M.steel, Math.cos(a) * 0.026, 0.022 + Math.sin(a) * 0.026, -0.045, HALF);
  }
  mk(g, C(0.011, 0.2, 14), M.blued, 0, 0.034, -0.19, HALF); // 槍管
  mk(g, C(0.016, 0.13, 14), M.blued, 0, 0.016, -0.15, HALF); // 下方護套(full lug)
  mk(g, B(0.009, 0.007, 0.2), M.blued, 0, 0.049, -0.19); // 通風肋
  mk(g, B(0.007, 0.012, 0.012), M.steel, 0, 0.059, -0.285); // 準星
  mk(g, B(0.018, 0.014, 0.014), M.steel, 0, 0.057, 0.032); // 照門
  mk(g, B(0.008, 0.026, 0.022), M.steelWorn, 0, 0.056, 0.045, 0.5); // 擊錘
  mk(g, B(0.036, 0.115, 0.052), M.walnut, 0, -0.068, 0.045, -0.3); // 木握把
  mk(g, B(0.009, 0.008, 0.075), M.blued, 0, -0.03, -0.01); // 扳機護圈
  mk(g, B(0.006, 0.022, 0.008), M.steelWorn, 0, -0.01, 0.0, 0.2);
  return { muzzle: new THREE.Vector3(0, 0.034, -0.3), length: 0.3, drum };
}

function buildAK(g) {
  mk(g, B(0.04, 0.07, 0.4), M.steel, 0, 0.03, -0.17); // 機匣
  mk(g, B(0.036, 0.012, 0.3), M.steel, 0, 0.074, -0.19, -0.02); // 防塵蓋
  mk(g, B(0.03, 0.008, 0.04), M.steel, 0, 0.078, 0.0); // 照門座
  mk(g, C(0.0095, 0.34, 12), M.steelWorn, 0, 0.045, -0.5, HALF); // 槍管
  mk(g, C(0.012, 0.22, 12), M.steel, 0, 0.073, -0.46, HALF); // 導氣管
  mk(g, B(0.03, 0.02, 0.1), M.walnut, 0, 0.078, -0.46); // 上護木
  mk(g, B(0.042, 0.052, 0.2), M.walnut, 0, 0.015, -0.42); // 下護木
  mk(g, B(0.03, 0.045, 0.04), M.steel, 0, 0.075, -0.64); // 準星座
  mk(g, B(0.004, 0.03, 0.006), M.steel, 0, 0.1, -0.64);
  mk(g, B(0.03, 0.036, 0.03), M.steel, 0, 0.048, -0.62); // 氣塊
  mk(g, C(0.013, 0.05, 10), M.steel, 0, 0.045, -0.7, HALF); // 槍口制退器
  mk(g, B(0.036, 0.1, 0.05), M.walnutDark, 0, -0.058, 0.015, -0.28); // 握把
  mk(g, B(0.038, 0.07, 0.3), M.walnut, 0, 0.0, 0.2, 0.06); // 槍托
  mk(g, B(0.04, 0.12, 0.02), M.steelWorn, 0, -0.012, 0.358, 0.06); // 鋼製底板
  mk(g, B(0.012, 0.006, 0.07), M.steel, 0, -0.025, -0.05); // 扳機護圈
  mk(g, B(0.006, 0.022, 0.006), M.steelWorn, 0, -0.012, -0.06, 0.2);
  mk(g, B(0.012, 0.016, 0.05), M.steelWorn, 0.026, 0.045, -0.08); // 拉機柄
  // 彎彈匣
  let px = -0.14, py = -0.005, rot = 0;
  for (let i = 0; i < 4; i++) {
    const len = 0.075;
    const dy = -Math.cos(rot) * len, dz = -Math.sin(rot) * len;
    mk(g, B(0.03, len + 0.004, 0.056), M.steel, 0, py + dy / 2, px + dz / 2, rot);
    py += dy;
    px += dz;
    rot += 0.18;
  }
  return { muzzle: new THREE.Vector3(0, 0.045, -0.73), length: 0.9 };
}

function buildM4(g) {
  mk(g, B(0.038, 0.062, 0.21), M.anodized, 0, -0.012, -0.03); // 下機匣
  mk(g, B(0.04, 0.052, 0.27), M.anodized, 0, 0.042, -0.1); // 上機匣
  mk(g, B(0.03, 0.024, 0.22), M.anodized, 0, 0.086, -0.09); // 提把
  mk(g, B(0.022, 0.012, 0.03), M.steel, 0, 0.1, 0.0); // 照門
  mk(g, B(0.014, 0.016, 0.015), M.steel, 0, 0.1, -0.18);
  mk(g, C(0.029, 0.26, 16), M.anodized, 0, 0.044, -0.37, HALF); // 護木
  for (let i = 0; i < 6; i++) mk(g, C(0.0305, 0.006, 16), M.steel, 0, 0.044, -0.27 - i * 0.04, HALF); // 護木紋路
  mk(g, C(0.0085, 0.2, 10), M.steelWorn, 0, 0.044, -0.58, HALF); // 槍管
  mk(g, B(0.014, 0.05, 0.022), M.steel, 0, 0.075, -0.5); // 準星座
  mk(g, B(0.004, 0.022, 0.006), M.steel, 0, 0.102, -0.5);
  mk(g, C(0.014, 0.065, 12), M.steel, 0, 0.044, -0.665, HALF); // 消焰器
  mk(g, C(0.017, 0.2, 12), M.polymer, 0, 0.02, 0.24, HALF); // 緩衝管
  mk(g, B(0.042, 0.09, 0.18), M.polymer, 0, 0.0, 0.3, 0.05); // 伸縮槍托
  mk(g, B(0.044, 0.1, 0.02), M.polymer, 0, -0.005, 0.395, 0.05);
  mk(g, B(0.034, 0.1, 0.05), M.polymer, 0, -0.06, 0.04, -0.35); // 握把
  mk(g, B(0.03, 0.125, 0.052), M.anodized, 0, -0.108, -0.075, 0.1); // STANAG 彈匣
  mk(g, B(0.012, 0.006, 0.07), M.anodized, 0, -0.04, -0.03);
  mk(g, B(0.006, 0.022, 0.006), M.steelWorn, 0, -0.018, -0.02, 0.2);
  mk(g, B(0.016, 0.012, 0.04), M.steelWorn, 0, 0.074, 0.04); // 拉柄
  mk(g, B(0.006, 0.02, 0.045), M.steelWorn, 0.022, 0.032, -0.04); // 彈出口蓋
  return { muzzle: new THREE.Vector3(0, 0.044, -0.7), length: 0.83 };
}

const BUILDERS = { pistol: buildPistol, revolver: buildRevolver, ak47: buildAK, m4a1: buildM4 };

// ---------- 手臂 ----------
function limb(parent, from, to, w, h) {
  const dir = new THREE.Vector3().subVectors(to, from);
  const len = dir.length();
  const m = new THREE.Mesh(new THREE.CylinderGeometry(w * 0.5, w * 0.62, len, 10), M.sleeve);
  m.position.copy(from).addScaledVector(dir, 0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
  parent.add(m);
  return m;
}

function buildHands(g, id) {
  // 右手:包住握把
  const rg = new THREE.Group();
  g.add(rg);
  const rz = id === 'ak47' ? 0.03 : id === 'm4a1' ? 0.05 : id === 'revolver' ? 0.05 : 0.035;
  mk(rg, B(0.052, 0.09, 0.07), M.glove, 0.004, -0.052, rz);
  mk(rg, B(0.028, 0.02, 0.05), M.glove, -0.026, 0.0, rz - 0.01); // 虎口/拇指
  mk(rg, B(0.012, 0.014, 0.05), M.glove, -0.02, -0.002, -0.055); // 食指搭在扳機護圈
  mk(rg, B(0.05, 0.05, 0.07), M.glove, 0.01, -0.095, rz + 0.01); // 掌根
  limb(rg, new THREE.Vector3(0.012, -0.07, rz + 0.045), new THREE.Vector3(0.1, -0.3, rz + 0.5), 0.075, 0.075);
  // 左手:長槍扶護木,短槍托住握把
  const lg = new THREE.Group();
  g.add(lg);
  let lp;
  if (id === 'ak47') lp = new THREE.Vector3(0, -0.032, -0.4);
  else if (id === 'm4a1') lp = new THREE.Vector3(0, -0.03, -0.33);
  else lp = new THREE.Vector3(-0.04, -0.06, -0.0);
  if (id === 'ak47' || id === 'm4a1') {
    mk(lg, B(0.075, 0.05, 0.095), M.glove, lp.x, lp.y, lp.z);
    mk(lg, B(0.02, 0.04, 0.07), M.glove, lp.x - 0.04, lp.y + 0.03, lp.z); // 拇指
    limb(lg, new THREE.Vector3(lp.x - 0.01, lp.y - 0.02, lp.z + 0.05), new THREE.Vector3(-0.2, -0.3, lp.z + 0.5), 0.075, 0.075);
  } else {
    mk(lg, B(0.04, 0.08, 0.07), M.glove, lp.x, lp.y, lp.z + 0.03);
    limb(lg, new THREE.Vector3(lp.x - 0.01, lp.y - 0.03, lp.z + 0.06), new THREE.Vector3(-0.25, -0.32, 0.45), 0.075, 0.075);
  }
  return { rg, lg };
}

// 建立第一人稱用的武器模型(含雙手)
export function createWeaponModel(id) {
  const root = new THREE.Group();
  const gun = new THREE.Group();
  root.add(gun);
  const info = BUILDERS[id](gun);
  const hands = new THREE.Group();
  root.add(hands);
  buildHands(hands, id);
  const muzzle = new THREE.Object3D();
  muzzle.position.copy(info.muzzle);
  root.add(muzzle);
  return { root, gun, hands, muzzle, info };
}

// 商店展示用:只有槍
export function createDisplayGun(id) {
  const g = new THREE.Group();
  BUILDERS[id](g);
  g.traverse((o) => { if (o.isMesh) { o.castShadow = true; } });
  return g;
}

// 若 public/models/<id>.glb 存在就換成網路下載的模型(自動縮放到真槍長度、對齊握把)
const loader = new GLTFLoader();
export async function tryLoadGLB(model, id) {
  const url = `${import.meta.env.BASE_URL}models/${id}.glb`;
  try {
    const head = await fetch(url, { method: 'HEAD' });
    const type = head.headers.get('content-type') || '';
    if (!head.ok || type.includes('text/html')) return false;
    const gltf = await loader.loadAsync(url);
    const obj = gltf.scene;
    const box = new THREE.Box3().setFromObject(obj);
    const size = box.getSize(new THREE.Vector3());
    const wrapper = new THREE.Group();
    wrapper.add(obj);
    if (size.x > size.z) wrapper.rotation.y = HALF; // 讓槍管朝向 -Z
    wrapper.updateMatrixWorld(true);
    const box2 = new THREE.Box3().setFromObject(wrapper);
    const size2 = box2.getSize(new THREE.Vector3());
    const s = model.info.length / Math.max(size2.z, 1e-4);
    wrapper.scale.setScalar(s);
    wrapper.updateMatrixWorld(true);
    const box3 = new THREE.Box3().setFromObject(wrapper);
    const center = box3.getCenter(new THREE.Vector3());
    // 槍管前端對齊原本槍口,握把大約落在原點
    wrapper.position.set(-center.x, -box3.max.y + 0.05 - 0.0, -center.z - model.info.length * 0.28);
    model.gun.clear();
    model.gun.add(wrapper);
    return true;
  } catch {
    return false;
  }
}
