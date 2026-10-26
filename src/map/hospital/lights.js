import * as THREE from 'three';
import { prng, hashStr } from './paint.js';

// 燈具:依區域 light 類型擺放(天花日光燈/故障閃爍/冷白/手術燈/紅色緊急燈/裸燈泡/鈉燈/夜燈/螢幕光/暖光),
// 燈罩外殼合併成靜態網格,發光部分用 InstancedMesh(每幀更新亮度 → 閃爍/熄滅),再加加法混合的光暈。
// 真正的 PointLight 只有固定 N 盞(光源池),每幀挑玩家附近最重要的燈具套上去(數量固定 → 不重編 shader)。
const KINDS = {
  fluoro: { color: 0xdcebe2, cd: 9, dist: 9, glow: 1.2, shape: 'tube', gain: 2.2 },
  fluoro_dying: { color: 0xd4e6d2, cd: 8, dist: 8, glow: 1.1, shape: 'tube', gain: 2.0 },
  fluoro_cold: { color: 0xe2eeff, cd: 10, dist: 9, glow: 1.2, shape: 'tube', gain: 2.4 },
  warm: { color: 0xffd6a0, cd: 14, dist: 10, glow: 1.3, shape: 'tube', gain: 2.2 },
  surgical: { color: 0xfff4e6, cd: 28, dist: 8, glow: 1.4, shape: 'disc', gain: 3.2 },
  emergency: { color: 0xff2a18, cd: 4, dist: 6.5, glow: 0.8, shape: 'lens', gain: 3.0 },
  beacon: { color: 0xff3020, cd: 9, dist: 10, glow: 1.4, shape: 'lens', gain: 3.5 },
  bare_bulb: { color: 0xffc27a, cd: 5, dist: 7, glow: 0.8, shape: 'bulb', gain: 4.0 },
  sodium: { color: 0xff9440, cd: 12, dist: 11, glow: 1.4, shape: 'pack', gain: 2.6 },
  nightlight: { color: 0xff9ab4, cd: 1.1, dist: 4, glow: 0.4, shape: 'small', gain: 2.0 },
  monitor: { color: 0x86c2e0, cd: 2, dist: 5, glow: 0.0, shape: null, gain: 1 },
  candle: { color: 0xffa040, cd: 1.8, dist: 5.5, glow: 0.3, shape: null, gain: 1 },
  lamp: { color: 0xffc888, cd: 4, dist: 6.5, glow: 0.5, shape: null, gain: 1 },
  fire: { color: 0xff6a20, cd: 14, dist: 10, glow: 0.0, shape: null, gain: 1 },
  street: { color: 0xff9a48, cd: 30, dist: 22, glow: 2.0, shape: null, gain: 1 },
};
// 每種燈的狀態機率:[常亮, 閃爍, 熄滅]
const STATES = {
  fluoro: [0.82, 0.12, 0.06], fluoro_dying: [0.32, 0.4, 0.28], fluoro_cold: [0.88, 0.1, 0.02], warm: [1, 0, 0], surgical: [0.7, 0.3, 0],
  emergency: [0.85, 0.15, 0], bare_bulb: [0.62, 0.22, 0.16], sodium: [0.85, 0.15, 0], nightlight: [0.9, 0.1, 0],
};
const MODE = { fluoro: 'tube', fluoro_dying: 'tube', fluoro_cold: 'tube', warm: 'steady', surgical: 'tube', emergency: 'pulse', beacon: 'beacon', bare_bulb: 'sway', sodium: 'buzz', nightlight: 'steady', monitor: 'screen', candle: 'candle', lamp: 'steady', fire: 'fire', street: 'buzz' };

// 閃爍函數(確定性;JS 與發光件共用)
const hash = (n) => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };
export function flickerValue(f, t) {
  if (f.state === 2) return 0;
  const p = f.phase;
  switch (f.mode) {
    case 'tube': {
      if (f.state === 0) return 1;
      const burst = hash(Math.floor(t * 0.35 + p)) < 0.35; // 一陣一陣的故障
      if (burst) { const k = hash(Math.floor(t * 18 + p * 7)); return k < 0.45 ? 0.04 : k < 0.6 ? 0.45 : 1; }
      return hash(Math.floor(t * 9 + p * 3)) < 0.05 ? 0.1 : 1;
    }
    case 'pulse': return 0.35 + 0.65 * Math.pow(Math.abs(Math.sin(t * 1.9 + p)), 2);
    case 'beacon': { const a = (t * 3.4 + p) % (Math.PI * 2); return 0.15 + 0.85 * Math.pow(Math.max(0, Math.cos(a)), 6); }
    case 'buzz': return f.state === 1 ? (hash(Math.floor(t * 6 + p)) < 0.15 ? 0.3 : 0.92 + 0.08 * Math.sin(t * 47)) : 0.93 + 0.07 * Math.sin(t * 5.1 + p) * Math.sin(t * 1.7);
    case 'candle': return 0.78 + 0.14 * Math.sin(t * 9.1 + p) * Math.sin(t * 5.3 + p * 2) + 0.08 * Math.sin(t * 23 + p);
    case 'fire': return 0.7 + 0.2 * Math.sin(t * 7.3 + p) * Math.sin(t * 3.1) + 0.1 * Math.sin(t * 17 + p * 3);
    case 'screen': return 0.75 + 0.25 * hash(Math.floor(t * 4 + p));
    case 'sway': return f.state === 1 ? (hash(Math.floor(t * 11 + p)) < 0.25 ? 0.15 : 1) : 1;
    default: return 1;
  }
}

const tubeGeo = new THREE.BoxGeometry(1.18, 0.02, 0.26);
const discGeo = new THREE.CylinderGeometry(0.22, 0.22, 0.03, 18);
const bulbGeo = new THREE.SphereGeometry(0.055, 10, 8);
const lensGeo = new THREE.BoxGeometry(0.26, 0.09, 0.03);
const packGeo = new THREE.BoxGeometry(0.2, 0.14, 0.03);
const smallGeo = new THREE.BoxGeometry(0.07, 0.05, 0.015);
const SHAPES = { tube: tubeGeo, disc: discGeo, bulb: bulbGeo, lens: lensGeo, pack: packGeo, small: smallGeo };

// 光暈 billboard(加法混合、自己算霧)
const glowMat = new THREE.ShaderMaterial({
  uniforms: { uFogDensity: { value: 0.03 } },
  vertexShader: `
    uniform float uFogDensity;
    varying vec3 vCol; varying vec2 vUv; varying float vFog;
    void main() {
      vec4 mv = modelViewMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
      float s = length(instanceMatrix[0].xyz);
      float d = length(mv.xyz);
      mv.xyz += normalize(-mv.xyz) * min(0.45, d * 0.4); // 往鏡頭拉近一點,避免被天花板切掉
      mv.xy += position.xy * s;
      gl_Position = projectionMatrix * mv;
      vCol = instanceColor; vUv = uv;
      float fd = uFogDensity * d;
      vFog = exp(-fd * fd) * smoothstep(0.3, 1.6, d);
    }`,
  fragmentShader: `
    varying vec3 vCol; varying vec2 vUv; varying float vFog;
    void main() {
      vec2 p = vUv - 0.5;
      float r2 = dot(p, p) * 4.0;
      float g = exp(-r2 * 5.5) * 0.85 + exp(-r2 * 28.0) * 0.6;
      gl_FragColor = vec4(vCol * g * vFog, 1.0);
    }`,
  transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
});

export const setGlowFog = (d) => { glowMat.uniforms.uFogDensity.value = d; };
export function buildLights(K, { root, propLights = [], poolSize = 8 }) {
  const { L, B } = K;
  const fixtures = [];
  const near = (li, x, z, d) => fixtures.some((f) => f.li === li && (f.x - x) ** 2 + (f.z - z) ** 2 < d * d);
  const add = (spec) => {
    const k = KINDS[spec.kind] || KINDS.fluoro;
    const R = spec.R;
    const st = STATES[spec.kind] || [1, 0, 0];
    const roll = R ? R() : 0;
    const state = spec.state ?? (roll < st[0] ? 0 : roll < st[0] + st[1] ? 1 : 2);
    const f = {
      x: spec.x, y: spec.y, z: spec.z, li: spec.li, zone: spec.zone || null, kind: spec.kind, mode: spec.mode || MODE[spec.kind] || 'steady',
      color: new THREE.Color(spec.color ?? k.color), cd: spec.cd ?? k.cd, dist: spec.dist ?? k.dist, glow: spec.glow ?? k.glow, shape: spec.shape === undefined ? k.shape : spec.shape,
      gain: k.gain, state, phase: R ? R() * 100 : Math.random() * 100, ov: 1, cur: 1, inst: -1, glowIdx: -1, axis: spec.axis || 'x', hang: spec.hang || 0,
      sway: spec.kind === 'bare_bulb' ? (R ? R.r(0.03, 0.09) : 0.05) : 0, ox: 0, oz: 0, prop: !!spec.prop,
    };
    fixtures.push(f);
    return f;
  };
  const isOpen = (li, c, r) => { const ch = L.charAt(li, c, r); return !'#WE=_o%|X'.includes(ch) && !'^v<>'.includes(ch); };

  // ---- 依區域擺天花燈 ----
  for (const zone of L.zones) {
    const li = zone.levelIndex, lt = zone.light;
    if (!lt || lt === 'moon' || lt === 'none' || lt === 'candle' || lt === 'lamp' || lt === 'fire' || lt === 'monitor') continue;
    const R = prng(hashStr('light' + zone.id));
    const outdoorZone = ['alley', 'plaza', 'parking', 'ambulance_bay', 'playground', 'cemetery', 'yard', 'courtyard', 'rooftop', 'fire_escape'].includes(zone.theme);
    if (outdoorZone) continue; // 戶外燈另外處理(外牆壁燈/路燈由道具)
    const ceilKinds = ['fluoro', 'fluoro_dying', 'fluoro_cold', 'warm', 'surgical', 'bare_bulb'];
    if (ceilKinds.includes(lt)) {
      const corridor = zone.theme === 'corridor';
      const sp = corridor ? 6.2 : lt === 'bare_bulb' ? 5.5 : 4.4;
      for (const [c0, r0, c1, r1] of zone.rects) {
        const w = (c1 - c0 + 1) * 2, h = (r1 - r0 + 1) * 2, alongX = w >= h;
        const len = Math.max(w, h), wid = Math.min(w, h);
        const nA = Math.max(1, Math.round(len / sp)), nB = wid >= 7.5 ? Math.max(1, Math.round(wid / 5)) : 1;
        for (let i = 0; i < nA; i++) for (let j = 0; j < nB; j++) {
          const along = ((i + 0.5) * len) / nA, across = ((j + 0.5) * wid) / nB;
          const x = alongX ? c0 * 2 + along : c0 * 2 + across, z = alongX ? r0 * 2 + across : r0 * 2 + along;
          const c = Math.min(c1, Math.floor(x / 2)), r = Math.min(r1, Math.floor(z / 2));
          if (!isOpen(li, c, r)) continue;
          const yC = L.ceilY(li, c, r);
          if (!Number.isFinite(yC) || yC - L.levels[li].y > 5) continue;
          if (near(li, x, z, sp * 0.62)) continue;
          let kind = lt;
          if (lt === 'surgical' && !(i === Math.floor(nA / 2) && j === 0)) kind = 'fluoro_cold';
          const hang = (kind === 'fluoro_dying' && R() < 0.22) ? R.r(0.35, 0.75) : 0;
          add({ x, y: yC - (kind === 'bare_bulb' ? R.r(0.45, 0.8) : kind === 'surgical' ? 1.05 : 0.05), z, li, zone, kind, R, axis: alongX ? 'x' : 'z', hang, yC });
        }
      }
    }
    // 牆燈:紅色緊急燈(樓梯間/急診)、鈉燈(地下工業區)、夜燈(兒童區)
    if (lt === 'emergency' || lt === 'sodium' || lt === 'nightlight') {
      const faces = K.faces.filter((f) => f.zone === zone && f.kind === 'room' && f.li === li && f.a1 - f.a0 >= 1.9);
      const step = lt === 'nightlight' ? 7 : lt === 'emergency' ? 7.5 : 8.5;
      let acc = R() * step;
      for (const f of faces) {
        for (let a = f.a0 + 0.8; a < f.a1 - 0.6; a += 0.5) {
          acc += 0.5;
          if (acc < step) continue;
          acc = 0;
          const isH = f.dir === 'N' || f.dir === 'S', off = 0.07;
          const x = isH ? a : f.fixed + f.nx * off, z = isH ? f.fixed + f.nz * off : a;
          const yy = f.y + (lt === 'nightlight' ? 0.32 : lt === 'emergency' ? 2.45 : 2.75);
          if (yy > f.y + f.top - 0.15) continue;
          add({ x, y: yy, z, li, zone, kind: lt, R, axis: isH ? 'x' : 'z', wall: f, color: lt === 'nightlight' && R() < 0.4 ? 0x9ab4ff : undefined });
        }
      }
    }
  }
  // ---- 戶外:外牆鈉燈(出入口上方)與急診旋轉警示燈 ----
  for (const d of K.doorList || []) {
    if (!(d.outA || d.outB) || L.levels[d.li].id !== '1F') continue;
    const R = prng(hashStr(`ext${d.c},${d.r}`));
    if (R() < 0.25) continue;
    const out = d.outA ? -1 : 1;
    const x = d.axis === 'z' ? d.c * 2 + 1 : d.c * 2 + 1 + out * 1.07, z = d.axis === 'z' ? d.r * 2 + 1 + out * 1.07 : d.r * 2 + 1;
    const er = (d.za?.theme === 'er' || d.zb?.theme === 'er');
    add({ x, y: 3.15, z, li: d.li, zone: null, kind: er ? 'beacon' : 'sodium', R, axis: d.axis === 'z' ? 'x' : 'z', ext: true });
  }
  // ---- 道具登記的燈(蠟燭、檯燈、路燈…) ----
  for (const p of propLights) {
    const li = L.levelOfY(p.y - 0.3);
    const kind = KINDS[p.kind] ? p.kind : 'lamp';
    const f = add({ x: p.x, y: p.y, z: p.z, li, zone: p.zone ? L.zones.find((z) => z.id === p.zone) || null : L.zoneAt(li, Math.floor(p.x / 2), Math.floor(p.z / 2)), kind, color: p.color, cd: p.intensity, dist: p.distance, shape: null, state: 0, mode: p.flicker > 0.5 ? 'candle' : MODE[kind] || 'steady', prop: true });
    f.glow = p.glow ?? (kind === 'candle' ? 0.3 : kind === 'street' ? 2.0 : 0.5);
  }
  // ---- 道具沒放燈的燭光/檯燈/爐火/螢幕區:補一盞 ----
  for (const zone of L.zones) {
    const lt = zone.light;
    if (!['candle', 'lamp', 'fire', 'monitor'].includes(lt)) continue;
    if (fixtures.some((f) => f.zone === zone)) continue;
    const li = zone.levelIndex, [c0, r0, c1, r1] = zone.rects[0];
    const R = prng(hashStr('fb' + zone.id));
    const n = lt === 'candle' ? Math.min(4, 1 + ((c1 - c0 + r1 - r0) / 4) | 0) : 1;
    for (let i = 0; i < n; i++) {
      const c = R.i(c0, c1), r = R.i(r0, r1);
      if (!isOpen(li, c, r)) continue;
      add({ x: c * 2 + 1 + R.r(-0.5, 0.5), y: L.levels[li].y + (lt === 'fire' ? 0.8 : lt === 'monitor' ? 1.1 : 1.0), z: r * 2 + 1 + R.r(-0.5, 0.5), li, zone, kind: lt, R, shape: null, state: 0 });
    }
  }

  // ---- 燈罩外殼(靜態合併) + 發光件(InstancedMesh) ----
  const byShape = {};
  for (const f of fixtures) {
    const k = KINDS[f.kind] || KINDS.fluoro;
    if (!f.shape) continue;
    (byShape[f.shape] ||= []).push(f);
    const li = f.li;
    if (f.shape === 'tube') {
      const [sx, sz] = f.axis === 'x' ? [1.32, 0.4] : [0.4, 1.32];
      if (f.hang) { // 一端垂下的燈管
        const ang = Math.asin(Math.min(0.9, f.hang / 1.3));
        f.tilt = ang;
        housing(B, li, 'trim_white', f.x, f.y - f.hang / 2, f.z, sx, 0.07, sz, f.axis, ang);
        f.y -= f.hang / 2 + 0.05;
        B.box(li, 'trim_black', f.x - 0.006 + (f.axis === 'x' ? -0.6 : 0), f.y + f.hang / 2, f.z - 0.006 + (f.axis === 'z' ? -0.6 : 0), f.x + 0.006 + (f.axis === 'x' ? -0.6 : 0), f.y + f.hang + 0.1, f.z + 0.006 + (f.axis === 'z' ? -0.6 : 0), {});
      } else {
        B.box(li, 'trim_white', f.x - sx / 2, f.y - 0.02, f.z - sz / 2, f.x + sx / 2, f.y + 0.05, f.z + sz / 2, {});
        f.y -= 0.03;
      }
    } else if (f.shape === 'disc') { // 手術燈:吊臂 + 三個燈頭
      B.box(li, 'trim_white', f.x - 0.04, f.y + 0.1, f.z - 0.04, f.x + 0.04, f.y + 1.05, f.z + 0.04, {});
      B.box(li, 'trim_white', f.x - 0.45, f.y + 0.05, f.z - 0.05, f.x + 0.45, f.y + 0.13, f.z + 0.05, {});
      for (const dx of [-0.42, 0, 0.42]) {
        const g = new THREE.CylinderGeometry(0.3, 0.24, 0.16, 18);
        const m = new THREE.Matrix4().makeTranslation(f.x + dx, f.y, f.z);
        B.geo(li, 'trim_white', g, m);
      }
      f.extra = [-0.42, 0.42];
      f.y -= 0.09;
    } else if (f.shape === 'bulb') {
      const top = f.yC ?? f.y + 0.7;
      B.box(li, 'trim_black', f.x - 0.005, f.y + 0.05, f.z - 0.005, f.x + 0.005, top, f.z + 0.005, {});
      B.box(li, 'trim_dark', f.x - 0.025, f.y + 0.04, f.z - 0.025, f.x + 0.025, f.y + 0.1, f.z + 0.025, {});
    } else if (f.shape === 'lens' || f.shape === 'pack' || f.shape === 'small') {
      const ax = f.axis === 'x', w = f.shape === 'small' ? 0.1 : f.shape === 'lens' ? 0.34 : 0.3, hh = f.shape === 'small' ? 0.08 : 0.2;
      const back = f.wall ? -0.07 : -0.06;
      const nx = f.wall ? f.wall.nx : 0, nz = f.wall ? f.wall.nz : 0;
      const bx0 = f.x + nx * back, bz0 = f.z + nz * back;
      B.box(li, f.shape === 'pack' ? 'trim_dark' : 'trim_white', Math.min(bx0, f.x) - (ax ? w / 2 : 0.0), f.y - hh / 2, Math.min(bz0, f.z) - (ax ? 0 : w / 2), Math.max(bx0, f.x) + (ax ? w / 2 : 0), f.y + hh / 2, Math.max(bz0, f.z) + (ax ? 0 : w / 2), {});
    }
  }
  const emissive = [];
  for (const [shape, list] of Object.entries(byShape)) {
    const n = list.length * (shape === 'disc' ? 3 : 1);
    const im = new THREE.InstancedMesh(SHAPES[shape], new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: true }), n);
    im.name = 'fixtures-' + shape;
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), s = new THREE.Vector3(1, 1, 1), p = new THREE.Vector3();
    let i = 0;
    for (const f of list) {
      const rotY = f.axis === 'z' ? Math.PI / 2 : 0;
      const parts = shape === 'disc' ? [0, ...f.extra] : [0];
      f.inst = { mesh: im, i0: i, n: parts.length };
      for (const dx of parts) {
        e.set(f.tilt ? (f.axis === 'z' ? f.tilt : 0) : 0, rotY, f.tilt && f.axis === 'x' ? f.tilt : 0);
        if (f.shape === 'lens' || f.shape === 'pack' || f.shape === 'small') e.set(0, f.wall ? Math.atan2(f.wall.nx, f.wall.nz) : rotY, 0);
        q.setFromEuler(e);
        m4.compose(p.set(f.x + dx, f.y, f.z), q, s);
        im.setMatrixAt(i, m4);
        im.setColorAt(i, f.color);
        i++;
      }
    }
    im.instanceMatrix.needsUpdate = true;
    im.frustumCulled = false;
    im.castShadow = false;
    root.add(im);
    emissive.push(im);
  }
  // 光暈
  const glowList = fixtures.filter((f) => f.glow > 0);
  const glow = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), glowMat, Math.max(1, glowList.length));
  glow.name = 'fixture-glow';
  glow.frustumCulled = false;
  glow.renderOrder = 5;
  {
    const m4 = new THREE.Matrix4(), c = new THREE.Color();
    glowList.forEach((f, i) => { f.glowIdx = i; m4.makeScale(f.glow, f.glow, f.glow).setPosition(f.x, f.y - 0.06, f.z); glow.setMatrixAt(i, m4); glow.setColorAt(i, c.copy(f.color).multiplyScalar(0.25)); });
    glow.count = glowList.length;
  }
  root.add(glow);

  // ---- 光源池 ----
  const pool = [];
  const makePool = (n) => {
    while (pool.length < n) {
      const pl = new THREE.PointLight(0xffffff, 0, 8, 2);
      pl.castShadow = false;
      root.add(pl);
      pool.push({ light: pl, f: null, fade: 0 });
    }
    while (pool.length > n) { const p = pool.pop(); root.remove(p.light); p.light.dispose(); }
  };
  makePool(poolSize);

  const nF = fixtures.length;
  const score = new Float32Array(nF), want = new Int32Array(64);
  const tmpC = new THREE.Color();
  const _m4 = new THREE.Matrix4();
  // 2D 視線(牆擋光):在玩家樓層的格子上走 DDA
  const blocked = (li, x0, z0, x1, z1) => {
    let c = Math.floor(x0 / 2), r = Math.floor(z0 / 2);
    const c1 = Math.floor(x1 / 2), r1 = Math.floor(z1 / 2);
    const dx = x1 - x0, dz = z1 - z0;
    const sx = Math.sign(dx), sz = Math.sign(dz);
    const tdx = dx !== 0 ? Math.abs(2 / dx) : 1e9, tdz = dz !== 0 ? Math.abs(2 / dz) : 1e9;
    let tx = dx !== 0 ? ((sx > 0 ? (c + 1) * 2 - x0 : x0 - c * 2) / Math.abs(dx)) : 1e9;
    let tz = dz !== 0 ? ((sz > 0 ? (r + 1) * 2 - z0 : z0 - r * 2) / Math.abs(dz)) : 1e9;
    for (let k = 0; k < 40; k++) {
      if (c === c1 && r === r1) return false;
      if (tx < tz) { c += sx; tx += tdx; } else { r += sz; tz += tdz; }
      const ch = L.charAt(li, c, r);
      if ((ch === '#' || ch === 'E') && !(c === c1 && r === r1)) return true;
    }
    return false;
  };
  let lastPick = -1;
  const api = {
    fixtures, pool, emissive, glow,
    setPoolSize(n) { makePool(Math.max(0, Math.min(16, n | 0))); },
    update(t, dt, px, py, pz, fx, fz, playerLi, visibleLevels) {
      // 1) 每個燈具目前的亮度(閃爍 × 事件覆寫)
      for (let i = 0; i < nF; i++) {
        const f = fixtures[i];
        let v = flickerValue(f, t) * f.ov;
        f.cur = v;
        if (f.sway) { f.ox = Math.sin(t * 1.3 + f.phase) * f.sway; f.oz = Math.cos(t * 1.1 + f.phase * 0.7) * f.sway * 0.7; }
      }
      // 2) 發光件與光暈
      for (let i = 0; i < nF; i++) {
        const f = fixtures[i];
        if (f.inst !== -1) {
          tmpC.copy(f.color).multiplyScalar(f.state === 2 ? 0.06 : 0.08 + f.cur * f.gain);
          for (let k = 0; k < f.inst.n; k++) f.inst.mesh.setColorAt(f.inst.i0 + k, tmpC);
          if (f.sway && f.inst.n === 1) { _m4.makeTranslation(f.x + f.ox, f.y, f.z + f.oz); f.inst.mesh.setMatrixAt(f.inst.i0, _m4); f.inst.mesh.instanceMatrix.needsUpdate = true; }
        }
        if (f.glowIdx >= 0) {
          tmpC.copy(f.color).multiplyScalar(f.cur * 0.32 * (f.kind === 'candle' ? 1.6 : 1));
          glow.setColorAt(f.glowIdx, tmpC);
          if (f.sway) { _m4.makeScale(f.glow, f.glow, f.glow).setPosition(f.x + f.ox, f.y - 0.06, f.z + f.oz); glow.setMatrixAt(f.glowIdx, _m4); glow.instanceMatrix.needsUpdate = true; }
        }
      }
      for (const im of emissive) if (im.instanceColor) im.instanceColor.needsUpdate = true;
      if (glow.instanceColor) glow.instanceColor.needsUpdate = true;
      // 3) 挑燈(依距離、樓層、視線、朝向;已在用的燈加分避免跳動)
      const nW = Math.min(want.length, pool.length);
      let cnt = 0;
      for (let i = 0; i < nF; i++) {
        const f = fixtures[i];
        score[i] = 0;
        if (f.cur < 0.02 || !visibleLevels[f.li]) continue;
        const dx = f.x - px, dz = f.z - pz, dy = f.y - py;
        const d2 = dx * dx + dz * dz + dy * dy * 2.5;
        if (d2 > 900) continue;
        let s = (f.cd * f.cur) / (d2 + 6);
        const dl = Math.abs(f.li - playerLi);
        if (dl === 1) s *= 0.3; else if (dl > 1) s *= 0.05;
        const dot = (dx * fx + dz * fz) / (Math.sqrt(dx * dx + dz * dz) + 0.01);
        s *= dot > 0.25 ? 1.3 : dot < -0.3 ? 0.7 : 1;
        if (f.pooled) s *= 1.35;
        score[i] = s;
        cnt++;
      }
      // 取前 nW(簡單選擇;nF 小)
      let picked = 0;
      for (let k = 0; k < nW + 6 && picked < nW; k++) {
        let bi = -1, bs = 0;
        for (let i = 0; i < nF; i++) if (score[i] > bs) { bs = score[i]; bi = i; }
        if (bi < 0) break;
        score[bi] = -1;
        const f = fixtures[bi];
        if (f.li === playerLi && !f.ext && blocked(playerLi, px, pz, f.x, f.z) && ((f.x - px) ** 2 + (f.z - pz) ** 2) > 9) { if (k < nW + 5) continue; }
        want[picked++] = bi;
      }
      // 4) 指派(保留已在的,換掉沒被選上的)
      const nP = pool.length;
      for (let j = 0; j < nP; j++) pool[j].keep = false;
      for (let i = 0; i < nF; i++) fixtures[i].pooled = false;
      for (let k = 0; k < picked; k++) {
        const f = fixtures[want[k]];
        for (let j = 0; j < nP; j++) if (pool[j].f === f) { pool[j].keep = true; f.pooled = true; break; }
      }
      for (let k = 0; k < picked; k++) {
        const f = fixtures[want[k]];
        if (f.pooled) continue;
        for (let j = 0; j < nP; j++) { const pl = pool[j]; if (pl.keep) continue; pl.f = f; pl.keep = true; pl.fade = 0; f.pooled = true; break; }
      }
      for (const pl of pool) {
        const L2 = pl.light;
        if (!pl.keep || !pl.f) { pl.fade = Math.max(0, pl.fade - dt * 5); L2.intensity *= pl.fade; if (pl.fade <= 0) { pl.f = null; L2.intensity = 0; } continue; }
        const f = pl.f;
        pl.fade = Math.min(1, pl.fade + dt * 4);
        L2.color.copy(f.color);
        L2.distance = f.dist;
        L2.decay = 2;
        L2.position.set(f.x + f.ox, f.y - (f.shape === 'tube' ? 0.25 : f.shape === 'disc' ? 0.2 : 0), f.z + f.oz);
        L2.intensity = f.cd * f.cur * pl.fade;
      }
      lastPick = picked;
    },
    get picked() { return lastPick; },
    // 事件用:找某區域/範圍內的燈具
    find(pred) { return fixtures.filter(pred); },
  };
  return api;
}

// 傾斜的燈罩(一端掉下來)
function housing(B, li, key, x, y, z, sx, sy, sz, axis, ang) {
  const g = new THREE.BoxGeometry(sx, sy, sz);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(axis === 'z' ? ang : 0, 0, axis === 'x' ? ang : 0));
  m.compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(1, 1, 1));
  B.geo(li, key, g, m);
}
