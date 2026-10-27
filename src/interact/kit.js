import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// 互動物件的建模工具:零件用局部座標描述(公尺;原點在地面/牆面,+Z 朝房間內),顏色烘進頂點色。
//  靜態零件 → 依「樓層 × 材質」合併成少數幾個網格(整層互動物件的外殼 ≈ 6 個 draw call)
//  會動的零件 → 同一種零件做成 InstancedMesh 池(開關撥桿、指示燈、聽筒、櫃門…一層一種一個 draw call)
//  獨立網格只留給「有自己貼圖狀態」的東西(電視螢幕、販賣機面板)
// 材質全部在建構時建好、整局不換(main.js 開機時整個場景一起預編譯 shader;執行期不會新增 program)。
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _v = new THREE.Vector3(), _s = new THREE.Vector3();
export const T = (x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) => {
  _e.set(rx, ry, rz, 'YXZ');
  return new THREE.Matrix4().compose(_v.set(x, y, z), _q.setFromEuler(_e), _s.set(sx, sy, sz));
};

const GEO = new Map();
const geo = (key, make) => { let g = GEO.get(key); if (!g) { g = make(); g.userData.shared = true; GEO.set(key, g); } return g; };
export const G = {
  box: () => geo('box', () => new THREE.BoxGeometry(1, 1, 1)),
  cyl: (n = 12) => geo('cyl' + n, () => new THREE.CylinderGeometry(0.5, 0.5, 1, n)),
  cone: (n = 12, top = 0.5) => geo(`cone${n}|${top}`, () => new THREE.CylinderGeometry(top * 0.5, 0.5, 1, n)),
  sph: (n = 10) => geo('sph' + n, () => new THREE.SphereGeometry(0.5, n, Math.max(6, (n * 0.7) | 0))),
  torus: (t = 0.15, n = 16) => geo(`tor${t}|${n}`, () => new THREE.TorusGeometry(0.5, t, 6, n)),
  plane: () => geo('plane', () => new THREE.PlaneGeometry(1, 1)),
};
const col = (c) => (c instanceof THREE.Color ? c : new THREE.Color(c));

// ---------- 零件收集器 ----------
export class Model {
  constructor() { this.parts = []; }
  add(mat, color, g, m) { this.parts.push({ mat, color: col(color), g, m }); return this; }
  // 方塊:中心 (x,y,z)、尺寸 (sx,sy,sz)、旋轉 (rx,ry,rz)
  box(mat, color, x, y, z, sx, sy, sz, rx = 0, ry = 0, rz = 0) { return this.add(mat, color, G.box(), T(x, y, z, rx, ry, rz, sx, sy, sz)); }
  // 底對齊的方塊(y0 = 底面)
  slab(mat, color, x, y0, z, sx, sy, sz, ry = 0) { return this.box(mat, color, x, y0 + sy / 2, z, sx, sy, sz, 0, ry); }
  cyl(mat, color, x, y, z, d, h, n = 12, rx = 0, ry = 0, rz = 0, d2 = d) { return this.add(mat, color, G.cyl(n), T(x, y, z, rx, ry, rz, d, h, d2)); }
  cone(mat, color, x, y, z, d, h, top = 0.5, n = 12, rx = 0, ry = 0, rz = 0) { return this.add(mat, color, G.cone(n, top), T(x, y, z, rx, ry, rz, d, h, d)); }
  sph(mat, color, x, y, z, d, n = 10, sy = d, sz = d) { return this.add(mat, color, G.sph(n), T(x, y, z, 0, 0, 0, d, sy, sz)); }
  torus(mat, color, x, y, z, d, t = 0.15, rx = 0, ry = 0, rz = 0, n = 16) { return this.add(mat, color, G.torus(t, n), T(x, y, z, rx, ry, rz, d, d, d)); }
  // 平面(+Z 朝外):貼圖面板、紙張
  quad(mat, x, y, z, w, h, rx = 0, ry = 0, rz = 0, color = 0xffffff) { return this.add(mat, color, G.plane(), T(x, y, z, rx, ry, rz, w, h, 1)); }
  // 合併成單一幾何(局部座標);mats 篩選材質
  geometry(mat) {
    const list = [];
    for (const p of this.parts) if (!mat || p.mat === mat) list.push(bake(p, p.m));
    if (!list.length) return null;
    const g = mergeGeometries(list);
    for (const x of list) x.dispose();
    return g;
  }
  mats() { return [...new Set(this.parts.map((p) => p.mat))]; }
}
function bake(p, m) {
  const g = (p.g.index ? p.g.toNonIndexed() : p.g.clone());
  for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
  g.applyMatrix4(m);
  const n = g.attributes.position.count, c = new Float32Array(n * 3);
  for (let i = 0; i < n * 3; i += 3) { c[i] = p.color.r; c[i + 1] = p.color.g; c[i + 2] = p.color.b; }
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  return g;
}

// ---------- 貼圖(canvas;依名稱快取,整局共用) ----------
const TEX = new Map();
export function canvasTex(name, w, h, draw, { srgb = true, repeat = false } = {}) {
  let t = TEX.get(name);
  if (t) return t;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  TEX.set(name, t);
  return t;
}
export const FONT = '"Microsoft JhengHei", "PingFang TC", "Noto Sans TC", sans-serif';
export const HAND = '"DFKai-SB", "BiauKai", "KaiTi", "Microsoft JhengHei", serif';

// ---------- 材質(全部共用;依粗糙度/金屬度分) ----------
let MATS = null;
export function mats() {
  if (MATS) return MATS;
  const std = (o) => new THREE.MeshStandardMaterial({ vertexColors: true, ...o });
  MATS = {
    matte: std({ roughness: 0.88, metalness: 0, name: 'ix:matte' }),
    paint: std({ roughness: 0.62, metalness: 0.05, name: 'ix:paint' }),
    plastic: std({ roughness: 0.42, metalness: 0, name: 'ix:plastic' }),
    gloss: std({ roughness: 0.22, metalness: 0, name: 'ix:gloss' }),
    metal: std({ roughness: 0.38, metalness: 0.8, name: 'ix:metal' }),
    rust: std({ roughness: 0.75, metalness: 0.45, name: 'ix:rust' }),
    wood: std({ roughness: 0.7, metalness: 0, name: 'ix:wood' }),
    glass: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.06, metalness: 0.1, transparent: true, opacity: 0.32, depthWrite: false, name: 'ix:glass' }),
    glow: new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: true, name: 'ix:glow' }), // 常亮的小燈(不會變)
    led: new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: true, name: 'ix:led' }), // 指示燈池:亮度用 instanceColor
  };
  return MATS;
}
// 有貼圖的材質(同一張貼圖共用一個材質,合併時視為一種材質)
const TMATS = new Map();
export function texMat(name, tex, { basic = false, rough = 0.7, transparent = false, alphaTest = 0 } = {}) {
  let m = TMATS.get(name);
  if (m) return m;
  m = basic ? new THREE.MeshBasicMaterial({ map: tex, toneMapped: true, transparent, alphaTest, name: 'ixt:' + name })
    : new THREE.MeshStandardMaterial({ map: tex, roughness: rough, metalness: 0, transparent, alphaTest, vertexColors: true, name: 'ixt:' + name });
  TMATS.set(name, m);
  return m;
}

// ---------- 實例池:同一種會動的零件 ----------
export class Pool {
  constructor(kit, name, model, mat, { shadow = false } = {}) {
    this.kit = kit; this.name = name; this.model = model; this.mat = mat; this.shadow = shadow;
    this.items = []; // { li, m: Matrix4, c: Color|null }
    this.meshes = new Map(); // li → InstancedMesh
  }
  add(li, m, c = null) { const i = this.items.length; this.items.push({ li, m: m.clone(), c: c ? col(c).clone() : null, k: -1 }); return i; }
  set(i, m) {
    const it = this.items[i];
    it.m.copy(m);
    const im = this.meshes.get(it.li);
    if (im) { im.setMatrixAt(it.k, it.m); im.instanceMatrix.needsUpdate = true; }
  }
  color(i, c) {
    const it = this.items[i];
    (it.c || (it.c = new THREE.Color())).copy(col(c));
    const im = this.meshes.get(it.li);
    if (im && im.instanceColor) { im.setColorAt(it.k, it.c); im.instanceColor.needsUpdate = true; }
  }
  build() {
    if (!this.items.length) return;
    const g = this.model.geometry();
    if (!g) return;
    const byLi = new Map();
    for (const it of this.items) { if (!byLi.has(it.li)) byLi.set(it.li, []); byLi.get(it.li).push(it); }
    for (const [li, list] of byLi) {
      const im = new THREE.InstancedMesh(g, this.mat, list.length);
      im.name = `ix-pool:${this.name}:${li}`;
      im.castShadow = this.shadow; im.receiveShadow = true;
      const anyC = list.some((it) => it.c);
      list.forEach((it, k) => { it.k = k; im.setMatrixAt(k, it.m); if (anyC) im.setColorAt(k, it.c || new THREE.Color(1, 1, 1)); });
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      im.computeBoundingSphere();
      im.frustumCulled = false; // 零件會動,包圍球不重算
      this.kit.group(li).add(im);
      this.meshes.set(li, im);
    }
  }
}

// ---------- 建構器 ----------
export function createKit({ root, levelGroups = null, levelOfY = null }) {
  const statics = new Map(); // li → Map(mat → [geo])
  const pools = new Map();
  const own = []; // 自己建的網格(dispose 用)
  const groups = new Map();
  const kit = {
    mats: mats(),
    group(li) {
      if (levelGroups && levelGroups[li]) return levelGroups[li];
      let g = groups.get(li);
      if (!g) { g = new THREE.Group(); g.name = 'ix-level-' + li; root.add(g); groups.set(li, g); }
      return g;
    },
    // 靜態:model 的零件經 matrix(世界)變換後收進該樓層的合併桶
    static(model, matrix, li) {
      let byMat = statics.get(li);
      if (!byMat) statics.set(li, (byMat = new Map()));
      for (const p of model.parts) {
        _m.multiplyMatrices(matrix, p.m);
        const list = byMat.get(p.mat) || [];
        list.push(bake(p, _m));
        byMat.set(p.mat, list);
      }
    },
    // 獨立網格(有自己的貼圖狀態或要整個移動的物件):每種材質一個子網格
    mesh(model, matrix, li, { shadow = false, name = 'ix-mesh' } = {}) {
      const o = new THREE.Group();
      o.name = name;
      for (const mat of model.mats()) {
        const m = new THREE.Mesh(model.geometry(mat), mat);
        m.castShadow = shadow && !mat.transparent; m.receiveShadow = true;
        o.add(m);
        own.push(m);
      }
      o.matrixAutoUpdate = true;
      matrix.decompose(o.position, o.quaternion, o.scale);
      kit.group(li).add(o);
      return o;
    },
    pool(name, make, mat, opt) { let p = pools.get(name); if (!p) { const m = new Model(); make(m); p = new Pool(kit, name, m, mat, opt); pools.set(name, p); } return p; },
    finish() {
      let n = 0;
      for (const [li, byMat] of statics) {
        for (const [mat, list] of byMat) {
          for (let i = 0; i < list.length; i += 300) {
            const g = mergeGeometries(list.slice(i, i + 300));
            if (!g) continue;
            g.computeBoundingSphere();
            const m = new THREE.Mesh(g, mat);
            m.name = `ix-static:${mat.name}:${li}`;
            m.castShadow = !mat.transparent && mat !== MATS.glow; m.receiveShadow = true;
            m.matrixAutoUpdate = false; m.updateMatrix();
            kit.group(li).add(m);
            own.push(m);
            n++;
          }
          for (const g of list) g.dispose();
        }
      }
      statics.clear();
      for (const p of pools.values()) { p.build(); for (const im of p.meshes.values()) own.push(im); }
      return n;
    },
    dispose() {
      for (const m of own) { m.parent?.remove(m); m.geometry?.dispose(); }
      own.length = 0;
      for (const g of groups.values()) root.remove(g);
      groups.clear(); pools.clear();
    },
    stats() { return { meshes: own.length, pools: [...pools.values()].map((p) => `${p.name}:${p.items.length}`) }; },
  };
  return kit;
}
