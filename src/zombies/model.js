import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {
  rng, fbm, noise3, prof, sstep, clamp, lerp, G, TAU, segDist2, tube, prim, mat4, displace, paint, skin, autoList, assemble,
  headGeo, flip, smoothNormals,
} from './anatomy.js';
import { materials } from './materials.js';
import { caps } from '../sys/caps.js';
import { createPool } from '../sys/workers.js';
import { unpack } from '../sys/pack.js';
import { idle } from '../sys/sched.js';

// 每個變體 = 一組固定種子生成的身材、皮膚、傷口、服裝,合併成單一 SkinnedMesh 幾何(依材質分組)。
// 先以 1.0 比例(身高約 1.79m)建模,最後整體縮放 P.s。

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const col = (h) => new THREE.Color(h);
const SLOTS = ['skin', 'cloth', 'gear', 'bone', 'hair', 'glow', 'eye'];

export const BONES = [
  'root', 'hips', 'spine', 'belly', 'chest', 'neck', 'head', 'jaw',
  'clavL', 'upperArmL', 'forearmL', 'handL', 'clavR', 'upperArmR', 'forearmR', 'handR',
  'thighL', 'shinL', 'footL', 'thighR', 'shinR', 'footR',
];

function makeRig(P) {
  const sw = 0.18 * P.sw * lerp(1, P.fat, 0.7), hw = 0.092 * P.hip * lerp(1, P.fat, 0.5), al = P.arm;
  const HC = V(0, 1.668 - (1 - P.head) * 0.09, 0.016);
  const j = {
    root: [null, V(0, 0, 0), V(0, 0.5, 0)],
    hips: ['root', V(0, 0.97, 0), V(0, 1.1, -0.01)],
    spine: ['hips', V(0, 1.1, -0.01), V(0, 1.29, -0.015)],
    belly: ['spine', V(0, 1.08, -0.01), V(0, 1.08, 0.1)],
    chest: ['spine', V(0, 1.29, -0.015), V(0, 1.47, -0.025)],
    neck: ['chest', V(0, 1.47, -0.025), V(0, HC.y - 0.083, -0.005)],
    head: ['neck', V(0, HC.y - 0.083, -0.005), V(0, HC.y + 0.11, 0.01)],
    jaw: ['head', V(0, HC.y - 0.012, HC.z - 0.004), V(0, HC.y - 0.1, HC.z + 0.07)],
  };
  for (const s of [1, -1]) {
    const L = s > 0 ? 'L' : 'R';
    const sh = V(s * sw, 1.44, -0.025);
    const el = V(s * (sw + 0.04), 1.44 - 0.285 * al, -0.05);
    const wr = V(s * (sw + 0.062), el.y - 0.255 * al, -0.02);
    j['clav' + L] = ['chest', V(s * 0.025, 1.445, -0.01), sh.clone()];
    j['upperArm' + L] = ['clav' + L, sh, el];
    j['forearm' + L] = ['upperArm' + L, el.clone(), wr];
    j['hand' + L] = ['forearm' + L, wr.clone(), V(wr.x + s * 0.006, wr.y - 0.18, wr.z + 0.012)];
    const hp = V(s * hw, 0.945, 0), kn = V(s * (hw + 0.006), 0.51, 0.014), an = V(s * (hw + 0.012), 0.085, -0.03);
    j['thigh' + L] = ['hips', hp, kn];
    j['shin' + L] = ['thigh' + L, kn.clone(), an];
    j['foot' + L] = ['shin' + L, an.clone(), V(an.x + s * 0.01, 0.02, 0.15)];
  }
  const bones = BONES.map((name, i) => ({ name, i, parent: j[name][0], head: j[name][1], tail: j[name][2] }));
  return { bones, index: Object.fromEntries(BONES.map((n, i) => [n, i])), HC, sw, hw };
}

// ---------- 身材 ----------
const BODY = {
  walker: (r) => ({ s: r.range(0.95, 1.05), sw: r.range(0.96, 1.08), hip: r.range(0.96, 1.06), g: r.range(0.9, 1.08), fat: r.range(0.94, 1.1), musc: r.range(0.1, 0.4), belly: r.range(0, 0.3), thin: r.range(0.15, 0.6), arm: 1, neck: 1, head: r.range(0.97, 1.03) }),
  runner: (r) => ({ s: r.range(0.97, 1.03), sw: r.range(0.94, 1.0), hip: 0.97, g: r.range(0.82, 0.9), fat: r.range(0.88, 0.95), musc: 0.35, belly: 0, thin: r.range(0.6, 0.9), arm: 1.03, neck: 0.93, head: 0.98 }),
  crawler: (r) => ({ s: r.range(0.93, 1.0), sw: 0.95, hip: 0.95, g: 0.82, fat: 0.88, musc: 0.1, belly: 0, thin: 1, arm: 1.04, neck: 0.9, head: 1, legless: r.chance(0.65) }),
  bloater: (r) => ({ s: r.range(0.97, 1.04), sw: 1.08, hip: 1.2, g: r.range(1.32, 1.45), fat: 1.3, musc: 0, belly: 1.6, thin: 0, arm: 0.97, neck: 1.4, head: 1.02 }),
  brute: (r) => ({ s: r.range(1.2, 1.26), sw: 1.42, hip: 1.08, g: 1.62, fat: 1.12, musc: 1.3, belly: 0.1, thin: 0, arm: 1.08, neck: 1.55, head: 0.86 }),
};

const SKINS = {
  rot: ['#7d846e', '#4b5743', '#5a4b62'],
  pale: ['#9c968a', '#6b6f73', '#5c4f6b'],
  jaundice: ['#9d9368', '#6c6643', '#695a50'],
  dark: ['#5f4d40', '#3a322c', '#3f3042'],
  blue: ['#7b8089', '#4a4f64', '#4d4366'],
  fresh: ['#a89183', '#7d6463', '#6d5070'],
  bloat: ['#8f9168', '#5d6836', '#6c5c3a'],
  brute: ['#716a72', '#4a3f4e', '#4b3049'],
};
const SKIN_BY_TYPE = {
  walker: ['rot', 'pale', 'jaundice', 'dark', 'blue', 'rot'],
  runner: ['fresh', 'pale', 'dark', 'fresh'],
  crawler: ['rot', 'blue', 'pale'],
  bloater: ['bloat'],
  brute: ['brute', 'dark'],
};
const BRUISE = col('#3a2038'), BRUISE_Y = col('#7a7a3a'), DIRT = col('#2e2820'), BLOOD = col('#5a0505'), BLOOD_DRY = col('#2c0805');
const FLESH = col('#6a1414'), FLESH_DARK = col('#220404'), NECRO = col('#1e1a1e'), BONE = col('#cfc2a2'), CHAR = col('#141010');
const SOCKET = col('#2a2026'), LIPS = col('#3a2228'), CAVITY = col('#120808'), PUS = col('#9a9a30'), VEIN = col('#2a2a3a');

function bloodAmt(list, x, y, z) {
  let m = 0;
  for (const s of list) {
    const dx = x - s.c.x, dy = y - s.c.y, dz = z - s.c.z;
    let w = G(dx * dx + dy * dy * (s.sq ?? 1) + dz * dz, s.r);
    if (s.drip && dy < 0 && dy > -s.drip) {
      const k = -dy / s.drip;
      const wob = noise3(x * 30 + s.k, y * 4, z * 30) * 0.01;
      w = Math.max(w, G((dx + wob) ** 2 + dz * dz * 0.5, s.r * (0.32 + 0.12 * noise3(y * 25, s.k, 1))) * (1 - k * k));
    }
    if (w > m) m = w;
  }
  if (m < 0.02) return 0;
  return sstep(0.3, 0.6, m + fbm(x * 16, y * 16, z * 16, 2) * 0.4);
}

// ---------- 主建模 ----------
// buildShape:純幾何 + 骨架 + 命中盒(不碰材質與 DOM,可在 Worker 執行,見 model.worker.js);buildVariant = buildShape + 綁材質
export function buildVariant(type, seed, opt = {}) { return bindMaterials(buildShape(type, seed, opt)); }
export function bindMaterials(v) {
  const M = materials();
  v.materials = v.slots.map((s) => (s === 'eye' ? M.eye[v.type] || M.eye.walker : M[s]));
  return v;
}
export function buildShape(type, seed, opt = {}) {
  const r = rng(seed);
  const P = BODY[type](r);
  P.fem = (type === 'walker' || type === 'runner') && r.chance(0.35) ? 1 : 0;
  if (P.fem) { P.sw *= 0.9; P.hip *= 1.05; P.g *= 0.9; P.musc *= 0.3; P.neck *= 0.88; P.head *= 0.97; }
  const rig = makeRig(P);
  const B = (n) => rig.bones[rig.index[n]];
  const HC = rig.HC;
  const pieces = [];
  const add = (geo, slot, weights, painter) => { pieces.push({ geo, slot, weights, painter }); return geo; };

  // ---- 外觀參數 ----
  const pal = SKINS[r.pick(SKIN_BY_TYPE[type])];
  const L = {
    skin: col(pal[0]), dark: col(pal[1]), livid: col(pal[2]), ends: col(pal[1]).lerp(col('#3a3448'), 0.5),
    mottle: r.range(0.55, 0.95), livor: r.range(0.4, 1), k: r() * 100, dirt: r.range(0.15, 0.45),
    fresh: type === 'runner' ? 1 : r.range(0.1, 0.5), veins: type === 'brute' || type === 'bloater' ? 1 : type === 'runner' ? 0.6 : r.range(0, 0.4),
    bruises: [], blood: [], clothBlood: [], wounds: [], pustules: [],
  };

  // ---- 身體各部形狀 ----
  const T0 = 0.82, T1 = 1.56;
  const ty = (y) => (y - T0) / (T1 - T0);
  const tShape = (() => {
    const Wt = [0.1, 0.15, 0.168, 0.166, 0.153, 0.145, 0.147, 0.156, 0.166, 0.172, 0.168, 0.146, 0.06];
    const Df = [0.06, 0.088, 0.097, 0.099, 0.1, 0.099, 0.1, 0.104, 0.108, 0.104, 0.09, 0.068, 0.05];
    const Db = [0.07, 0.112, 0.108, 0.092, 0.088, 0.088, 0.092, 0.098, 0.104, 0.104, 0.092, 0.066, 0.046];
    const Zc = [0, 0, 0, 0.004, 0.007, 0.005, 0, -0.005, -0.008, -0.012, -0.017, -0.02, -0.02];
    const e = 2 / 2.3;
    return (t, th) => {
      let w = prof(Wt, t) * lerp(P.hip, P.sw, sstep(0.3, 0.75, t)) * lerp(1, P.fat, 0.7);
      if (P.fem) w *= 1 - 0.09 * G((t - 0.42) ** 2, 0.12) + 0.04 * G((t - 0.15) ** 2, 0.1);
      w *= 1 - P.thin * 0.06 * G((t - 0.45) ** 2, 0.15);
      const df = prof(Df, t) * P.fat, db = prof(Db, t) * lerp(1, P.fat, 0.8);
      const c = Math.cos(th), s = Math.sin(th);
      return [Math.sign(c) * Math.pow(Math.abs(c), e) * w, (s >= 0 ? df : db) * Math.sign(s) * Math.pow(Math.abs(s), e) + prof(Zc, t)];
    };
  })();
  const ell = (rad, ex, ez) => (t, th) => { const q = rad(t); return [Math.cos(th) * q * ex, Math.sin(th) * q * ez]; };
  const armR = [0.054, 0.052, 0.047, 0.044, 0.041, 0.037].map((v) => v * P.g);
  const foreR = [0.038, 0.043, 0.042, 0.037, 0.032, 0.028, 0.026].map((v) => v * P.g);
  const thighR = [0.09, 0.087, 0.08, 0.072, 0.064, 0.056, 0.051].map((v) => v * lerp(1, P.g, 0.8));
  const shinR = [0.052, 0.055, 0.056, 0.05, 0.042, 0.035, 0.031, 0.03].map((v) => v * lerp(1, P.g, 0.85));
  const upperShape = ell((t) => prof(armR, t), 1, 1.06);
  const foreShape = (t, th) => { const q = prof(foreR, t); return [Math.cos(th) * q * lerp(1, 0.8, t), Math.sin(th) * q * lerp(1.02, 1.12, t)]; };
  const thighShape = ell((t) => prof(thighR, t), 0.96, 1.04);
  const shinShape = ell((t) => prof(shinR, t), 0.94, 1.04);
  const neckShape = (t, th) => { const q = prof([0.064, 0.054, 0.05, 0.048, 0.047], t) * P.neck; return [Math.cos(th) * q * 0.95, Math.sin(th) * q * 1.04]; };
  const NA = V(0, 1.42, -0.03), NB = V(0, HC.y - 0.005, -0.0);

  // 身體表面上的隨機點(傷口、瘀青、膿包定位用)
  const surf = (region) => {
    if (region === 'torso') {
      const t = r.range(0.25, 0.85), th = r() * TAU;
      const [x, z] = tShape(t, th);
      return { p: V(x, lerp(T0, T1, t), z), n: V(x, 0, z).normalize() };
    }
    if (region === 'head') {
      const a = r.range(-2.2, 2.2), e = r.range(0.3, 1.1);
      const n = V(Math.sin(a) * Math.cos(e), Math.sin(e), Math.cos(a) * Math.cos(e));
      return { p: V(HC.x + n.x * 0.075, HC.y + n.y * 0.11, HC.z + n.z * 0.1), n };
    }
    const side = r.sign(), Ls = side > 0 ? 'L' : 'R';
    const bn = { arm: r.pick(['upperArm', 'forearm']), leg: r.pick(['thigh', 'shin']), neck: 'neck' }[region];
    const b = region === 'neck' ? { head: NA, tail: NB } : B(bn + Ls);
    const t = r.range(0.2, 0.8), c = b.head.clone().lerp(b.tail, t);
    const rad = region === 'neck' ? 0.05 * P.neck : bn === 'upperArm' ? prof(armR, t) : bn === 'forearm' ? prof(foreR, t) : bn === 'thigh' ? prof(thighR, t) : prof(shinR, t);
    const ax = b.tail.clone().sub(b.head).normalize();
    const n = V(r.range(-1, 1), 0, r.range(-1, 1)).normalize();
    n.addScaledVector(ax, -n.dot(ax)).normalize();
    return { p: c.addScaledVector(n, rad), n };
  };

  // ---- 傷口 / 瘀青 / 血 ----
  const wound = (kind, region, rad) => {
    const s = surf(region);
    const w = { kind, c: s.p, n: s.n, r: rad, k: r() * 50 };
    if (kind === 'gash') {
      const dir = V(r.range(-1, 1), r.range(-1, 1), r.range(-1, 1)).normalize();
      dir.addScaledVector(s.n, -dir.dot(s.n)).normalize();
      const len = rad * r.range(2, 3.5);
      w.a = s.p.clone().addScaledVector(dir, -len / 2);
      w.b = s.p.clone().addScaledVector(dir, len / 2);
    }
    L.wounds.push(w);
    L.blood.push({ c: s.p.clone(), r: rad * 1.6, drip: r.range(0.06, 0.25), k: r() * 50 });
    L.clothBlood.push({ c: s.p.clone().addScaledVector(s.n, 0.015), r: rad * 2.4, drip: r.range(0.1, 0.35), sq: 0.6, k: r() * 50 });
    return w;
  };
  const WOUNDS = {
    walker: () => { wound('bite', r.pick(['arm', 'neck', 'torso']), 0.03); if (r.chance(0.6)) wound('gash', r.pick(['torso', 'leg', 'arm']), 0.025); if (r.chance(0.25)) wound('ribs', 'torso', 0.06); if (r.chance(0.2)) wound('skull', 'head', 0.03); },
    runner: () => { wound('bite', 'neck', 0.032); wound('gash', r.pick(['torso', 'arm']), 0.022); if (r.chance(0.5)) wound('bite', 'arm', 0.028); },
    crawler: () => { wound('ribs', 'torso', 0.07); wound('gash', 'torso', 0.03); if (r.chance(0.5)) wound('skull', 'head', 0.035); wound('bite', 'arm', 0.03); },
    bloater: () => { wound('gash', 'torso', 0.03); wound('burn', 'torso', 0.06); },
    brute: () => { wound('gash', 'arm', 0.03); wound('gash', 'torso', 0.035); wound('burn', r.pick(['arm', 'torso']), 0.05); wound('bite', 'leg', 0.035); },
  };
  WOUNDS[type]();
  for (let i = 0, n = 3 + ((r() * 5) | 0); i < n; i++) { const s = surf(r.pick(['torso', 'arm', 'leg', 'arm', 'neck'])); L.bruises.push({ c: s.p, r: r.range(0.03, 0.07), k: r() * 50 }); }
  // 嘴邊流下的血
  const mouth = V(0, HC.y - 0.06, HC.z + 0.09);
  const mouthBlood = type === 'runner' ? 1 : r.range(0.3, 1);
  for (let i = 0; i < 2 + mouthBlood * 4; i++) L.blood.push({ c: mouth.clone().add(V(r.range(-0.02, 0.02), r.range(-0.01, 0.005), 0)), r: 0.012, drip: r.range(0.05, 0.12 + mouthBlood * 0.35), k: r() * 50 });
  L.blood.push({ c: V(0, HC.y - 0.09, HC.z + 0.07), r: 0.03 * mouthBlood, sq: 0.5 });
  for (const s of [1, -1]) { const h = B(s > 0 ? 'handL' : 'handR'); if (r.chance(0.7)) L.blood.push({ c: h.head.clone().lerp(h.tail, 0.6), r: r.range(0.05, 0.09) }); }
  // 衣服上的血:領口、胸前抹痕、噴濺
  L.clothBlood.push({ c: V(0, 1.42, 0.12), r: 0.06 + mouthBlood * 0.08, drip: 0.15 + mouthBlood * 0.35, sq: 0.4, k: r() * 50 });
  for (let i = 0, n = 2 + ((r() * 4) | 0); i < n; i++) { const s = surf(r.pick(['torso', 'torso', 'leg'])); L.clothBlood.push({ c: s.p.addScaledVector(s.n, 0.02), r: r.range(0.03, 0.08), drip: r.chance(0.5) ? r.range(0.05, 0.25) : 0, sq: 0.7, k: r() * 50 }); }

  // 頭部參數(skull 傷口需要)
  const decayed = type === 'crawler' || (type === 'walker' && r.chance(0.3));
  const H = {
    w: P.head * r.range(0.97, 1.04) * (type === 'brute' ? 1.12 : 1) * (type === 'bloater' ? 1.08 : 1), h: P.head * r.range(0.97, 1.03), d: P.head * r.range(0.97, 1.03),
    jaw: type === 'brute' ? 0.86 : r.range(0.62, 0.74), brow: type === 'brute' ? 1.8 : r.range(0.7, 1.3), sock: lerp(0.9, 1.35, P.thin) * (type === 'bloater' ? 0.6 : 1),
    nose: decayed && r.chance(0.5) ? 0 : r.range(0.8, 1.15), cheek: r.range(0.6, 1.3), thin: P.thin, lips: decayed && r.chance(0.6) ? -0.6 : r.range(0.7, 1.2),
    decay: decayed ? 1 : 0.3, seed: r() * 100, mouthW: type === 'brute' ? 1.2 : 1,
  };

  const woundDisp = (x, y, z) => {
    let d = 0;
    for (const w of L.wounds) {
      const d2 = w.kind === 'gash' ? segDist2(x, y, z, w.a, w.b) : (x - w.c.x) ** 2 + (y - w.c.y) ** 2 + (z - w.c.z) ** 2;
      if (d2 > w.r * w.r * 6) continue;
      const g = G(d2, w.r * 0.85);
      if (w.kind === 'ribs') d += -0.02 * g + 0.012 * g * sstep(0.2, 0.8, Math.max(0, Math.sin((y - w.c.y) * TAU / 0.026)));
      else if (w.kind === 'skull') d += -0.004 * g;
      else if (w.kind === 'burn') d += noise3(x * 60, y * 60, z * 60) * 0.003 * g;
      else d += -0.009 * g + 0.002 * G(d2, w.r * 1.3);
    }
    return d;
  };
  const woundPaint = (x, y, z, c) => {
    let wet = 0;
    for (const w of L.wounds) {
      const d2 = w.kind === 'gash' ? segDist2(x, y, z, w.a, w.b) : (x - w.c.x) ** 2 + (y - w.c.y) ** 2 + (z - w.c.z) ** 2;
      if (d2 > w.r * w.r * 4) continue;
      const q = Math.sqrt(d2) / w.r + noise3(x * 50 + w.k, y * 50, z * 50) * 0.3;
      const core = sstep(1.0, 0.65, q), rim = clamp(sstep(1.7, 1.0, q) - core, 0, 1);
      c.lerp(w.kind === 'burn' ? CHAR : NECRO, rim * 0.8);
      if (core <= 0) continue;
      if (w.kind === 'burn') { c.lerp(CHAR, core); c.lerp(FLESH, core * sstep(0.55, 0.75, noise3(x * 70, y * 70, z * 70) + 0.5) * 0.7); wet = Math.max(wet, core * 0.2); continue; }
      c.lerp(FLESH, core);
      c.lerp(FLESH_DARK, core * sstep(0.7, 0.0, q) * 0.8);
      if (w.kind === 'ribs') c.lerp(BONE, core * sstep(0.45, 0.85, Math.sin((y - w.c.y) * TAU / 0.026)));
      if (w.kind === 'skull') c.lerp(BONE, core * 0.85);
      wet = Math.max(wet, core * (w.kind === 'skull' ? 0.4 : 1));
    }
    return wet;
  };
  // 皮下血管(隆起的網狀紋路)
  const veinAt = (x, y, z) => (L.veins > 0 ? sstep(0.9, 0.97, 1 - Math.abs(noise3(x * 14 + L.k, y * 9, z * 14))) * L.veins : 0);

  const tc = new THREE.Color();
  const skinPainter = (part, extra) => (x, y, z, nx, ny, nz, i, out) => {
    const c = tc.copy(L.skin);
    c.lerp(L.dark, sstep(-0.1, 0.4, fbm(x * 3.1 + L.k, y * 3.1, z * 3.1, 4)) * L.mottle);
    c.multiplyScalar(0.6 + fbm(x * 13, y * 13 + L.k, z * 13, 3) * 0.25);
    c.lerp(L.livid, sstep(0.75, 0.1, y) * 0.4 * L.livor);
    c.lerp(L.livid, sstep(0.1, -0.6, nz) * 0.15 * L.livor); // 背側屍斑
    if (part === 'hand' || part === 'foot') c.lerp(L.ends, 0.45);
    c.lerp(VEIN, veinAt(x, y, z) * 0.55);
    for (const b of L.bruises) {
      const d2 = (x - b.c.x) ** 2 + (y - b.c.y) ** 2 + (z - b.c.z) ** 2;
      if (d2 > b.r * b.r * 5) continue;
      const w = G(d2, b.r) * (0.6 + 0.5 * noise3(x * 30, y * 30, z * 30 + b.k));
      c.lerp(BRUISE, clamp(w, 0, 1) * 0.75);
      c.lerp(BRUISE_Y, clamp(G(d2, b.r * 1.5) - w, 0, 1) * 0.45);
    }
    for (const p of L.pustules) {
      const d2 = (x - p.c.x) ** 2 + (y - p.c.y) ** 2 + (z - p.c.z) ** 2;
      if (d2 < p.r * p.r * 9) c.lerp(FLESH, G(d2, p.r * 1.8) * 0.6);
    }
    c.lerp(DIRT, sstep(0.15, 0.5, fbm(x * 2.5 + 40, y * 2.5, z * 2.5, 3)) * L.dirt);
    let wet = woundPaint(x, y, z, c);
    const b = bloodAmt(L.blood, x, y, z);
    if (b > 0) { c.lerp(L.fresh > 0.5 ? BLOOD : BLOOD_DRY, b * 0.92); wet = Math.max(wet, b * (0.4 + L.fresh * 0.6)); }
    if (extra) wet = extra(x, y, z, nx, ny, nz, i, c, wet);
    out[0] = c.r; out[1] = c.g; out[2] = c.b; out[3] = wet;
  };

  // ---- 軀幹 ----
  const legless = !!P.legless;
  const torsoDisp = (x, y, z, nx, ny, nz) => {
    let d = 0;
    const ax = Math.abs(x), front = Math.max(0, nz), back = Math.max(0, -nz);
    d += (0.004 + P.musc * 0.016) * G((ax - 0.072 * P.sw) ** 2 + (y - 1.335) ** 2, 0.055) * front; // 胸肌
    if (P.fem) d += 0.03 * G((ax - 0.062) ** 2 + (y - 1.3) ** 2, 0.045) * front;
    d += P.belly * 0.12 * G((x / 1.25) ** 2 + (y - 1.09) ** 2, 0.14) * front; // 肚子
    d += 0.012 * (1 - P.thin) * G(x * x + (y - 1.06) ** 2, 0.08) * front;
    d += 0.022 * G((ax - 0.068 * P.hip) ** 2 + (y - 0.9) ** 2, 0.065) * back; // 臀
    d += 0.011 * G((ax - 0.085 * P.sw) ** 2 + (y - 1.37) ** 2, 0.045) * back; // 肩胛
    d -= 0.006 * G(x * x, 0.016) * back * sstep(0.95, 1.08, y); // 脊椎溝
    d += 0.006 * G((y - 1.462 - ax * 0.05) ** 2, 0.009) * sstep(0.02, 0.05, ax) * (1 - sstep(0.13, 0.17, ax)) * front; // 鎖骨
    if (P.thin > 0) { // 肋骨
      const rib = Math.max(0, Math.sin((y - 1.1) * TAU / 0.03));
      d += P.thin * 0.0055 * rib * sstep(1.08, 1.15, y) * (1 - sstep(1.32, 1.38, y)) * (1 - back * 0.7);
      d -= P.thin * 0.018 * G(x * x + (y - 1.08) ** 2, 0.07) * front;
    }
    if (P.musc > 0.5) d += P.musc * 0.005 * Math.max(0, Math.cos(x * TAU / 0.07)) * Math.max(0, Math.sin((y - 1.02) * TAU / 0.07)) * sstep(1.0, 1.04, y) * (1 - sstep(1.22, 1.26, y)) * front * (1 - sstep(0.07, 0.1, ax)); // 腹肌
    if (P.musc > 0.5) d += P.musc * 0.02 * G((ax - 0.08) ** 2 + (y - 1.5) ** 2, 0.06); // 斜方肌
    return d + fbm(x * 12, y * 12, z * 12, 3) * 0.004 + veinAt(x, y, z) * 0.0015;
  };
  const torsoW = (x, y, z) => {
    const l = autoList(rig, ['hips', 'spine', 'chest', 'neck'], x, y, z).map((e) => [...e]);
    if (!legless) for (const n of ['thighL', 'thighR']) { const b = B(n); l.push([b.i, 0.3 / Math.pow(Math.max(Math.sqrt(segDist2(x, y, z, b.head, b.tail)), 0.004), 4)]); }
    const tot = l.reduce((s, e) => s + e[1], 0);
    const wb = G((x / 1.3) ** 2 + (y - 1.09) ** 2, 0.13) * sstep(0.0, 0.08, z) * (0.35 + P.belly * 0.5);
    return [...l.map(([b, w]) => [b, (w / tot) * (1 - wb)]), ['belly', wb]];
  };
  const torso = tube(V(0, T0, 0), V(0, T1, 0), tShape, { cols: 40, rows: 36, t0: legless ? 0.22 : 0, capA: legless ? 0.55 : 0.7, capB: 0.9 });
  displace(torso, (x, y, z, nx, ny, nz) => torsoDisp(x, y, z, nx, ny, nz) + woundDisp(x, y, z) + (legless ? -0.01 * sstep(1.0, 0.96, y) * noise3(x * 40, y * 40, z * 40) : 0));
  add(torso, 'skin', torsoW, skinPainter('torso', legless ? (x, y, z, nx, ny, nz, i, c, wet) => {
    const k = sstep(1.0, 0.975, y + noise3(x * 30, 0, z * 30) * 0.01); // 斷面
    c.lerp(FLESH, k);
    c.lerp(FLESH_DARK, k * sstep(0.97, 0.94, y) * 0.7);
    c.lerp(BLOOD_DRY, sstep(1.1, 1.0, y) * (1 - k) * 0.6);
    return Math.max(wet, k);
  } : null));

  // ---- 脖子 ----
  const neck = tube(NA, NB, neckShape, { cols: 22, rows: 10, capA: 0.5, capB: 0.6 });
  displace(neck, (x, y, z, nx, ny, nz) => (P.fem ? 0 : 0.006 * G(x * x + (y - 1.535) ** 2, 0.014) * Math.max(0, nz)) + 0.004 * G((Math.abs(x) - 0.03) ** 2, 0.012) * Math.max(0, nz) * P.thin + woundDisp(x, y, z) + fbm(x * 20, y * 20, z * 20, 2) * 0.002);
  add(neck, 'skin', ['chest', 'neck', 'head'], skinPainter('neck'));

  // ---- 頭 ----
  if (H.lips < 0) L.blood.push({ c: V(0, HC.y - 0.05, HC.z + 0.09), r: 0.012, drip: 0.02 });
  const skullW = L.wounds.filter((w) => w.kind === 'skull');
  H.extra = (x, y, z) => { let d = 0; for (const w of skullW) d += -0.004 * G((x + HC.x - w.c.x) ** 2 + (y + HC.y - w.c.y) ** 2 + (z + HC.z - w.c.z) ** 2, w.r); return d; };
  const hg = headGeo(H);
  hg.geo.translate(HC.x, HC.y, HC.z);
  const jawW = (x, y, z, i) => {
    if (hg.lower.has(i)) return 1;
    const ly = y - HC.y, lz = z - HC.z;
    const lineY = lerp(-0.012, hg.my - 0.003, clamp(lz, 0, 0.09) / 0.09);
    let j = sstep(0.004, -0.004, ly - lineY);
    if (lz < 0) j *= sstep(-0.03, 0, lz);
    return j;
  };
  const hairCol = col(r.pick(['#1b1714', '#3a2a1e', '#6e6a62', '#7a6748', '#2a2420']));
  const hasHair = type !== 'brute' && type !== 'bloater' && r.chance(type === 'crawler' ? 0.4 : 0.75);
  const headExtra = (x, y, z, nx, ny, nz, i, c, wet) => {
    const lx = x - HC.x, ly = y - HC.y, lz = z - HC.z;
    for (const s of [1, -1]) c.lerp(SOCKET, G((lx - s * 0.031 * H.w) ** 2 + ((ly - 0.009) * 1.5) ** 2 + (lz - 0.08) ** 2 * 0.4, 0.016) * 0.7);
    c.lerp(LIPS, G(lx * lx * 0.3 + (ly - hg.my) ** 2 * 2.2, 0.013) * sstep(0.05, 0.08, lz) * 0.75);
    if (H.lips < 0) c.lerp(FLESH_DARK, G(lx * lx * 0.3 + (ly - hg.my) ** 2 * 1.5, 0.014) * sstep(0.06, 0.08, lz));
    if (H.nose < 0.3) c.lerp(CAVITY, G(lx * lx * 1.5 + (ly + 0.012) ** 2 + (lz - 0.095) ** 2, 0.015));
    if (hasHair) c.lerp(hairCol, G(((ly - 0.04) * 1.6) ** 2 + (Math.abs(lx) - 0.032) ** 2 * 0.5, 0.008) * sstep(0.07, 0.09, lz) * 0.8); // 眉毛
    return wet;
  };
  add(hg.geo, 'skin', (x, y, z, i) => { const j = jawW(x, y, z, i); return [['head', 1 - j], ['jaw', j]]; }, skinPainter('head', headExtra));
  // 耳朵
  for (const s of [1, -1]) {
    const e = prim(new THREE.SphereGeometry(1, 14, 10), mat4(V(HC.x + s * 0.073 * H.w, HC.y + 0.002, HC.z - 0.01), [0, s * 0.35, s * 0.08], [0.011, 0.029 * H.h, 0.02]));
    displace(smoothNormals(e), (x, y, z, nx) => -0.004 * Math.max(0, nx * s) * G((y - HC.y) ** 2, 0.015));
    add(e, 'skin', 'head', skinPainter('head'));
  }
  // 眼球
  const eyeZ = 0.09 * H.d - 0.018 * H.sock - 0.0125 + 0.0075;
  for (const s of [1, -1]) {
    const e = prim(new THREE.SphereGeometry(0.0125 * Math.min(1, P.head * 1.05), 16, 12), mat4(V(HC.x + s * 0.031 * H.w, HC.y + 0.012, HC.z + eyeZ), [r.range(-0.1, 0.15), s * r.range(0.0, 0.25), 0]));
    add(e, 'eye', 'head', (x, y, z, nx, ny, nz, i, out) => { out[0] = out[1] = out[2] = 1; out[3] = 1; });
  }
  // 牙齒 + 口腔
  const zf = hg.mouthZ;
  const toothCol = [col('#b8a878'), col('#8a7a52'), col('#5a4a30')];
  for (const up of [true, false]) {
    for (let k = 0; k < 10; k++) {
      if (r.chance(decayed ? 0.3 : 0.12)) continue;
      const a = ((k - 4.5) / 4.5) * 0.9;
      const h = 0.0095 * r.range(0.75, 1.15) * (type === 'brute' && !up ? 1.3 : 1);
      const tx = Math.sin(a) * 0.024 * H.w, tz = zf - 0.0055 - (1 - Math.cos(a)) * 0.03;
      const yc = up ? hg.my + 0.0045 - h / 2 : hg.my - 0.0035 + h / 2 - 0.006;
      const t = prim(new THREE.BoxGeometry(0.0058, h, 0.0042), mat4(V(HC.x + tx, HC.y + yc, HC.z + tz), [r.range(-0.15, 0.15), a, r.range(-0.15, 0.15)]));
      const tcol = toothCol[(r() * 2.2) | 0];
      add(t, 'bone', up ? 'head' : 'jaw', (x, y, z, nx, ny, nz, i, out) => { out[0] = tcol.r; out[1] = tcol.g; out[2] = tcol.b; out[3] = 1; });
    }
  }
  const mouthIn = flip(prim(new THREE.SphereGeometry(1, 16, 12), mat4(V(HC.x, HC.y + hg.my - 0.004, HC.z + zf - 0.03), [0, 0, 0], [0.023 * H.w, 0.02, 0.028])));
  add(mouthIn, 'skin', (x, y) => (y > HC.y + hg.my ? [['head', 1]] : [['jaw', 1]]), (x, y, z, nx, ny, nz, i, out) => { out[0] = 0.03; out[1] = 0.005; out[2] = 0.005; out[3] = 1; });

  // ---- 頭髮 ----
  if (hasHair) {
    const hair = hg.geo.clone();
    const p = hair.attributes.position.array, n = hair.attributes.normal.array;
    const long = P.fem || r.chance(0.2);
    const patchy = type === 'crawler' || r.chance(0.4) ? r.range(-0.05, 0.15) : -1;
    const alpha = new Float32Array(p.length / 3);
    for (let i = 0; i < alpha.length; i++) {
      const lx = p[i * 3] - HC.x, ly = p[i * 3 + 1] - HC.y, lz = p[i * 3 + 2] - HC.z;
      const line = lz > 0 ? lerp(0.07, 0.055, sstep(0.0, 0.05, Math.abs(lx))) - (1 - sstep(0.02, 0.07, lz)) * 0.03 : lerp(long ? -0.075 : -0.05, -0.02, sstep(0.0, 0.07, Math.abs(lx)) * sstep(-0.02, 0.0, lz));
      let a = sstep(line - 0.008, line + 0.01, ly);
      if (Math.abs(lx) > 0.055 && ly < 0.03 && lz > -0.04 && lz < 0.03) a *= sstep(0.06, 0.08, Math.abs(ly - 0.0) + 0.06 - (lz + 0.04) * 0.4); // 耳朵處
      if (patchy > -1) a *= sstep(patchy + 0.06, patchy, fbm(lx * 25 + L.k, ly * 25, lz * 25, 3));
      alpha[i] = a;
      const off = 0.003 + a * (long ? 0.007 : 0.004);
      p[i * 3] += n[i * 3] * off; p[i * 3 + 1] += n[i * 3 + 1] * off; p[i * 3 + 2] += n[i * 3 + 2] * off;
    }
    const idx = hair.index.array, keep = [];
    for (let k = 0; k < idx.length; k += 3) if (alpha[idx[k]] > 0.05 || alpha[idx[k + 1]] > 0.05 || alpha[idx[k + 2]] > 0.05) keep.push(idx[k], idx[k + 1], idx[k + 2]);
    hair.setIndex(keep);
    const hp = (x, y, z, nx, ny, nz, i, out) => { const v = 0.8 + fbm(x * 30, y * 30, z * 30, 2) * 0.5; out[0] = hairCol.r * v; out[1] = hairCol.g * v; out[2] = hairCol.b * v; out[3] = alpha[i] ?? 1; };
    add(hair, 'hair', (x, y, z, i) => { const j = jawW(x, y, z, i); return [['head', 1 - j], ['jaw', j]]; }, hp);
    if (long) { // 垂下的長髮束
      const strands = [];
      for (let k = 0; k < 34; k++) {
        const a = r.range(0.75, 2.4) * r.sign() * (r.chance(0.3) ? 0.7 : 1);
        const out = V(Math.sin(a), 0, Math.cos(a));
        const len = r.range(0.14, 0.3), w = r.range(0.012, 0.022);
        const top = V(HC.x + out.x * 0.07 * H.w, HC.y + r.range(0.02, 0.07), HC.z + out.z * 0.095 - 0.005);
        const tan = V(out.z, 0, -out.x);
        const pos = [], uv = [], ids = [];
        for (let s2 = 0; s2 <= 6; s2++) {
          const u = s2 / 6;
          const c = top.clone().addScaledVector(out, 0.018 * Math.sin(Math.min(1, u * 2.2) * Math.PI * 0.5) + u * 0.02).add(V(0, -u * len, 0));
          for (const sd of [-1, 1]) { const q = c.clone().addScaledVector(tan, (sd * w * (1 - u * 0.5)) / 2); pos.push(q.x, q.y, q.z); uv.push((sd + 1) * 0.25 + k * 0.13, u * len * 4); }
          if (s2 < 6) { const b = s2 * 2; ids.push(b, b + 2, b + 1, b + 1, b + 2, b + 3); }
        }
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
        g.setIndex(ids);
        g.computeVertexNormals();
        strands.push(g);
      }
      const sg = mergeGeometries(strands);
      add(sg, 'hair', ['head', 'neck', 'chest'], (x, y, z, nx, ny, nz, i, out) => { const v = 0.8 + noise3(x * 40, y * 10, z * 40) * 0.4; out[0] = hairCol.r * v; out[1] = hairCol.g * v; out[2] = hairCol.b * v; out[3] = sstep(HC.y - 0.33, HC.y - 0.12, y); });
    }
  }

  // ---- 手臂與手 ----
  const curl = type === 'brute' ? [1.3, 1.5, 1.2] : type === 'runner' ? [0.5, 0.9, 0.7] : [r.range(0.15, 0.6), r.range(0.4, 0.9), r.range(0.3, 0.7)];
  const gloves = { v: null };
  const handPieces = (s) => {
    const hs = lerp(1, P.g, 0.6) * (type === 'brute' ? 1.1 : 1);
    const gs = [];
    gs.push(tube(V(0, 0.012, 0), V(0, -0.088 * hs, 0), (t, th) => {
      const w = prof([0.026, 0.034, 0.04, 0.043, 0.042], t) * hs, k = prof([0.016, 0.018, 0.017, 0.015, 0.012], t) * hs;
      return [Math.cos(th) * k, Math.sin(th) * w];
    }, { cols: 16, rows: 6, capA: 0.6, capB: 0.5 }));
    const tips = [];
    const fz = [0.028, 0.0095, -0.0095, -0.026], fl = [0.043, 0.047, 0.044, 0.035], fr = [0.0092, 0.0096, 0.009, 0.0079];
    const finger = (p, dir, segs, rad, axisFn, bends) => {
      for (let j = 0; j < segs.length; j++) {
        dir.applyAxisAngle(axisFn(dir), bends[j]);
        const q = p.clone().addScaledVector(dir, segs[j]);
        const r0 = rad, r1 = rad * 0.86;
        gs.push(tube(p, q, (t, th) => { const rr = lerp(r0, r1, t); return [Math.cos(th) * rr * 0.9, Math.sin(th) * rr]; }, { cols: 7, rows: 1, capRows: 2, front: V(1, 0, 0) }));
        p = q;
        rad = r1;
      }
      tips.push(p.clone());
    };
    for (let k = 0; k < 4; k++) {
      const p = V(0, -0.084 * hs, fz[k] * hs);
      const dir = V(0, -1, (k - 1.5) * 0.07).normalize();
      const L3 = fl[k] * hs;
      finger(p, dir, [L3 * 0.5, L3 * 0.31, L3 * 0.25], fr[k] * hs, () => V(0, 0, 1), curl.map((c) => -s * c * r.range(0.8, 1.2)));
    }
    const tdir = V(-s * 0.3, -0.6, 0.74).normalize();
    finger(V(-s * 0.005, -0.022 * hs, 0.03 * hs), tdir, [0.032 * hs, 0.028 * hs, 0.023 * hs], 0.0115 * hs, (d) => V().crossVectors(d, V(-s, -0.3, 0)).normalize(), [0, 0.35, 0.3]);
    return { geo: mergeGeometries(gs), tips };
  };
  for (const s of [1, -1]) {
    const Ls = s > 0 ? 'L' : 'R';
    const ua = B('upperArm' + Ls), fa = B('forearm' + Ls), hd = B('hand' + Ls);
    const uDir = ua.tail.clone().sub(ua.head).normalize();
    const up = tube(ua.head.clone().addScaledVector(uDir, -0.012), ua.tail, upperShape, { cols: 16, rows: 12, capA: 0.55, capB: 0.3 });
    displace(up, (x, y, z, nx, ny, nz) => {
      const dd = (x - ua.head.x - s * 0.03) ** 2 + (y - ua.head.y + 0.04) ** 2 + (z - ua.head.z) ** 2;
      return (0.004 + P.musc * 0.012) * G(dd, 0.045) * Math.max(0, nx * s) // 三角肌
        + (0.003 + P.musc * 0.01) * G((y - lerp(ua.head.y, ua.tail.y, 0.5)) ** 2, 0.06) * Math.max(0, nz) // 二頭肌
        + 0.004 * G((y - ua.tail.y) ** 2 + (z - ua.tail.z + 0.03) ** 2, 0.02) * Math.max(0, -nz) // 手肘
        + woundDisp(x, y, z) + fbm(x * 18, y * 18, z * 18, 2) * 0.002 + veinAt(x, y, z) * 0.0015;
    });
    add(up, 'skin', ['clav' + Ls, 'upperArm' + Ls, 'forearm' + Ls], skinPainter('arm'));
    const fo = tube(fa.head.clone().lerp(fa.tail, -0.04), fa.tail, foreShape, { cols: 16, rows: 10, capA: 0.3 });
    displace(fo, (x, y, z, nx, ny, nz) => (0.003 + P.musc * 0.008) * G((y - lerp(fa.head.y, fa.tail.y, 0.25)) ** 2, 0.06) + woundDisp(x, y, z) + fbm(x * 18, y * 18, z * 18, 2) * 0.002 + veinAt(x, y, z) * 0.002);
    add(fo, 'skin', ['upperArm' + Ls, 'forearm' + Ls, 'hand' + Ls], skinPainter('arm', (x, y, z, nx, ny, nz, i, c, wet) => { if (gloves.v) c.lerp(gloves.v, sstep(fa.tail.y + 0.06, fa.tail.y + 0.03, y)); return wet; }));
    const h = handPieces(s);
    const hDir = hd.tail.clone().sub(hd.head).normalize();
    const m = new THREE.Matrix4().makeRotationFromQuaternion(new THREE.Quaternion().setFromUnitVectors(V(0, -1, 0), hDir)).setPosition(hd.head);
    h.geo.applyMatrix4(m);
    const tips = h.tips.map((t) => t.applyMatrix4(m));
    smoothNormals(h.geo);
    add(h.geo, 'skin', (x, y, z) => (y > hd.head.y - 0.03 ? autoList(rig, ['forearm' + Ls, 'hand' + Ls], x, y, z) : [['hand' + Ls, 1]]), skinPainter('hand', (x, y, z, nx, ny, nz, i, c, wet) => {
      if (gloves.v) { c.lerp(gloves.v, 0.92); return wet * 0.5; }
      let tn = 9;
      for (const t of tips) tn = Math.min(tn, (x - t.x) ** 2 + (y - t.y) ** 2 + (z - t.z) ** 2);
      c.lerp(col('#2a2418'), sstep(0.0002, 0.00003, tn) * 0.85); // 黑指甲
      return wet;
    }));
  }

  // ---- 腿與腳 ----
  const footShape = (k, dn) => (t, th) => {
    const c = Math.cos(th), s = Math.sin(th);
    return [c * prof([0.03, 0.034, 0.038, 0.043, 0.046, 0.045, 0.036], t) * k, s > 0 ? s * prof([0.03, 0.046, 0.052, 0.042, 0.03, 0.022, 0.015], t) * k : s * (prof([0.034, 0.033, 0.03, 0.026, 0.022, 0.018, 0.012], t) * k + dn)];
  };
  const feet = {};
  if (!legless) {
    for (const s of [1, -1]) {
      const Ls = s > 0 ? 'L' : 'R';
      const th = B('thigh' + Ls), sh = B('shin' + Ls), an = sh.tail;
      const tg = tube(th.head.clone().add(V(0, 0.05, 0)), th.tail, thighShape, { cols: 18, rows: 12, capB: 0.3 });
      displace(tg, (x, y, z, nx, ny, nz) => (0.004 + P.musc * 0.012) * G((y - 0.75) ** 2, 0.1) * Math.max(0, nz)
        + 0.009 * G((x - th.tail.x) ** 2 + (y - th.tail.y - 0.01) ** 2 + (z - th.tail.z - 0.05) ** 2, 0.028) // 膝蓋骨
        + woundDisp(x, y, z) + fbm(x * 14, y * 14, z * 14, 2) * 0.003);
      add(tg, 'skin', ['hips', 'thigh' + Ls, 'shin' + Ls], skinPainter('leg'));
      const sg = tube(sh.head.clone().lerp(sh.tail, -0.04), an.clone().add(V(0, -0.015, 0)), shinShape, { cols: 16, rows: 12, capA: 0.3 });
      displace(sg, (x, y, z, nx, ny, nz) => (0.008 + P.musc * 0.01) * G((y - 0.39) ** 2, 0.07) * Math.max(0, -nz) + woundDisp(x, y, z) + fbm(x * 14, y * 14, z * 14, 2) * 0.003 + veinAt(x, y, z) * 0.0015);
      add(sg, 'skin', ['thigh' + Ls, 'shin' + Ls, 'foot' + Ls], skinPainter('leg'));
      const yaw = s * 0.12;
      const fA = an.clone().add(V(Math.sin(yaw) * -0.07, -0.042, -0.075 * Math.cos(yaw)));
      const fB = an.clone().add(V(Math.sin(yaw) * 0.2, -0.057, 0.2 * Math.cos(yaw)));
      feet[Ls] = { A: fA, B: fB, Ls };
    }
  }
  const barefoot = (Ls, sock) => {
    const f = feet[Ls];
    const g = tube(f.A, f.B, footShape(1, 0), { cols: 16, rows: 14, front: V(0, 1, 0) });
    displace(g, (x, y, z, nx, ny, nz) => 0.004 * Math.max(0, Math.cos((x - f.B.x) * TAU / 0.019)) * sstep(f.B.z - 0.05, f.B.z - 0.02, z) * Math.max(0, ny + 0.5) + fbm(x * 30, y * 30, z * 30, 2) * 0.0015);
    add(g, 'skin', ['shin' + Ls, 'foot' + Ls], skinPainter('foot', (x, y, z, nx, ny, nz, i, c, wet) => {
      if (sock) { c.copy(sock).multiplyScalar(0.85 + fbm(x * 40, y * 40, z * 40, 2) * 0.3); c.lerp(DIRT, sstep(0.025, 0.0, y) * 0.8); return 0; }
      c.lerp(DIRT, sstep(0.02, 0.0, y) * 0.9);
      return wet;
    }));
  };
  const shoe = (Ls, style) => {
    const f = feet[Ls];
    const g = tube(f.A.clone().add(V(0, 0, -0.008)), f.B.clone().add(V(0, 0, 0.012)), footShape(1.13, 0.008), { cols: 18, rows: 14, front: V(0, 1, 0) });
    const up = col({ sneaker: r.pick(['#d8d8d0', '#3a3a3a', '#6a6a70']), clog: r.pick(['#d8d8e0', '#5a8aa8', '#a86a7a']), leather: '#1c1814', boot: '#141414' }[style]);
    const sole = col(style === 'sneaker' || style === 'clog' ? '#d0d0c8' : '#0e0e0e');
    add(g, 'gear', ['shin' + Ls, 'foot' + Ls], (x, y, z, nx, ny, nz, i, out) => {
      const c = tc.copy(y < 0.024 ? sole : up);
      c.lerp(DIRT, sstep(0.2, 0.6, fbm(x * 15, y * 15, z * 15, 3)) * 0.5 + (y < 0.024 ? 0.3 : 0));
      if (y < 0.024 && style !== 'sneaker') c.multiplyScalar(0.6);
      out[0] = c.r; out[1] = c.g; out[2] = c.b; out[3] = 1;
    });
    if (style === 'boot') {
      const sh = B('shin' + (Ls === 'L' ? 'L' : 'R'));
      const bg = tube(sh.tail.clone().add(V(0, -0.03, 0)), sh.tail.clone().lerp(sh.head, 0.32), (t, th) => { const q = prof(shinR, 1 - t * 0.32) + 0.012; return [Math.cos(th) * q, Math.sin(th) * q * 1.08]; }, { cols: 18, rows: 4, capA: 0, capB: 0 });
      add(bg, 'gear', ['shin' + Ls, 'foot' + Ls], (x, y, z, nx, ny, nz, i, out) => { const v = 0.8 + fbm(x * 20, y * 20, z * 20, 2) * 0.4; out[0] = up.r * v; out[1] = up.g * v; out[2] = up.b * v; out[3] = 1; });
    }
  };

  // ---- 服裝 ----
  const tc2 = new THREE.Color();
  const clothPaint = (g, o) => {
    const base = col(o.color), edge = g.userData.edge, k = r() * 50;
    const fade = o.fade ? col(o.fade) : null;
    return (x, y, z, nx, ny, nz, i, out) => {
      const c = tc2.copy(base);
      if (fade) c.lerp(fade, sstep(-0.1, 0.5, fbm(x * 4 + k, y * 2, z * 4, 3)) * 0.7);
      c.multiplyScalar(0.5 + fbm(x * 7 + k, y * 7, z * 7, 3) * 0.2);
      if (o.pattern) c.multiplyScalar(1 - 0.12 * o.pattern(x, y, z));
      c.lerp(DIRT, clamp(sstep(0.1, 0.55, fbm(x * 2.3 + 11, y * 2.3, z * 2.3 + k, 4)) * o.dirt + sstep(0.75, 0.15, y) * 0.3 * o.dirt, 0, 0.85));
      const b = bloodAmt(L.clothBlood, x, y, z);
      if (b > 0) c.lerp(L.fresh > 0.5 ? BLOOD : BLOOD_DRY, b * 0.85);
      let a = 1;
      if (edge && edge[i] < 0.05) {
        const e = edge[i] + fbm(x * 30, y * 30, z * 30, 2) * (o.hem ?? 0.02) * 0.9;
        a = sstep(0, o.hem ?? 0.02, e);
        c.multiplyScalar(lerp(0.65, 1, sstep(0, 0.03, e)));
      }
      const h = fbm(x * 6 + k * 3, y * 6, z * 6, 3);
      a *= sstep(o.wear, o.wear - 0.06, h);
      c.multiplyScalar(lerp(0.6, 1, sstep(o.wear - 0.02, o.wear - 0.1, h))); // 破洞邊緣磨黑
      if (o.cut) a *= o.cut(x, y, z, nx, ny, nz);
      out[0] = c.r; out[1] = c.g; out[2] = c.b; out[3] = a;
    };
  };
  const offset = (shape, off) => (t, th) => { const q = shape(t, th); const l = Math.hypot(q[0], q[1]) || 1; const k = (l + off) / l; return [q[0] * k, q[1] * k]; };
  const folds = (amp) => (x, y, z) => fbm(x * 9, y * 9, z * 9, 3) * amp + fbm(x * 3, y * 22, z * 3, 2) * amp * 0.5;
  // 上衣:軀幹段 y0~y1 + 袖子(sleeve:0 無袖,0.4 短袖,1 長袖到手腕)
  const top = (o) => {
    const off = o.off ?? 0.012;
    const g = tube(V(0, T0, 0), V(0, T1, 0), offset(tShape, off), { cols: 40, rows: 24, t0: ty(o.y0), t1: ty(o.y1 ?? T1), capA: 0, capB: 0, hemB: false });
    displace(g, (x, y, z, nx, ny, nz) => torsoDisp(x, y, z, nx, ny, nz) * (o.tight ?? 0.9) + folds(o.loose ?? 0.004)(x, y, z));
    add(g, 'cloth', torsoW, clothPaint(g, o));
    if (!o.sleeve) return;
    for (const s of [1, -1]) {
      const Ls = s > 0 ? 'L' : 'R';
      const ua = B('upperArm' + Ls), fa = B('forearm' + Ls);
      const uDir = ua.tail.clone().sub(ua.head).normalize();
      const len1 = Math.min(1, o.sleeve / 0.45);
      const sg = tube(ua.head.clone().addScaledVector(uDir, -0.03), ua.tail, offset(upperShape, off + 0.004), { cols: 16, rows: 8, t1: len1, capA: 0, capB: 0, hemA: false, hemB: o.sleeve <= 0.45 });
      displace(sg, folds(0.004));
      add(sg, 'cloth', ['clav' + Ls, 'upperArm' + Ls, 'forearm' + Ls], clothPaint(sg, o));
      if (o.sleeve > 0.45) {
        const fg = tube(fa.head.clone().addScaledVector(uDir, -0.03), fa.tail, offset(foreShape, off + 0.006), { cols: 16, rows: 8, t1: Math.min(0.95, (o.sleeve - 0.45) / 0.5), capA: 0, capB: 0, hemA: false });
        displace(fg, folds(0.005));
        add(fg, 'cloth', ['upperArm' + Ls, 'forearm' + Ls, 'hand' + Ls], clothPaint(fg, o));
      }
    }
  };
  // 下身:骨盆段 + 雙腿(len:0.3 短褲 / 1 長褲)
  const bottom = (o) => {
    const off = o.off ?? 0.013;
    const g = tube(V(0, T0, 0), V(0, T1, 0), offset(tShape, off), { cols: 40, rows: 8, t0: 0, t1: ty(o.waist ?? 1.03), capA: 0.6, capB: 0, hemB: false });
    displace(g, (x, y, z, nx, ny, nz) => torsoDisp(x, y, z, nx, ny, nz) * 0.8 + folds(0.003)(x, y, z));
    add(g, 'cloth', torsoW, clothPaint(g, o));
    if (legless) return;
    for (const s of [1, -1]) {
      const Ls = s > 0 ? 'L' : 'R';
      const th = B('thigh' + Ls), sh = B('shin' + Ls);
      const tg = tube(th.head.clone().add(V(0, 0.07, 0)), th.tail, offset(thighShape, off + 0.004), { cols: 18, rows: 10, t1: Math.min(1, o.len / 0.5), capA: 0, capB: 0, hemA: false, hemB: o.len <= 0.5 });
      displace(tg, folds(o.loose ?? 0.005));
      add(tg, 'cloth', ['hips', 'thigh' + Ls, 'shin' + Ls], clothPaint(tg, o));
      if (o.len > 0.5) {
        const sg = tube(sh.head.clone().add(V(0, 0.03, 0)), sh.tail, offset(shinShape, off + 0.01), { cols: 16, rows: 10, t1: Math.min(0.97, (o.len - 0.5) / 0.5), capA: 0, capB: 0, hemA: false });
        displace(sg, folds((o.loose ?? 0.005) * 1.2));
        add(sg, 'cloth', ['thigh' + Ls, 'shin' + Ls, 'foot' + Ls], clothPaint(sg, o));
      }
    }
  };
  // 裙擺式(病人袍、白袍下襬)
  const skirt = (o) => {
    const y0 = 1.04, y1 = o.hem;
    const g = tube(V(0, y0, 0), V(0, y1, 0), (t, th) => {
      const w = (0.178 * P.hip * lerp(1, P.fat, 0.7) + 0.02 + t * 0.05), df = 0.115 * P.fat + 0.02 + t * 0.03 + P.belly * 0.05 * (1 - t), db = 0.12 * P.fat + 0.02 + t * 0.03;
      const c = Math.cos(th), s = Math.sin(th);
      return [c * w, s > 0 ? s * df : s * db];
    }, { cols: 40, rows: 12, capA: 0, capB: 0, hemA: false });
    displace(g, (x, y, z) => fbm(x * 8, y * 4, z * 8, 3) * 0.012 + Math.sin(Math.atan2(x, z) * 9 + fbm(x * 3, y * 3, z * 3, 2) * 4) * 0.006 * sstep(y0, y1, y));
    add(g, 'cloth', (x, y, z) => autoList(rig, legless ? ['hips'] : ['hips', 'thighL', 'thighR'], x, y + 0.08, z), clothPaint(g, o));
  };

  const pickC = (a) => r.pick(a);
  let shoes = 'bare', sock = null;
  const OUT = {
    gown: () => { // 病人袍:後背開口、短袖、及膝
      const color = pickC(['#8fb2c2', '#a3bfae', '#9aa9c4', '#b5b3a4']);
      const pattern = (x, y, z) => (Math.sin(x * 260) * Math.sin(y * 260) > 0.6 ? 1 : 0);
      const o = { color, dirt: r.range(0.3, 0.6), wear: r.range(0.2, 0.32), hem: 0.03, pattern, off: 0.016, loose: 0.006,
        cut: (x, y, z, nx, ny, nz) => (z < -0.02 ? sstep(0.018, 0.04, Math.abs(x + noise3(y * 8, 0, 0) * 0.02)) : 1) };
      top({ ...o, y0: 1.0, y1: 1.5, sleeve: 0.3 });
      if (!legless) skirt({ ...o, hem: r.range(0.55, 0.66) });
      if (r.chance(0.5)) sock = col(pickC(['#8a9aa8', '#b0a890', '#6a8a9a']));
    },
    scrubs: (c) => {
      const color = c || pickC(['#3f7f86', '#4d6fa0', '#5a8a6a', '#7a5f8f', '#2f4f6f']);
      top({ color, y0: 0.93, sleeve: 0.33, dirt: 0.3, wear: r.range(0.26, 0.36), loose: 0.005,
        cut: (x, y, z) => (z > 0 ? sstep(0.004, 0.012, Math.abs(x) - (y - 1.36) * 0.55) : 1) });
      bottom({ color, len: 1, dirt: 0.35, wear: r.range(0.26, 0.36), loose: 0.007, off: 0.016 });
      shoes = r.pick(['clog', 'sneaker']);
    },
    doctor: () => {
      top({ color: pickC(['#8aa0b8', '#c8c0b0', '#6a7a6a']), y0: 0.95, sleeve: 0.95, dirt: 0.2, wear: 0.4, off: 0.01 });
      bottom({ color: pickC(['#2f3238', '#3d3f46', '#4a4538']), len: 1, dirt: 0.3, wear: 0.38 });
      const coat = { color: '#d9d7cd', dirt: r.range(0.35, 0.6), wear: r.range(0.25, 0.33), hem: 0.03, off: 0.026, loose: 0.006,
        cut: (x, y, z) => (z > 0 ? sstep(0.006, 0.02, Math.abs(x) - (y > 1.3 ? (y - 1.3) * 0.9 + 0.012 : 0.012)) : 1) };
      top({ ...coat, y0: 1.0, y1: 1.505, sleeve: 0.92 });
      if (!legless) skirt({ ...coat, hem: r.range(0.52, 0.6), cut: (x, y, z) => (z > 0 ? sstep(0.006, 0.02, Math.abs(x) - 0.012) : 1) });
      // 名牌
      add(prim(new THREE.BoxGeometry(0.05, 0.03, 0.004), mat4(V(0.085 * P.sw, 1.36, 0.13 * P.fat), [-0.15, 0.2, 0])), 'gear', 'chest', (x, y, z, nx, ny, nz, i, out) => { out[0] = 0.7; out[1] = 0.72; out[2] = 0.75; out[3] = 1; });
      // 聽診器
      const st = prim(new THREE.TorusGeometry(0.075 * P.neck, 0.0045, 6, 24, Math.PI * 1.1), mat4(V(0, 1.43, 0.025), [1.25, 0, -Math.PI * 0.05 - Math.PI * 0.5 + 0.0]));
      add(st, 'gear', ['chest', 'neck'], (x, y, z, nx, ny, nz, i, out) => { out[0] = 0.02; out[1] = 0.02; out[2] = 0.022; out[3] = 1; });
      shoes = 'leather';
    },
    surgeon: () => {
      OUT.scrubs(pickC(['#5e8a74', '#4f7f8f']));
      gloves.v = col('#7d9fc4');
      // 手術帽
      const cap = hg.geo.clone();
      const p = cap.attributes.position.array, n = cap.attributes.normal.array, keep = [];
      for (let i = 0; i < p.length / 3; i++) { const o = 0.008; p[i * 3] += n[i * 3] * o; p[i * 3 + 1] += n[i * 3 + 1] * o; p[i * 3 + 2] += n[i * 3 + 2] * o; }
      const idx = cap.index.array;
      const inCap = (i) => p[i * 3 + 1] - HC.y > (p[i * 3 + 2] - HC.z > 0 ? 0.062 : 0.0);
      for (let k = 0; k < idx.length; k += 3) if (inCap(idx[k]) && inCap(idx[k + 1]) && inCap(idx[k + 2])) keep.push(idx[k], idx[k + 1], idx[k + 2]);
      cap.setIndex(keep);
      add(cap, 'cloth', 'head', clothPaint(cap, { color: '#8fb6c8', dirt: 0.2, wear: 0.4 }));
      // 掛在下巴的口罩
      const mk = tube(V(0, HC.y - 0.105, HC.z - 0.02), V(0, HC.y - 0.06, HC.z - 0.01), (t, th) => [Math.cos(th) * 0.068 * H.w, Math.sin(th) > 0 ? Math.sin(th) * 0.098 : Math.sin(th) * 0.07], { cols: 30, rows: 3, capA: 0, capB: 0 });
      add(mk, 'cloth', ['neck', 'head'], clothPaint(mk, { color: '#c8dce6', dirt: 0.25, wear: 0.45, cut: (x, y, z) => (z > HC.z - 0.03 ? 1 : 0) }));
    },
    civilian: () => {
      const long = r.chance(0.4);
      top({ color: pickC(['#7a2a26', '#3a3d42', '#8a7a3a', '#4a5a6a', '#6a6a62', '#2a3a2a', '#5a3a5a']), y0: 0.93, sleeve: long ? 0.95 : 0.3, dirt: 0.4, wear: r.range(0.18, 0.3), loose: 0.006,
        cut: (x, y, z) => (z > 0 ? sstep(0.004, 0.012, Math.hypot(x, (y - 1.52) * 1.4) - 0.07) : 1) });
      bottom({ color: pickC(['#33475f', '#3b4250', '#2a3442']), fade: '#6a7f9a', len: r.chance(0.8) ? 1 : 0.32, dirt: 0.45, wear: r.range(0.2, 0.3), off: 0.012, waist: 1.0 });
      shoes = r.chance(0.7) ? 'sneaker' : 'bare';
    },
    janitor: () => {
      const color = pickC(['#5a6670', '#5c5e46', '#4a5560']);
      top({ color, y0: 0.9, sleeve: 0.95, dirt: 0.6, wear: r.range(0.22, 0.32), loose: 0.007, off: 0.016 });
      bottom({ color, len: 1, dirt: 0.6, wear: r.range(0.22, 0.32), loose: 0.007, off: 0.017 });
      shoes = 'boot';
    },
    guard: () => { // 巨屍:撕裂的保全制服 + 戰術背心
      top({ color: '#283246', y0: 0.93, sleeve: 0.12, dirt: 0.5, wear: 0.24, hem: 0.04, off: 0.012, tight: 1 });
      bottom({ color: '#1f2125', len: 1, dirt: 0.5, wear: 0.26, off: 0.016, loose: 0.007 });
      const vest = tube(V(0, T0, 0), V(0, T1, 0), offset(tShape, 0.024), { cols: 40, rows: 16, t0: ty(1.02), t1: ty(1.44), capA: 0, capB: 0 });
      displace(vest, (x, y, z, nx, ny, nz) => torsoDisp(x, y, z, nx, ny, nz) * 0.85 + 0.014 * sstep(0.2, 0.5, Math.max(0, nz)) * sstep(1.06, 1.09, y) * (1 - sstep(1.17, 1.2, y)) * Math.max(0, Math.cos(x * TAU / 0.09)));
      const vc = col('#23272a');
      add(vest, 'gear', torsoW, (x, y, z, nx, ny, nz, i, out) => {
        const c = tc.copy(vc).multiplyScalar(0.8 + fbm(x * 20, y * 20, z * 20, 2) * 0.4);
        c.lerp(DIRT, sstep(0.2, 0.6, fbm(x * 3, y * 3, z * 3, 3)) * 0.5);
        if (Math.abs(y - 1.38) < 0.012 && nz > 0.3) c.setRGB(0.16, 0.15, 0.09); // 反光條
        const b = bloodAmt(L.clothBlood, x, y, z); if (b > 0) c.lerp(BLOOD_DRY, b * 0.7);
        out[0] = c.r; out[1] = c.g; out[2] = c.b; out[3] = 1;
      });
      // 腰帶 + 手腕上的斷銬
      add(prim(new THREE.TorusGeometry(1, 0.11, 6, 32), mat4(V(0, 1.0, 0.004), [Math.PI / 2, 0, 0], [0.17 * P.hip * P.fat + 0.02, 0.125 * P.fat + 0.02, 0.25])), 'gear', 'hips', (x, y, z, nx, ny, nz, i, out) => { out[0] = 0.02; out[1] = 0.02; out[2] = 0.02; out[3] = 1; });
      for (const s of [1, -1]) {
        const fa = B('forearm' + (s > 0 ? 'L' : 'R'));
        const p = fa.head.clone().lerp(fa.tail, 0.85);
        add(prim(new THREE.TorusGeometry(prof(foreR, 0.85) + 0.012, 0.009, 6, 18), mat4(p, [Math.PI / 2, 0, 0])), 'gear', 'forearm' + (s > 0 ? 'L' : 'R'), (x, y, z, nx, ny, nz, i, out) => { out[0] = 0.35; out[1] = 0.33; out[2] = 0.3; out[3] = 1; });
        for (let k = 0; k < 3; k++) add(prim(new THREE.TorusGeometry(0.014, 0.004, 5, 10), mat4(p.clone().add(V(s * 0.02, -0.03 - k * 0.025, 0.02)), [0, k % 2 ? Math.PI / 2 : 0, 0])), 'gear', 'forearm' + (s > 0 ? 'L' : 'R'), (x, y, z, nx, ny, nz, i, out) => { out[0] = 0.3; out[1] = 0.28; out[2] = 0.25; out[3] = 1; });
      }
      shoes = 'boot';
    },
    bloat: () => { // 撐裂的病人袍 + 內褲
      top({ color: '#a8b3a0', y0: 1.1, y1: 1.5, sleeve: 0.2, dirt: 0.7, wear: 0.15, hem: 0.04, off: 0.02,
        cut: (x, y, z) => (z > 0 ? sstep(0.02, 0.05, Math.abs(x) - 0.07 * (1 - sstep(1.2, 1.4, y))) : 1) });
      bottom({ color: '#bab4a0', len: 0.18, dirt: 0.8, wear: 0.3, off: 0.012, waist: 0.99 });
    },
    rags: () => {
      top({ color: pickC(['#8fb2c2', '#6a6a62', '#5a4a3a']), y0: 1.0, y1: 1.5, sleeve: 0.25, dirt: 0.8, wear: 0.12, hem: 0.05, off: 0.015 });
      if (!legless) bottom({ color: pickC(['#3b4250', '#4a4538']), len: r.range(0.6, 1), dirt: 0.8, wear: 0.16, hem: 0.05 });
    },
  };
  const OUTFIT_BY_TYPE = {
    walker: ['gown', 'gown', 'gown', 'doctor', 'scrubs', 'civilian', 'janitor', 'surgeon'],
    runner: ['scrubs', 'surgeon', 'civilian', 'civilian', 'gown'],
    crawler: ['rags', 'gown'],
    bloater: ['bloat'],
    brute: ['guard'],
  };
  const outfit = opt.outfit || r.pick(OUTFIT_BY_TYPE[type]);
  if (!opt.nude) OUT[outfit]();
  if (!legless) for (const Ls of ['L', 'R']) (shoes === 'bare' ? barefoot(Ls, sock) : shoe(Ls, shoes));

  // ---- 斷肢殘端:脊椎與內臟 ----
  if (legless) {
    const sp = tube(V(0, 1.02, -0.07), V(0.01, 0.86, -0.085), (t, th) => [Math.cos(th) * 0.014, Math.sin(th) * 0.017], { cols: 8, rows: 8 });
    displace(sp, (x, y) => 0.004 * Math.max(0, Math.sin(y * TAU / 0.03)));
    add(sp, 'bone', 'hips', (x, y, z, nx, ny, nz, i, out) => { const c = tc.copy(BONE).lerp(FLESH, sstep(0.95, 1.0, y) * 0.6); out[0] = c.r; out[1] = c.g; out[2] = c.b; out[3] = 1; });
    for (let k = 0; k < 4; k++) {
      const start = V(r.range(-0.07, 0.07), 1.0, r.range(-0.02, 0.07));
      const pts = [start];
      let p = start.clone(), d = V(r.range(-0.3, 0.3), -1, r.range(0, 0.5)).normalize();
      for (let j = 0; j < 6; j++) { d.add(V(r.range(-0.4, 0.4), -0.2, r.range(0, 0.4))).normalize(); p = p.clone().addScaledVector(d, r.range(0.04, 0.07)); pts.push(p); }
      const curve = new THREE.CatmullRomCurve3(pts);
      const ig = prim(new THREE.TubeGeometry(curve, 24, r.range(0.011, 0.017), 8, false));
      displace(smoothNormals(ig), (x, y, z) => 0.003 * Math.sin(y * 200 + x * 100));
      add(ig, 'skin', 'hips', (x, y, z, nx, ny, nz, i, out) => { const c = tc.copy(col('#7a3a38')).lerp(FLESH_DARK, sstep(0.2, 0.6, fbm(x * 30, y * 30, z * 30, 2) + 0.4) * 0.6); out[0] = c.r; out[1] = c.g; out[2] = c.b; out[3] = 1; });
    }
  }

  // ---- 膿包(膿腫者) ----
  if (type === 'bloater') {
    for (let k = 0; k < 46; k++) {
      const s = surf(r.chance(0.7) ? 'torso' : r.pick(['arm', 'neck', 'arm']));
      const rad = r.range(0.006, 0.02) * (s.p.y < 1.25 && s.n.z > 0 ? 1.3 : 1);
      L.pustules.push({ c: s.p, r: rad });
      const g = prim(new THREE.SphereGeometry(rad, 10, 8), mat4(s.p.clone().addScaledVector(s.n, rad * 0.25 + (s.p.y < 1.3 && s.n.z > 0 ? P.belly * 0.06 * G(s.p.x ** 2 + (s.p.y - 1.09) ** 2, 0.14) : 0))));
      add(g, 'glow', s.p.y > 1.4 ? ['chest', 'neck', 'upperArmL', 'upperArmR'] : ['spine', 'chest', 'upperArmL', 'upperArmR', 'forearmL', 'forearmR'], (x, y, z, nx, ny, nz, i, out) => { const v = 0.7 + fbm(x * 80, y * 80, z * 80, 2) * 0.6; out[0] = v * 0.8; out[1] = v * 0.75; out[2] = v * 0.35; out[3] = 1; });
    }
  }

  // ---- 收尾:上色、權重、合併 ----
  for (const pc of pieces) {
    const g = pc.geo;
    if (!g.attributes.normal) g.computeVertexNormals();
    paint(g, pc.painter);
    skin(g, rig, pc.weights);
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv', 'color', 'skinIndex', 'skinWeight'].includes(k)) g.deleteAttribute(k);
    g.userData = {};
  }
  const { geo, used } = assemble(pieces, SLOTS);
  geo.scale(P.s, P.s, P.s);
  for (const b of rig.bones) { b.head.multiplyScalar(P.s); b.tail.multiplyScalar(P.s); }
  HC.multiplyScalar(P.s);
  geo.computeBoundingSphere(); // 實例化時直接給 SkinnedMesh,免得 three 逐頂點蒙皮重算(每隻殭屍 ~40k 頂點、數 MB 垃圾)
  return {
    type, geometry: geo, slots: used, rig, P,
    legT: rig.bones[rig.index.thighL].head.distanceTo(rig.bones[rig.index.thighL].tail),
    legS: rig.bones[rig.index.shinL].head.distanceTo(rig.bones[rig.index.shinL].tail),
    hitboxes: hitboxes(rig, P, type),
    mouth: V(0, HC.y - 0.05 * P.s, HC.z + 0.09 * P.s),
  };
}

// ---------- 命中判定盒(隱形,掛在骨骼上) ----------
function hitboxes(rig, P, type) {
  const B = (n) => rig.bones[rig.index[n]];
  const s = P.s, out = [];
  const box = (bone, center, size, part) => out.push({ bone, kind: 'box', pos: center.clone().sub(B(bone).head), scl: size, part });
  const cyl = (bone, a, b, rad, part) => {
    const dir = b.clone().sub(a), len = dir.length();
    out.push({ bone, kind: 'cyl', pos: a.clone().add(b).multiplyScalar(0.5).sub(B(bone).head), quat: new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), dir.normalize()), scl: V(rad, len, rad), part });
  };
  const HC = rig.HC;
  out.push({ bone: 'head', kind: 'sphere', pos: HC.clone().sub(B('head').head).add(V(0, -0.01 * s, 0.006 * s)), scl: V(0.082, 0.122, 0.108).multiplyScalar(P.head * s * (type === 'brute' ? 1.1 : 1)), part: 'head' });
  cyl('neck', B('neck').head, B('neck').head.clone().lerp(B('neck').tail, 0.6), 0.045 * P.neck * s, 'body');
  box('chest', V(0, 1.375 * s, 0.0), V(0.36 * P.sw * P.fat * s, 0.22 * s, 0.22 * P.fat * s + 0.03), type === 'brute' ? 'armor' : 'body');
  box('spine', V(0, 1.17 * s, 0.01 + P.belly * 0.05), V(0.3 * P.fat * P.hip * s, 0.18 * s, (0.2 * P.fat + P.belly * 0.12) * s), type === 'brute' ? 'armor' : 'body');
  if (!P.legless) box('hips', V(0, 0.95 * s, 0), V(0.34 * P.hip * P.fat * s, 0.2 * s, 0.22 * P.fat * s), 'body');
  else box('hips', V(0, 1.02 * s, 0), V(0.3 * s, 0.1 * s, 0.2 * s), 'body');
  for (const L of ['L', 'R']) {
    const g = P.g * s;
    cyl('upperArm' + L, B('upperArm' + L).head, B('upperArm' + L).tail, 0.05 * g, 'arm');
    cyl('forearm' + L, B('forearm' + L).head, B('hand' + L).head, 0.04 * g, 'arm');
    cyl('hand' + L, B('hand' + L).head, B('hand' + L).tail, 0.04 * g, 'arm');
    if (P.legless) continue;
    cyl('thigh' + L, B('thigh' + L).head, B('thigh' + L).tail, 0.078 * g, 'leg');
    cyl('shin' + L, B('shin' + L).head, B('shin' + L).tail, 0.055 * g, 'leg');
  }
  return out;
}

// ---------- 變體快取 ----------
const PER_TYPE = { walker: 6, runner: 4, crawler: 4, bloater: 3, brute: 3 };
const SEEDS = { walker: 1000, runner: 2000, crawler: 3000, bloater: 4000, brute: 5000 };
const cache = {};
// 變體 k 用固定種子 → 每台機器、每個執行緒建出來都一樣(連線時可用 getVariant(type, k) 同步外觀)
// 有 Worker:prewarm() 一次把全部變體平行丟給 Worker 池,主執行緒只組 BufferGeometry + 綁材質;
// getVariant 取已建好的,一個都還沒好才同步建(備援)。沒有 Worker:完全照舊在主執行緒同步建。
const seedOf = (type, k) => SEEDS[type] + k * 7919;
const vstat = { worker: 0, sync: 0, syncMs: 0, pending: 0, t0: 0, tDone: 0 };
const inflight = {};
let pool;
function modelPool() {
  if (pool === undefined) pool = caps.useWorkers ? createPool(() => new Worker(new URL('./model.worker.js', import.meta.url), { type: 'module' }), { name: 'model', max: 6, idleMs: 8000 }) : null;
  return pool && pool.available ? pool : null;
}
function store(type, k, v) {
  v.k = k;
  (cache[type] || (cache[type] = []))[k] = v;
  if (!vstat.tDone && readyCount() >= TOTAL) vstat.tDone = performance.now();
  return v;
}
function buildSync(type, k) {
  const t = performance.now();
  if (!vstat.t0) vstat.t0 = t;
  const v = store(type, k, buildVariant(type, seedOf(type, k)));
  vstat.sync++;
  vstat.syncMs += performance.now() - t;
  return v;
}
function request(type, k) {
  const key = type + ':' + k;
  if (cache[type]?.[k] || inflight[key]) return inflight[key];
  const p = modelPool();
  if (!p) return null;
  vstat.pending++;
  if (!vstat.t0) vstat.t0 = performance.now();
  return (inflight[key] = p.call('build', [type, seedOf(type, k)]).then((data) => {
    if (!cache[type]?.[k]) { store(type, k, bindMaterials(unpack(data))); vstat.worker++; }
    return cache[type][k];
  }, (e) => { if (!p.failed) console.warn('[model] worker 建模失敗,改同步', e.message); return null; }).finally(() => { vstat.pending--; delete inflight[key]; }));
}
export function getVariant(type, k) {
  const list = cache[type] || (cache[type] = []);
  const n = PER_TYPE[type] || 1;
  if (k != null) { k = ((k % n) + n) % n; return list[k] || buildSync(type, k); } // 指定變體
  let ready = 0, miss = -1;
  for (let i = 0; i < n; i++) if (list[i]) ready++; else if (miss < 0) miss = i;
  if (ready && modelPool()) {
    for (let i = 0; i < n; i++) if (!list[i]) request(type, i);
    let pick = (Math.random() * ready) | 0;
    for (let i = 0; i < n; i++) if (list[i] && pick-- === 0) return list[i];
  }
  if (miss >= 0) return buildSync(type, miss); // 照舊:前 n 次各建一個新的
  return list[(Math.random() * n) | 0];
}
// 選單期間預建:有 Worker 時第一次呼叫就全部平行送出;沒有時每次排一個到 requestIdleCallback 同步建
const ORDER = ['walker', 'walker', 'walker', 'runner', 'crawler', 'bloater', 'brute', 'walker', 'walker', 'walker', 'runner', 'runner', 'runner', 'crawler', 'crawler', 'crawler', 'bloater', 'bloater', 'brute', 'brute'];
const TOTAL = Object.values(PER_TYPE).reduce((a, b) => a + b, 0);
const readyCount = () => { let n = 0; for (const t in cache) for (const v of cache[t]) if (v) n++; return n; };
function nextMissing() {
  const seen = {};
  for (const t of ORDER) {
    const k = (seen[t] = (seen[t] ?? -1) + 1);
    if (k < PER_TYPE[t] && !cache[t]?.[k]) return [t, k];
  }
  return null;
}
let dispatched = false, idleQueued = false;
export function prewarm() {
  if (modelPool()) {
    if (!dispatched) {
      dispatched = true;
      materials(); // 順便讓貼圖 Worker 開始畫
      const seen = {};
      for (const t of ORDER) { const k = (seen[t] = (seen[t] ?? -1) + 1); if (k < PER_TYPE[t]) request(t, k); }
    }
    return vstat.pending > 0;
  }
  const m = nextMissing();
  if (m && !idleQueued) {
    idleQueued = true;
    idle(() => { idleQueued = false; const q = nextMissing(); if (q) buildSync(q[0], q[1]); });
  }
  return !!m;
}
// 全部變體建好時 resolve(測試/啟動流程用)
export function whenWarm() {
  return new Promise((res) => {
    const tick = () => { prewarm(); if (readyCount() >= TOTAL) res(variantStats()); else setTimeout(tick, 16); };
    tick();
  });
}
export function variantStats() {
  return { ready: readyCount(), total: TOTAL, pending: vstat.pending, worker: vstat.worker, sync: vstat.sync, syncMs: Math.round(vstat.syncMs), warmMs: vstat.tDone && vstat.t0 ? Math.round(vstat.tDone - vstat.t0) : null, pool: pool ? pool.info() : null };
}

// 依變體建立一個可動的實例:SkinnedMesh + 骨架 + 命中盒
const HB_GEO = { sphere: new THREE.SphereGeometry(1, 10, 8), cyl: new THREE.CylinderGeometry(1, 1, 1, 8), box: new THREE.BoxGeometry(1, 1, 1) };
const HB_MAT = new THREE.MeshBasicMaterial({ visible: false });
export function instantiate(v) {
  const bones = v.rig.bones.map((b) => { const o = new THREE.Bone(); o.name = b.name; return o; });
  v.rig.bones.forEach((b, i) => {
    if (b.parent) {
      const pi = v.rig.index[b.parent];
      bones[i].position.subVectors(b.head, v.rig.bones[pi].head);
      bones[pi].add(bones[i]);
    } else bones[i].position.copy(b.head);
  });
  const mesh = new THREE.SkinnedMesh(v.geometry, v.materials);
  if (v.geometry.boundingSphere) mesh.boundingSphere = v.geometry.boundingSphere.clone();
  mesh.add(bones[0]);
  mesh.bind(new THREE.Skeleton(bones));
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  const by = Object.fromEntries(bones.map((b) => [b.name, b]));
  const hits = v.hitboxes.map((h) => {
    const m = new THREE.Mesh(HB_GEO[h.kind], HB_MAT);
    m.position.copy(h.pos);
    if (h.quat) m.quaternion.copy(h.quat);
    m.scale.copy(h.scl);
    m.userData.part = h.part;
    by[h.bone].add(m);
    return m;
  });
  return { mesh, bones: by, rest: bones.map((b) => b.position.clone()), list: bones, hits };
}
