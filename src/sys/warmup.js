import * as THREE from 'three';
import { idle } from './sched.js';

// ===== Shader 預編譯(KHR_parallel_shader_compile)=====
// three 在「第一次畫到某種材質」時才編譯 shader,而且會卡住主執行緒直到連結完成(首隻殭屍出現、
// 第一次開槍、第一次掉金幣…都會頓一下)。這裡用 renderer.compileAsync 在背景執行緒先編好:
//   await precompile(game, game.scene)            整個場景(主材質 + 陰影深度/距離材質)
//   await precompile(game, someGroup)             還沒加進場景的物件(用場景的光源/霧狀態編譯)
// 注意:必須在與實際渲染相同的狀態下編譯(光源數量、霧、陰影開關、輸出到 HDR render target)。

const SHADOW_SIDE = { [THREE.FrontSide]: THREE.BackSide, [THREE.BackSide]: THREE.FrontSide, [THREE.DoubleSide]: THREE.DoubleSide };
const keep = []; // 代理材質留著:dispose 會讓 three 回收剛編好的 program

// 仿照 WebGLShadowMap.getDepthMaterial 做出陰影 pass 會用到的材質(program 依參數共用)
function shadowVariant(Cls, m, vsm) {
  const d = new Cls();
  d.side = m.shadowSide != null ? m.shadowSide : vsm ? m.side : SHADOW_SIDE[m.side];
  d.alphaMap = m.alphaMap || null;
  d.alphaTest = m.alphaToCoverage ? 0.5 : m.alphaTest || 0;
  d.map = m.map || null;
  d.displacementMap = m.displacementMap || null;
  d.displacementScale = m.displacementScale ?? 1;
  d.displacementBias = m.displacementBias ?? 0;
  d.clipShadows = !!m.clipShadows;
  d.clippingPlanes = m.clippingPlanes || null;
  d.clipIntersection = !!m.clipIntersection;
  return d;
}

function shadowProxies(root, renderer, lightScene) {
  const group = new THREE.Group(), seen = new Set(), vsm = renderer.shadowMap.type === THREE.VSMShadowMap;
  // 只編會用到的那種:點光源用距離材質,平行光/聚光燈用深度材質
  let point = false, dir = false;
  lightScene.traverse((l) => { if (l.isLight && l.castShadow) { if (l.isPointLight) point = true; else dir = true; } });
  if (!point && !dir) return group;
  root.traverse((o) => {
    if (!o.isMesh || !o.castShadow || !o.geometry) return;
    const g = o.geometry, kind = o.isSkinnedMesh ? 's' : o.isInstancedMesh ? 'i' : o.isBatchedMesh ? 'b' : 'm';
    if (kind === 'b') return;
    const sig = `${kind}|${g.attributes.color ? g.attributes.color.itemSize : 0}|${g.morphAttributes.position ? 1 : 0}|${o.instanceColor ? 1 : 0}`;
    for (const m of [].concat(o.material)) {
      if (!m || !m.visible) continue;
      const key = sig + '|' + m.uuid;
      if (seen.has(key)) continue;
      seen.add(key);
      const mats = [];
      if (dir) mats.push(shadowVariant(THREE.MeshDepthMaterial, m, vsm));
      if (point) mats.push(shadowVariant(THREE.MeshDistanceMaterial, m, vsm));
      keep.push(...mats);
      let p;
      if (kind === 's') { p = new THREE.SkinnedMesh(g, mats); p.bind(o.skeleton, o.bindMatrix); }
      else if (kind === 'i') { p = new THREE.InstancedMesh(g, mats, 1); p.instanceColor = o.instanceColor; }
      else p = new THREE.Mesh(g, mats);
      group.add(p);
    }
  });
  return group;
}

// 後處理(EffectComposer 各 pass 的全螢幕材質:Bloom 的 5 種模糊核、合成、輸出…)。
// pass 以「全螢幕三角形 mesh 當場景」渲染(沒有光源、沒有霧);最後一個 pass 直接畫到畫面(影響色彩空間/色調映射參數)
export async function precompilePasses(game) {
  const r = game.renderer, c = game.composer;
  if (!c) return { programs: 0 };
  const before = r.info.programs ? r.info.programs.length : 0;
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  let geo = null;
  for (const p of c.passes) if (p.fsQuad && p.fsQuad._mesh) { geo = p.fsQuad._mesh.geometry; break; }
  if (!geo) {
    geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute([-1, 3, 0, -1, -1, 0, 3, -1, 0], 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute([0, 2, 0, 0, 2, 0], 2));
  }
  const todo = [], last = c.passes.findLastIndex((x) => x.enabled);
  c.passes.forEach((p, i) => {
    if (!p.enabled || p.isRenderPass || p.scene) return;
    if (p.isOutputPass && (p._outputColorSpace !== r.outputColorSpace || p._toneMapping !== r.toneMapping)) {
      // 與 OutputPass.render 相同的 defines 先設好(否則第一幀會因 defines 改變再重編一次)
      p._outputColorSpace = r.outputColorSpace;
      p._toneMapping = r.toneMapping;
      const d = (p.material.defines = {});
      if (THREE.ColorManagement.getTransfer(r.outputColorSpace) === THREE.SRGBTransfer) d.SRGB_TRANSFER = '';
      const tm = { [THREE.LinearToneMapping]: 'LINEAR', [THREE.ReinhardToneMapping]: 'REINHARD', [THREE.CineonToneMapping]: 'CINEON', [THREE.ACESFilmicToneMapping]: 'ACES_FILMIC', [THREE.AgXToneMapping]: 'AGX', [THREE.NeutralToneMapping]: 'NEUTRAL', [THREE.CustomToneMapping]: 'CUSTOM' }[r.toneMapping];
      if (tm) d[tm + '_TONE_MAPPING'] = '';
      p.material.needsUpdate = true;
    }
    const mats = new Set();
    for (const v of Object.values(p)) {
      if (v && v.isMaterial) mats.add(v);
      else if (Array.isArray(v)) for (const x of v) if (x && x.isMaterial) mats.add(x);
    }
    if (p.fsQuad && p.fsQuad.material) mats.add(p.fsQuad.material);
    for (const m of mats) todo.push([new THREE.Mesh(geo, m), c.renderToScreen && i === last ? null : c.readBuffer]);
  });
  const jobs = [];
  let t = performance.now();
  for (const [mesh, target] of todo) {
    if (performance.now() - t > 12) { await yieldNow(); t = performance.now(); }
    const prev = r.getRenderTarget();
    r.setRenderTarget(target);
    try { jobs.push(r.compileAsync(mesh, cam)); } finally { r.setRenderTarget(prev); }
  }
  await Promise.all(jobs);
  return { created: (r.info.programs ? r.info.programs.length : 0) - before };
}

// 讓出主執行緒(Chrome 129+ 的 scheduler.yield 會保留優先權,不支援時用 setTimeout)
export const yieldNow = () => (globalThis.scheduler && globalThis.scheduler.yield ? globalThis.scheduler.yield() : new Promise((r) => setTimeout(r, 0)));

// 每種「物件型態 × 幾何屬性 × 材質」挑一個代表物件(program 只依這些參數而定)
function representatives(root) {
  const reps = [], seen = new Set();
  root.traverse((o) => {
    if (!(o.isMesh || o.isLine || o.isPoints || o.isSprite) || !o.material) return;
    const g = o.geometry, a = g ? g.attributes : {};
    const sig = `${o.type}|${a.color ? a.color.itemSize : 0}|${a.normal ? 1 : 0}|${a.tangent ? 1 : 0}|${g && g.morphAttributes.position ? 1 : 0}|${o.instanceColor ? 1 : 0}`;
    let fresh = false;
    for (const m of [].concat(o.material)) if (m && !seen.has(sig + m.uuid)) { seen.add(sig + m.uuid); fresh = true; }
    if (fresh) reps.push(o);
  });
  return reps;
}
// compile() 只需要 traverse / traverseVisible:用假的根節點只編譯指定的幾個物件
const subset = (list) => ({ traverse: (fn) => { for (const o of list) fn(o); }, traverseVisible() {} });

// target / camera:用哪個場景的光源與霧、哪台相機(手持武器層請傳 game.weaponScene / game.weaponCamera)
// 編譯分批進行、每批之間讓出主執行緒(建立 program 的 CPU 工作不會變成一個好幾百 ms 的長任務)
// instanced:一般網格另外也編「InstancedMesh 版」(下載的模型零件之後常被做成實例池)
export async function precompile(game, root, { shadows = true, target = game.scene, camera = game.camera, budget = 12, instanced = false } = {}) {
  const r = game.renderer, t0 = performance.now();
  const rt = game.composer ? game.composer.readBuffer : null;
  const parallel = !!r.extensions.get('KHR_parallel_shader_compile');
  const before = r.info.programs ? r.info.programs.length : 0;
  // 陰影 pass 是以「沒有霧的空場景」渲染(fog 也是 program 參數),所以代理材質編譯時暫時拿掉霧
  const run = (obj, noFog) => {
    const prev = r.getRenderTarget(), fog = target.fog;
    r.setRenderTarget(rt); // 與 RenderPass 一樣畫進 HDR target(決定 outputColorSpace / toneMapping 參數)
    if (noFog) target.fog = null;
    try { return r.compileAsync(obj, camera, target); } finally { r.setRenderTarget(prev); target.fog = fog; }
  };
  const jobs = [];
  const chunked = async (list, noFog) => {
    let i = 0, k = 2;
    while (i < list.length) {
      await yieldNow();
      const t = performance.now();
      while (i < list.length && performance.now() - t < budget) {
        const a = performance.now();
        jobs.push(run(subset(list.slice(i, i + k)), noFog));
        i += k;
        const dt = performance.now() - a;
        k = dt < budget / 3 ? Math.min(64, k * 2) : dt > budget ? Math.max(1, k >> 1) : k; // 依實際耗時調整每批數量
      }
    }
  };
  root.updateMatrixWorld(true);
  let src = root;
  if (instanced) {
    const extra = [];
    root.traverse((o) => { if (o.isMesh && !o.isInstancedMesh && !o.isSkinnedMesh && o.geometry) { const im = new THREE.InstancedMesh(o.geometry, o.material, 1); im.castShadow = o.castShadow; extra.push(im); } });
    src = { traverse: (fn) => { root.traverse(fn); for (const o of extra) fn(o); }, updateMatrixWorld() {} };
  }
  const reps = representatives(src);
  await chunked(reps, false);
  let px = null;
  if (shadows && r.shadowMap.enabled) {
    px = shadowProxies(src, r, target);
    await chunked(px.children, true);
  }
  await Promise.all(jobs);
  // 編好的 program(之後可交給 initPrograms 在閒置時做「第一次使用」的初始化)
  const programs = new Set();
  for (const o of px ? reps.concat(px.children) : reps) for (const m of [].concat(o.material || [])) { const p = r.properties.get(m).currentProgram; if (p) programs.add(p); }
  return { ms: Math.round(performance.now() - t0), programs, created: (r.info.programs ? r.info.programs.length : 0) - before, parallel };
}

// 真的畫一次(畫進 4x4 的離屏 target,玩家看不到):有些成本要到「第一次繪製」才發生——
// ANGLE(Windows/D3D11)依頂點格式產生的 shader 變體、骨骼貼圖、VAO、陰影貼圖裡的第一次繪製。
// objects 會暫時加進場景(不受視錐剔除、會投影)畫一幀後移除。
let warmRT = null;
export function warmDraw(game, objects) {
  const r = game.renderer, scene = game.scene;
  warmRT = warmRT || new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType });
  const added = [];
  for (const o of objects) {
    o.traverse((x) => { if (x.isMesh || x.isLine || x.isPoints || x.isSprite) { x.frustumCulled = false; if (x.isMesh) x.castShadow = true; } });
    scene.add(o);
    added.push(o);
  }
  const prev = r.getRenderTarget();
  try { r.setRenderTarget(warmRT); r.render(scene, game.camera); } finally { r.setRenderTarget(prev); for (const o of added) scene.remove(o); }
}

// 整個場景:每種「材質 × 頂點格式」挑一個代表物件,暫時取消剔除/隱藏畫一次(之後轉身、走到別層時不會第一次畫才頓)
export function warmDrawScene(game) {
  const r = game.renderer, scene = game.scene, saved = [];
  for (const o of representatives(scene)) {
    saved.push([o, 'frustumCulled', o.frustumCulled]);
    o.frustumCulled = false;
    for (let p = o; p && p !== scene; p = p.parent) if (!p.visible) { saved.push([p, 'visible', false]); p.visible = true; }
  }
  warmRT = warmRT || new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType });
  const prev = r.getRenderTarget();
  try { r.setRenderTarget(warmRT); r.render(scene, game.camera); } finally {
    r.setRenderTarget(prev);
    for (let i = saved.length - 1; i >= 0; i--) saved[i][0][saved[i][1]] = saved[i][2];
  }
  return saved.length;
}

// program 第一次被使用時,three 還要查詢 uniform/attribute 位置(每個數 ms~十數 ms 的同步呼叫)。
// 在閒置時段先做掉(一直沒有閒置時段時,最多等 200ms 就當一般任務跑,每次一個),實際畫到時就不會卡。
export async function initPrograms(programs) {
  const list = [...programs];
  while (list.length) {
    await idle((dl) => {
      do { const p = list.shift(); p.getUniforms(); p.getAttributes(); } while (list.length && !dl.didTimeout && dl.timeRemaining() > 6);
    }, 200);
  }
}
