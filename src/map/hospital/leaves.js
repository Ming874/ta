import * as THREE from 'three';
import { Buckets } from './builder.js';

// 門扇:全部做成可轉動的實例(每層 × 每種材質一個 InstancedMesh;整層的門扇 ≈ 6~10 個 draw call,比每扇門各自一組網格少很多)。
// 每扇門有一個「代理」Object3D(不在場景裡):事件(src/map/hospital/events.js)與互動(src/interact/doors.js)只改
// proxy.rotation.y,update() 每幀比對角度,有變才重寫那扇門的實例矩陣(閒置時每幀只是一百多次數字比較)。
// 零件是單位方塊的實例(貼圖 UV 以門扇為單位;頂點色/磨損屬性由 Buckets 產生,材質與牆面同一套 surf())。
const _m = new THREE.Matrix4(), _b = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(), _y = new THREE.Vector3(0, 1, 0);

export function buildLeaves(K, list, partsOf) {
  const tmpl = new Map(); // 材質鍵 → { geometry, material }
  const template = (key) => {
    let t = tmpl.get(key);
    if (t) return t;
    const DB = new Buckets();
    DB.wear = 0.15; // 磨損 shader 用模型座標(實例不含 instanceMatrix):門扇只留輕微髒污,避免牆腳剝落的花紋
    DB.box(0, key, -0.5, -0.5, -0.5, 0.5, 0.5, 0.5);
    const g = new THREE.Group();
    const [mesh] = DB.build([g]);
    t = { geometry: mesh.geometry, material: mesh.material };
    tmpl.set(key, t);
    return t;
  };
  // 1) 每扇門的零件(門扇局部座標的矩陣)
  const count = new Map(); // `${li}|${key}` → 數量
  for (const d of list) {
    const { parts, t } = partsOf(d.style, d.lw, d.lh);
    d.t = t;
    d.parts = [];
    const add = (key, x0, y0, z0, x1, y1, z1) => {
      const local = new THREE.Matrix4().compose(_p.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2), _q.identity(), _s.set(x1 - x0, y1 - y0, z1 - z0));
      const ck = d.li + '|' + key;
      const k = count.get(ck) || 0;
      count.set(ck, k + 1);
      d.parts.push({ key, ck, k, local, im: null });
    };
    for (const [key, x0, y0, z0, x1, y1, z1] of parts) add(key, x0, y0, z0, x1, y1, z1);
    for (const [a0, b0, a1, b1] of parts.glass || []) add('glass_dark', a0, b0, -(t + 0.006) / 2, a1, b1, (t + 0.006) / 2);
  }
  // 2) InstancedMesh(加進該樓層的結構群組,跟著樓層可見性)
  const meshes = new Map();
  for (const [ck, n] of count) {
    const [li, key] = [Number(ck.slice(0, ck.indexOf('|'))), ck.slice(ck.indexOf('|') + 1)];
    const t = template(key);
    const im = new THREE.InstancedMesh(t.geometry, t.material, n);
    im.name = `L${li}:leaves:${key}`;
    im.castShadow = !t.material.transparent;
    im.receiveShadow = true;
    im.frustumCulled = false; // 門會轉,包圍球不重算(整層的門本來就分散各處)
    im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    (K.levelGroups[li] || K.levelGroups[0]).add(im);
    meshes.set(ck, im);
  }
  for (const d of list) for (const p of d.parts) p.im = meshes.get(p.ck);
  const write = (d) => {
    const ry = d.group.rotation.y;
    _q.setFromAxisAngle(_y, ry);
    _b.compose(_p.set(d.group.position.x, d.group.position.y, d.group.position.z), _q, _s.set(1, 1, 1));
    for (const p of d.parts) { _m.multiplyMatrices(_b, p.local); p.im.setMatrixAt(p.k, _m); p.im.instanceMatrix.needsUpdate = true; }
    d._ry = ry;
  };
  for (const d of list) write(d);
  const api = {
    list, meshes,
    // 每幀:角度有變的門才更新
    update() { for (let i = 0; i < list.length; i++) { const d = list[i]; if (d.group.rotation.y !== d._ry) write(d); } },
    write,
    dispose() { for (const im of meshes.values()) { im.parent?.remove(im); im.dispose?.(); } meshes.clear(); },
  };
  return api;
}
