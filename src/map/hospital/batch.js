import * as THREE from 'three';
import { ENC_MIN } from '../../mats/encode.js';

// [draws] 靜態批次:不會動的結構(牆/地板/天花板/收邊/燈罩)、合併後的道具區塊、靜態實例池(室內小雜物、戶外重複物件)
// 依「材質」各合成一個 BatchedMesh(WEBGL_multi_draw:一個材質一次 draw call),
// 幾何依區塊(src/map/hospital/vis.js:樓層 × 區域 × 12m 方塊)切成實例 → 每幀只開看得到的區塊:
//   PVS(2D 視線)× 樓層規則 × 道具顯示距離 × 主相機視錐(自己做,BatchedMesh 本身的逐實例剔除關掉 → 狀態沒變時零成本)
// 陰影:手電筒 pass 直接用主相機的可見集合(光源就在眼睛上,能投影到看得見之處的東西一定在視線上);
//       月光(靜態,偶爾才重畫)與遮雨深度圖(俯視相機)一律全部打開。
// 幾何已是世界座標,實例矩陣都是單位矩陣 → 自訂 shader(onBeforeCompile 用 modelMatrix 算世界座標的)照樣正確。

const _v = new THREE.Vector3(), _n = new THREE.Vector3(), _m3 = new THREE.Matrix3(), _box = new THREE.Box3(), _sph = new THREE.Sphere();
const _frustum = new THREE.Frustum(), _pm = new THREE.Matrix4();

class GrowF {
  constructor(n = 256) { this.a = new Float32Array(n); this.n = 0; }
  need(k) { if (this.n + k > this.a.length) { const b = new Float32Array(Math.max(this.a.length * 2, this.n + k)); b.set(this.a.subarray(0, this.n)); this.a = b; } }
  get view() { return this.a.subarray(0, this.n); }
}
class GrowU {
  constructor(n = 256) { this.a = new Uint32Array(n); this.n = 0; }
  need(k) { if (this.n + k > this.a.length) { const b = new Uint32Array(Math.max(this.a.length * 2, this.n + k)); b.set(this.a.subarray(0, this.n)); this.a = b; } }
  get view() { return this.a.subarray(0, this.n); }
}

let _remap = new Int32Array(0), _vl = new Int32Array(0);
function scratchRemap(n) { if (_remap.length < n) { _remap = new Int32Array(Math.max(n, _remap.length * 2)); _remap.fill(-1); } return _remap; }
function scratchList(n) { if (_vl.length < n) _vl = new Int32Array(Math.max(n, _vl.length * 2)); return _vl; }

// 一個實例的幾何(世界座標):position / normal / uv(+ color、aWear)
class Piece {
  constructor(spec) {
    this.spec = spec;
    this.p = new GrowF(); this.nm = new GrowF(); this.uv = new GrowF();
    this.c = spec.color ? new GrowF() : null;
    this.w = spec.wear ? new GrowF(64) : null;
    this.i = new GrowU();
    this.nv = 0;
  }
  // 加入 g 的頂點(全部,或 tris 指定的三角形用到的頂點)與索引;m:變換矩陣(null = 已是世界座標);color:乘上的顏色;
  // seed:表面編碼的擺放亂數位移(見 addInstanced)
  add(g, m, color, tris, seed = 0) {
    const A = g.attributes, P = A.position, Nn = A.normal, U = A.uv, C = A.color, Wr = A.aWear, ix = g.index ? g.index.array : null;
    const nT = ix ? ix.length / 3 : P.count / 3;
    const base = this.nv, nV = P.count;
    let remap = null, vl = null, cnt = 0;
    if (tris) { // 只處理這些三角形用到的頂點(共用的暫存表,用完把碰過的格子還原)
      remap = scratchRemap(nV);
      vl = scratchList(tris.length * 3);
      for (let t = 0; t < tris.length; t++) for (let k = 0; k < 3; k++) { const vi = ix ? ix[tris[t] * 3 + k] : tris[t] * 3 + k; if (remap[vi] < 0) { remap[vi] = cnt; vl[cnt++] = vi; } }
    } else cnt = nV;
    this.p.need(cnt * 3); this.nm.need(cnt * 3); this.uv.need(cnt * 2);
    if (this.c) this.c.need(cnt * 3);
    if (this.w) this.w.need(cnt);
    const pa = this.p.a, na = this.nm.a, ua = this.uv.a, ca = this.c ? this.c.a : null, wa = this.w ? this.w.a : null;
    const flat = (a, n) => a && !a.isInterleavedBufferAttribute && !a.normalized && a.itemSize === n && a.array instanceof Float32Array;
    const fp = flat(P, 3) ? P.array : null, fn = Nn && flat(Nn, 3) ? Nn.array : null, fu = U && flat(U, 2) ? U.array : null;
    const fc = C && !C.isInterleavedBufferAttribute && !C.normalized && C.array instanceof Float32Array ? C.array : null, cs = C ? C.itemSize : 3;
    const fw = Wr && flat(Wr, 1) ? Wr.array : null;
    let e0 = 1, e1 = 0, e2 = 0, e4 = 0, e5 = 1, e6 = 0, e8 = 0, e9 = 0, e10 = 1, e12 = 0, e13 = 0, e14 = 0;
    let n0 = 1, n1 = 0, n2 = 0, n3 = 0, n4 = 1, n5 = 0, n6 = 0, n7 = 0, n8 = 1;
    if (m) {
      const e = m.elements;
      e0 = e[0]; e1 = e[1]; e2 = e[2]; e4 = e[4]; e5 = e[5]; e6 = e[6]; e8 = e[8]; e9 = e[9]; e10 = e[10]; e12 = e[12]; e13 = e[13]; e14 = e[14];
      const q = _m3.getNormalMatrix(m).elements;
      n0 = q[0]; n1 = q[1]; n2 = q[2]; n3 = q[3]; n4 = q[4]; n5 = q[5]; n6 = q[6]; n7 = q[7]; n8 = q[8];
    }
    const cr = color ? color.r : 1, cg = color ? color.g : 1, cb = color ? color.b : 1;
    for (let j = 0; j < cnt; j++) {
      const vi = vl ? vl[j] : j;
      const d = base + j, d3 = d * 3, d2 = d * 2;
      let x, y, z;
      if (fp) { x = fp[vi * 3]; y = fp[vi * 3 + 1]; z = fp[vi * 3 + 2]; } else { x = P.getX(vi); y = P.getY(vi); z = P.getZ(vi); }
      pa[d3] = e0 * x + e4 * y + e8 * z + e12; pa[d3 + 1] = e1 * x + e5 * y + e9 * z + e13; pa[d3 + 2] = e2 * x + e6 * y + e10 * z + e14;
      let nx = 0, ny = 1, nz = 0;
      if (fn) { nx = fn[vi * 3]; ny = fn[vi * 3 + 1]; nz = fn[vi * 3 + 2]; } else if (Nn) { nx = Nn.getX(vi); ny = Nn.getY(vi); nz = Nn.getZ(vi); }
      if (m) {
        const tx = n0 * nx + n3 * ny + n6 * nz, ty = n1 * nx + n4 * ny + n7 * nz, tz = n2 * nx + n5 * ny + n8 * nz;
        const l = Math.hypot(tx, ty, tz) || 1;
        nx = tx / l; ny = ty / l; nz = tz / l;
      }
      na[d3] = nx; na[d3 + 1] = ny; na[d3 + 2] = nz;
      if (fu) { ua[d2] = fu[vi * 2]; ua[d2 + 1] = fu[vi * 2 + 1]; } else if (U) { ua[d2] = U.getX(vi); ua[d2 + 1] = U.getY(vi); } else { ua[d2] = 0; ua[d2 + 1] = 0; }
      if (seed && ua[d2] >= ENC_MIN && ua[d2 + 1] >= ENC_MIN) { // uv.y = (2^15 | 旗標<<13 | 亂數<<9 | 高) * 128 + v
        const hy = Math.floor(ua[d2 + 1] / 128), sd = (hy >> 9) & 15, nd = (sd + seed) & 15;
        ua[d2 + 1] += (nd - sd) * 512 * 128;
      }
      if (ca) {
        if (fc) { ca[d3] = fc[vi * cs] * cr; ca[d3 + 1] = fc[vi * cs + 1] * cg; ca[d3 + 2] = fc[vi * cs + 2] * cb; }
        else if (C) { ca[d3] = C.getX(vi) * cr; ca[d3 + 1] = C.getY(vi) * cg; ca[d3 + 2] = C.getZ(vi) * cb; }
        else { ca[d3] = cr; ca[d3 + 1] = cg; ca[d3 + 2] = cb; }
      }
      if (wa) wa[d] = fw ? fw[vi] : Wr ? Wr.getX(vi) : 0.5;
    }
    this.p.n += cnt * 3; this.nm.n += cnt * 3; this.uv.n += cnt * 2;
    if (this.c) this.c.n += cnt * 3;
    if (this.w) this.w.n += cnt;
    // 鏡像矩陣(行列式 < 0)要反轉三角形繞向,否則正反面顛倒
    const flip = m ? m.determinant() < 0 : false;
    const T = tris ? tris.length : nT;
    this.i.need(T * 3);
    const ia = this.i.a;
    let w = this.i.n;
    for (let t = 0; t < T; t++) {
      const tt = tris ? tris[t] : t;
      const a0 = ix ? ix[tt * 3] : tt * 3, a1 = ix ? ix[tt * 3 + 1] : tt * 3 + 1, a2 = ix ? ix[tt * 3 + 2] : tt * 3 + 2;
      const b0 = remap ? remap[a0] : a0, b1 = remap ? remap[a1] : a1, b2 = remap ? remap[a2] : a2;
      ia[w++] = base + b0;
      if (flip) { ia[w++] = base + b2; ia[w++] = base + b1; } else { ia[w++] = base + b1; ia[w++] = base + b2; }
    }
    this.i.n = w;
    this.nv += cnt;
    if (vl) for (let j = 0; j < cnt; j++) remap[vl[j]] = -1;
  }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.p.view.slice(), 3));
    g.setAttribute('normal', new THREE.BufferAttribute(this.nm.view.slice(), 3));
    g.setAttribute('uv', new THREE.BufferAttribute(this.uv.view.slice(), 2));
    if (this.c) g.setAttribute('color', new THREE.BufferAttribute(this.c.view.slice(), 3));
    if (this.w) g.setAttribute('aWear', new THREE.BufferAttribute(this.w.view.slice(), 1));
    g.setIndex(new THREE.BufferAttribute(this.i.view.slice(), 1));
    return g;
  }
}

// 能不能合進批次(材質):不透明、標準混合、沒有自訂 shader 材質
export function batchable(mat) {
  if (!mat || Array.isArray(mat) || !mat.isMaterial) return false;
  if (mat.transparent || mat.blending !== THREE.NormalBlending || mat.depthWrite === false || mat.wireframe || mat.visible === false) return false;
  if (mat.isShaderMaterial || mat.isRawShaderMaterial || mat.isPointsMaterial || mat.isLineBasicMaterial || mat.isSpriteMaterial) return false;
  return true;
}
export const plainObj = (o) => o.onBeforeRender === THREE.Object3D.prototype.onBeforeRender && o.frustumCulled !== false && !o.renderOrder && !o.isSkinnedMesh && !o.morphTargetInfluences && o.visible !== false;

// 世界座標的 xz 範圍(+ 樓層)→ 覆蓋的區塊組合 { k: 字串鍵, r: Int32Array };覆蓋太多格子時回傳 null(視為整層,不剔除)
// dropWalls:道具用 —— 只碰到牆格的部分不算(靠牆的櫃子不會因為牆另一側看得到牆就被畫)
const keyCache = new WeakMap();
const _ids = [];
function singleOf(cache, id) { const k = '' + id; let r = cache.get(k); if (!r) cache.set(k, (r = { k, r: Int32Array.of(id) })); return r; }
export function regionSet(vis, li, x0, z0, x1, z1, dropWalls) {
  let cache = keyCache.get(vis);
  if (!cache) keyCache.set(vis, (cache = new Map()));
  const C = 2;
  const c0 = Math.floor(x0 / C), c1 = Math.floor(x1 / C), r0 = Math.floor(z0 / C), r1 = Math.floor(z1 / C);
  if ((c1 - c0 + 1) * (r1 - r0 + 1) > 900) return null;
  if (c0 === c1 && r0 === r1 && !(dropWalls && vis.opaqueAt(li, c0, r0))) return singleOf(cache, vis.regionAtCell(li, c0, r0));
  _ids.length = 0;
  for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
    if (dropWalls && vis.opaqueAt(li, c, r)) continue;
    const id = vis.regionAtCell(li, c, r);
    if (!_ids.includes(id)) _ids.push(id);
  }
  if (!_ids.length) return singleOf(cache, vis.regionAtCell(li, Math.floor((x0 + x1) / 2 / C), Math.floor((z0 + z1) / 2 / C)));
  if (_ids.length === 1) return singleOf(cache, _ids[0]);
  _ids.sort((x, y) => x - y);
  const k = _ids.join(',');
  let r = cache.get(k);
  if (!r) cache.set(k, (r = { k, r: Int32Array.from(_ids) }));
  return r;
}

// 全部批次共用的「單位矩陣」貼圖:區塊實例的矩陣都是單位矩陣 → 每個 BatchedMesh 不需要自己的矩陣/索引貼圖。
// 共用之後連續畫好幾個批次時貼圖不必重新綁定(每個 draw 少 4 個 GL 呼叫),實例開關時也不必重新上傳索引貼圖
// (索引貼圖內容固定為 0 → 指到單位矩陣;three 照樣把可見清單寫進 image.data,但不上傳)。
// 注意:用了共用貼圖之後 getMatrixAt / setMatrixAt / computeBoundingSphere 不能再用(建構時已算好包圍球)
let SHARED = null;
function sharedTextures(n) {
  if (SHARED && SHARED.n >= n) return SHARED;
  let size = Math.ceil(Math.sqrt(n * 4) / 4) * 4;
  size = Math.max(size, 4);
  const md = new Float32Array(size * size * 4);
  for (let i = 0; i < (size * size) / 4; i++) { md[i * 16] = 1; md[i * 16 + 5] = 1; md[i * 16 + 10] = 1; md[i * 16 + 15] = 1; }
  const mat = new THREE.DataTexture(md, size, size, THREE.RGBAFormat, THREE.FloatType);
  mat.needsUpdate = true;
  const is = Math.ceil(Math.sqrt(n));
  const ind = new THREE.DataTexture(new Uint32Array(is * is), is, is, THREE.RedIntegerFormat, THREE.UnsignedIntType);
  ind.needsUpdate = true;
  Object.defineProperty(ind, 'needsUpdate', { configurable: true, get: () => false, set: () => {} });
  SHARED = { n: Math.min((size * size) / 4, is * is), mat, ind };
  return SHARED;
}

// 建構期間的快速複製(BatchedMesh.setGeometryAt 逐元素 setX/setComponent 太慢:幾百萬個索引要一秒以上)。
// 只用在預留空間 = 幾何大小、屬性型別一致(全部 Float32、索引陣列)的情況;建完就拿掉
function fastSetGeometryAt(geometryId, geometry) {
  const bg = this.geometry, gi = this._geometryInfo[geometryId];
  const vs = gi.vertexStart;
  gi.vertexCount = geometry.attributes.position.count;
  for (const name in bg.attributes) {
    const src = geometry.getAttribute(name), dst = bg.getAttribute(name);
    dst.array.set(src.array, vs * dst.itemSize);
    dst.needsUpdate = true;
  }
  const di = bg.getIndex(), si = geometry.getIndex(), da = di.array, sa = si.array, is = gi.indexStart;
  gi.indexCount = si.count;
  for (let i = 0; i < sa.length; i++) da[is + i] = vs + sa[i];
  di.needsUpdate = true;
  gi.start = gi.indexStart;
  gi.count = gi.indexCount;
  gi.boundingBox = geometry.boundingBox ? geometry.boundingBox.clone() : null;
  gi.boundingSphere = geometry.boundingSphere ? geometry.boundingSphere.clone() : null;
  this._visibilityChanged = true;
  return geometryId;
}

export function createBatcher({ L, vis }) {
  const groups = new Map(); // batchKey → { mat, cast, layers, spec, pieces: Map(regKey → { piece, regs, li, kind, far }) }
  const regionsOfRect = (li, x0, z0, x1, z1, dropWalls) => regionSet(vis, li, x0, z0, x1, z1, dropWalls);
  function group(mat, cast, layers, spec) {
    const k = mat.uuid + '|' + (cast ? 1 : 0) + '|' + layers + '|' + (spec.color ? 1 : 0) + (spec.wear ? 1 : 0);
    let gr = groups.get(k);
    if (!gr) groups.set(k, (gr = { mat, cast, layers, spec, pieces: new Map() }));
    return gr;
  }
  function piece(gr, li, regs, kind, far) {
    const key = li + '/' + kind + '/' + far + '/' + (regs ? regs.k : '*');
    let p = gr.pieces.get(key);
    if (!p) gr.pieces.set(key, (p = { piece: new Piece(gr.spec), regs: regs ? regs.r : null, li, kind, far }));
    return p.piece;
  }
  const stats = { meshes: 0, tris: 0, instanced: 0, inst: 0 };

  const api = {
    groups, stats,
    // 結構網格:逐三角形依「中心 + 法線外推 0.3m」所在的格子分區(牆面歸到它面向的房間)
    addStruct(mesh, li) {
      const g = mesh.geometry, P = g.attributes.position, Nn = g.attributes.normal, ix = g.index ? g.index.array : null;
      const nT = ix ? ix.length / 3 : P.count / 3;
      const spec = { color: !!g.attributes.color || !!mesh.material.vertexColors, wear: !!g.attributes.aWear };
      const gr = group(mesh.material, mesh.castShadow, mesh.layers.mask, spec);
      const byKey = new Map();
      const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3();
      mesh.updateMatrixWorld(true);
      const mw = mesh.matrixWorld, ident = mw.equals(new THREE.Matrix4());
      for (let t = 0; t < nT; t++) {
        const i0 = ix ? ix[t * 3] : t * 3, i1 = ix ? ix[t * 3 + 1] : t * 3 + 1, i2 = ix ? ix[t * 3 + 2] : t * 3 + 2;
        a.fromBufferAttribute(P, i0); b.fromBufferAttribute(P, i1); c.fromBufferAttribute(P, i2);
        if (!ident) { a.applyMatrix4(mw); b.applyMatrix4(mw); c.applyMatrix4(mw); }
        if (Nn) { n.fromBufferAttribute(Nn, i0); _n.fromBufferAttribute(Nn, i1); n.add(_n); _n.fromBufferAttribute(Nn, i2); n.add(_n); }
        else n.subVectors(b, a).cross(_n.subVectors(c, a));
        const nl = n.length();
        if (nl < 1e-9 || Math.abs(n.y) > 0.7 * nl) n.set(0, 0, 0); // 水平面(地板/天花板)不外推
        else { n.y = 0; n.normalize().multiplyScalar(0.3); } // 牆面:往它面向的那一側推 0.3m
        const e = 0.05;
        let x0 = Math.min(a.x, b.x, c.x) + n.x, x1 = Math.max(a.x, b.x, c.x) + n.x, z0 = Math.min(a.z, b.z, c.z) + n.z, z1 = Math.max(a.z, b.z, c.z) + n.z;
        if (x1 - x0 > 2 * e) { x0 += e; x1 -= e; }
        if (z1 - z0 > 2 * e) { z0 += e; z1 -= e; }
        const rk = regionsOfRect(li, x0, z0, x1, z1, false);
        const kk = rk ? rk.k : '*';
        let e2 = byKey.get(kk);
        if (!e2) byKey.set(kk, (e2 = { rk, tris: [] }));
        e2.tris.push(t);
      }
      for (const { rk, tris } of byKey.values()) piece(gr, li, rk, 'struct', 1).add(g, ident ? null : mw, null, Int32Array.from(tris));
      stats.meshes++; stats.tris += nT;
    },
    // 道具網格(已合併、世界座標或帶矩陣):整個物件依包圍盒分區(rk:已算好的區塊組合;undefined = 依包圍盒算)
    addProp(mesh, li, far = 1, rk = undefined) {
      const g = mesh.geometry;
      mesh.updateMatrixWorld(true);
      const spec = { color: !!g.attributes.color || !!mesh.material.vertexColors, wear: false };
      const gr = group(mesh.material, mesh.castShadow, mesh.layers.mask, spec);
      if (rk === undefined) {
        if (!g.boundingBox) g.computeBoundingBox();
        _box.copy(g.boundingBox).applyMatrix4(mesh.matrixWorld).expandByScalar(-0.1);
        rk = regionsOfRect(li, _box.min.x, _box.min.z, Math.max(_box.min.x, _box.max.x), Math.max(_box.min.z, _box.max.z), true);
      }
      const ident = mesh.matrixWorld.equals(new THREE.Matrix4());
      piece(gr, li, rk, 'prop', far).add(g, ident ? null : mesh.matrixWorld, null, null);
      stats.meshes++; stats.tris += (g.index ? g.index.count : g.attributes.position.count) / 3;
    },
    // 靜態實例池:每個實例烘進所在區塊(實例顏色 → 頂點色,材質換成開了 vertexColors 的複本)
    // seedShift:表面編碼(src/mats/encode.js)的擺放亂數依實例位置錯開 —— 原本 shader 用 instanceMatrix 的位置當亂數,
    // 烘成世界座標之後位置資訊沒了,改寫進 UV 的亂數欄位(同一種雜物不會每個都長一樣的細節)
    addInstanced(im, far = 1, vcMat = null, seedShift = false) {
      im.updateMatrixWorld(true);
      const g = im.geometry, m = new THREE.Matrix4(), col = new THREE.Color();
      if (!g.boundingBox) g.computeBoundingBox();
      const useCol = !!im.instanceColor;
      const mat = useCol ? vcMat(im.material) : im.material;
      const spec = { color: useCol || !!g.attributes.color || !!mat.vertexColors, wear: false };
      const gr = group(mat, im.castShadow, im.layers.mask, spec);
      for (let i = 0; i < im.count; i++) {
        im.getMatrixAt(i, m);
        m.premultiply(im.matrixWorld);
        if (Math.abs(m.elements[0]) + Math.abs(m.elements[5]) + Math.abs(m.elements[10]) < 1e-6) continue; // 縮成 0 的隱藏實例
        _box.copy(g.boundingBox).applyMatrix4(m);
        const li = Math.max(0, L.levelOfY(_box.min.y + 0.25));
        _box.expandByScalar(-0.05);
        const rk = regionsOfRect(li, _box.min.x, _box.min.z, Math.max(_box.min.x, _box.max.x), Math.max(_box.min.z, _box.max.z), true);
        if (useCol) im.getColorAt(i, col);
        const e = m.elements;
        const sh = seedShift ? Math.floor((((Math.sin(e[12] * 12.9898 + e[13] * 78.233 + e[14] * 37.719) * 43758.5453) % 1) + 1) % 1 * 16) : 0;
        piece(gr, li, rk, 'prop', far).add(g, m, useCol ? col : null, null, sh);
        stats.inst++;
      }
      stats.instanced++;
    },
    // 建立 BatchedMesh(每個 group 一個;實例 = 區塊)
    build(parent) {
      const out = [], insts = [];
      let maxInst = 0;
      for (const gr of groups.values()) maxInst = Math.max(maxInst, gr.pieces.size);
      for (const gr of groups.values()) {
        const list = [...gr.pieces.values()].filter((p) => p.piece.nv > 0);
        if (!list.length) continue;
        const geos = list.map((p) => p.piece.geometry());
        let nv = 0, ni = 0;
        for (const g of geos) { nv += g.attributes.position.count; ni += g.index.count; }
        const bm = new THREE.BatchedMesh(geos.length, nv, ni, gr.mat);
        bm.name = 'batch:' + (gr.mat.name || gr.mat.type);
        bm.perObjectFrustumCulled = false; // 自己做(每幀一次,不是每個 pass 一次)
        bm.sortObjects = false;
        bm.frustumCulled = false;
        bm.castShadow = gr.cast;
        bm.receiveShadow = true;
        bm.layers.mask = gr.layers;
        bm.matrixAutoUpdate = false;
        bm.userData.batch = true;
        bm.setGeometryAt = fastSetGeometryAt;
        geos.forEach((g, k) => {
          g.computeBoundingBox();
          g.computeBoundingSphere();
          const gid = bm.addGeometry(g);
          const iid = bm.addInstance(gid);
          const p = list[k];
          insts.push({ bm, id: iid, regs: p.regs, li: p.li, kind: p.kind, far: p.far, sphere: g.boundingSphere.clone(), on: true });
          g.dispose();
        });
        delete bm.setGeometryAt;
        bm.computeBoundingBox();
        bm.computeBoundingSphere();
        const sh = sharedTextures(Math.max(64, maxInst));
        bm._matricesTexture.dispose(); bm._matricesTexture = sh.mat;
        bm._indirectTexture.dispose(); bm._indirectTexture = sh.ind;
        parent.add(bm);
        bm.updateMatrix(); bm.updateMatrixWorld(true);
        out.push(bm);
      }
      groups.clear();
      return { meshes: out, insts };
    },
  };
  return api;
}

// 執行期:依可見區塊 / 樓層 / 距離 / 主相機視錐開關實例;BatchedMesh 沒有任何可見實例時整個隱藏(連 setProgram 都省掉)
export function createBatchView({ meshes, insts, vis, moon }) {
  const moonCam = moon ? moon.shadow.camera : null;
  const nR = vis.nR;
  const lvlOK = new Uint8Array(8), otherOK = new Uint8Array(8);
  const want = new Uint8Array(insts.length); // PVS × 樓層 × 距離(不含視錐)
  const byBM = new Map();
  for (const m of meshes) byBM.set(m, []);
  insts.forEach((it, i) => { it.idx = i; byBM.get(it.bm).push(it); });
  const visCnt = new Map();
  let allOn = false;
  // 月光陰影:這個 pass 全部實例都要畫(其他 pass 照舊)
  for (const bm of meshes) {
    const proto = THREE.BatchedMesh.prototype;
    bm.onBeforeShadow = function (r, o, cam, shCam, geo, dm, grp) {
      if (shCam === moonCam) {
        const info = this._instanceInfo;
        this._saved = this._saved || new Uint8Array(info.length);
        for (let i = 0; i < info.length; i++) { this._saved[i] = info[i].visible ? 1 : 0; info[i].visible = true; }
        this._visibilityChanged = true;
        this._moon = true;
      }
      proto.onBeforeShadow.call(this, r, o, cam, shCam, geo, dm, grp);
    };
    bm.onAfterShadow = function () {
      if (!this._moon) return;
      this._moon = false;
      const info = this._instanceInfo;
      for (let i = 0; i < info.length; i++) info[i].visible = this._saved[i] === 1;
      this._visibilityChanged = true;
    };
  }
  const api = {
    meshes, insts,
    // li:玩家樓層;vis:各樓層群組是否顯示(地下室規則);propVis:其他樓層的道具是否可能看得到;outdoor:玩家在戶外
    // ex/ey/ez:眼睛位置;far:道具顯示距離
    refresh(li, lvlVis, propVis, outdoor, ex, ey, ez, far) {
      for (let j = 0; j < lvlVis.length; j++) { lvlOK[j] = lvlVis[j] ? 1 : 0; otherOK[j] = propVis[j] ? 1 : 0; }
      const own = vis.own, col = vis.col, other = vis.other;
      for (let i = 0; i < insts.length; i++) {
        const it = insts[i];
        let ok = lvlOK[it.li] === 1;
        if (ok && it.regs) {
          const R = it.regs;
          ok = false;
          if (it.kind === 'struct') { for (let k = 0; k < R.length; k++) { const r = R[k]; if (own[r] || col[r] || other[r]) { ok = true; break; } } }
          else if (it.li === li) { for (let k = 0; k < R.length; k++) if (own[R[k]]) { ok = true; break; } }
          else if (otherOK[it.li]) { if (outdoor) ok = true; else for (let k = 0; k < R.length; k++) if (other[R[k]] || own[R[k]]) { ok = true; break; } }
        } else if (ok && it.kind === 'prop' && it.li !== li) ok = otherOK[it.li] === 1;
        if (ok && it.kind === 'prop') {
          const s = it.sphere, c = s.center, d = Math.hypot(c.x - ex, c.y - ey, c.z - ez) - s.radius;
          ok = d < far * it.far;
        }
        want[i] = ok ? 1 : 0;
      }
    },
    // 每次主相機渲染前(scene.onBeforeRender):視錐剔除 + 套用
    cull(camera) {
      allOn = false;
      _pm.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      _frustum.setFromProjectionMatrix(_pm, camera.coordinateSystem, camera.reversedDepth);
      for (const bm of meshes) visCnt.set(bm, 0);
      for (let i = 0; i < insts.length; i++) {
        const it = insts[i];
        const on = want[i] === 1 && _frustum.intersectsSphere(it.sphere);
        if (on !== it.on) { it.on = on; it.bm.setVisibleAt(it.id, on); }
        if (on) visCnt.set(it.bm, visCnt.get(it.bm) + 1);
      }
      const mo = !!moon && moon.castShadow && (moon.shadow.needsUpdate || moon.shadow.autoUpdate);
      for (const bm of meshes) bm.visible = visCnt.get(bm) > 0 || (mo && bm.castShadow);
    },
    // 其他相機(遮雨深度圖、離屏預熱…):全部打開
    showAll() {
      if (allOn) return;
      allOn = true;
      for (const it of insts) if (!it.on) { it.on = true; it.bm.setVisibleAt(it.id, true); }
      for (const bm of meshes) bm.visible = true;
    },
    visibleCount() { let n = 0; for (const it of insts) if (it.on) n++; return n; },
    drawable() { let n = 0; for (const bm of meshes) if (bm.visible) n++; return n; },
  };
  return api;
}
