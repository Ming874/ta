import * as THREE from 'three';

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

// target / camera:用哪個場景的光源與霧、哪台相機(手持武器層請傳 game.weaponScene / game.weaponCamera)
export async function precompile(game, root, { shadows = true, target = game.scene, camera = game.camera } = {}) {
  const r = game.renderer, t0 = performance.now();
  const rt = game.composer ? game.composer.readBuffer : null;
  const parallel = !!r.extensions.get('KHR_parallel_shader_compile');
  const before = r.info.programs ? r.info.programs.length : 0;
  // 陰影 pass 是以「沒有霧的空場景」渲染(fog 也是 program 參數),所以代理材質編譯時暫時拿掉霧
  const run = (obj, noFog = false) => {
    const prev = r.getRenderTarget(), fog = target.fog;
    r.setRenderTarget(rt); // 與 RenderPass 一樣畫進 HDR target(決定 outputColorSpace / toneMapping 參數)
    if (noFog) target.fog = null;
    try { return r.compileAsync(obj, camera, target); } finally { r.setRenderTarget(prev); target.fog = fog; }
  };
  root.updateMatrixWorld(true);
  const jobs = [run(root)];
  if (shadows && r.shadowMap.enabled) {
    const px = shadowProxies(root, r, target);
    if (px.children.length) jobs.push(run(px, true));
  }
  await Promise.all(jobs);
  return { ms: Math.round(performance.now() - t0), programs: (r.info.programs ? r.info.programs.length : 0) - before, parallel };
}
