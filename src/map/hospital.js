import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { parseLayout } from './levels.js';
import { createDressCtx } from './props/ctx.js';
import { dressWorld } from './props/index.js';
import { Buckets } from './hospital/builder.js';
import { createShellContext, buildFloors, buildWalls, buildWindowCells, buildCeilings, buildVaults, buildPipes } from './hospital/shell.js';
import { buildDoors, buildWindows, buildRails, buildFences, buildElevators, buildEdgeRails } from './hospital/openings.js';
import { buildStairs } from './hospital/stairs.js';
import { buildSigns } from './hospital/signs.js';
import { createEvents } from './hospital/events.js';
import { upgradePropMaterials } from './hospital/proppbr.js';
import { NO_FLASH_SHADOW_LAYER } from './hospital/builder.js';
import { buildLights, setGlowFog } from './hospital/lights.js';
import { buildAtmosphere, makeEnvironment, onGlowFog } from './hospital/atmosphere.js';
import { surf } from './hospital/surfaces.js';
import { setAnisotropy, pbrState } from './hospital/pbr.js';
import { procStats } from './hospital/proctex.js';

// 聖心醫院本體:依 levels.js 的四層佈局建出結構(牆/地板/天花板/門窗/樓梯/欄杆/戶外)、材質、燈光、氛圍與腳本驚嚇。
// 細節在 src/map/hospital/*;這裡負責組裝、樓層可見性與每幀更新。
// opts:{ poolSize }(光源池燈數,預設 8;品質設定可用 hospital.setQuality 改)
export function buildHospital(world, layout, scene, opts = {}) {
  const t0 = performance.now();
  const L = layout || world?.layout || parseLayout();
  const root = new THREE.Group();
  root.name = 'hospital';
  // 每層一個群組(結構 + 道具),依玩家位置切換可見性
  const levelGroups = L.levels.map((lv) => {
    const g = new THREE.Group();
    g.name = 'level-' + lv.id;
    root.add(g);
    return g;
  });
  const propGroups = levelGroups.map((g) => { const p = new THREE.Group(); p.name = 'props'; g.add(p); return p; });

  // ---- 結構 ----
  const B = new Buckets();
  const K = createShellContext(L, B);
  K.levelGroups = levelGroups;
  buildRails(K);
  buildFloors(K);
  buildWalls(K);
  buildWindowCells(K);
  buildCeilings(K);
  buildVaults(K);
  buildPipes(K);
  buildDoors(K);
  buildWindows(K);
  buildFences(K);
  buildElevators(K);
  buildStairs(K);
  buildEdgeRails(K);
  try { buildSigns(K); } catch (e) { console.error('[hospital] 標示建構失敗', e); }
  const tShell = performance.now();

  // ---- 道具(依樓層合併靜態網格) ----
  const ctx = createDressCtx({ layout: L, world, group: root });
  const statics = L.levels.map(() => []);
  const origAdd = ctx.add;
  const _bb = new THREE.Box3();
  ctx.add = (obj, o = {}) => {
    const isStatic = o.static !== false;
    const res = origAdd(obj, { ...o, static: false });
    _bb.setFromObject(obj);
    const li = Number.isFinite(_bb.min.y) ? Math.max(0, L.levelOfY(_bb.min.y + 0.25)) : 1;
    propGroups[li].add(obj);
    if (isStatic) obj.traverse((m) => { if (m.isMesh && !m.isInstancedMesh && !m.isSkinnedMesh) statics[li].push(m); });
    return res;
  };
  let propErr = null;
  try { dressWorld(ctx); } catch (e) { propErr = e; console.error('[hospital] dressWorld 失敗', e); }
  const { lights: propLights, events: propEvents } = ctx.finalize();
  const propMeshes = mergeStatics(statics, propGroups);
  const propPbr = upgradePropMaterials();
  // 可推動的小道具是各自獨立的物件(不能合併):離玩家 34m 以外就不畫(夜裡有霧,看不出來),省 draw call
  const dynProps = [];
  for (const g of propGroups) for (const o of g.children) if (o.userData?.dynamic && !o.isInstancedMesh) dynProps.push(o);
  let dynTick = 0;
  const tProps = performance.now();

  // ---- 燈光與氛圍 ----
  const lights = buildLights(K, { root, propLights, poolSize: opts.poolSize ?? 8 });
  const atmo = buildAtmosphere(K, { root, scene, groundMat: surf('soil') });
  atmo.moon.shadow.camera.layers.enable(NO_FLASH_SHADOW_LAYER);
  onGlowFog(setGlowFog);
  const meshes = B.build(levelGroups);
  const tris = B.tris;
  const events = createEvents({ K, L, lights, propEvents, root });

  // ---- 樓層可見性:地下室只在地下或靠近往下的樓梯時才畫 ----
  const b1 = L.levels.findIndex((l) => l.id === 'B1');
  const connectors = []; // B1 ↔ 1F 的通道(樓梯、坡道)
  for (const s of L.stairs) if (s.lower === b1) connectors.push({ x: (s.x0 + s.x1) / 2, z: (s.z0 + s.z1) / 2 });
  const vis = L.levels.map(() => true);
  // 其他樓層的「道具」(draw call 大宗):只有在戶外、靠近連通兩層的樓梯、或在挑空(大廳中庭)附近時才畫;
  // 結構(外牆、窗、樓板)照舊,從窗外看建築不會缺一塊
  const stairsP = L.stairs.map((s) => ({ lo: s.lower, hi: s.upper, x: (s.x0 + s.x1) / 2, z: (s.z0 + s.z1) / 2, r: 9 + Math.max(s.x1 - s.x0, s.z1 - s.z0) / 2 }));
  const voids = [];
  L.levels.forEach((lv, lj) => {
    let x0 = 1e9, z0 = 1e9, x1 = -1e9, z1 = -1e9;
    for (let r = 0; r < L.H; r++) for (let c = 0; c < L.W; c++) if (lv.rows[r][c] === 'o') { x0 = Math.min(x0, c * 2); x1 = Math.max(x1, c * 2 + 2); z0 = Math.min(z0, r * 2); z1 = Math.max(z1, r * 2 + 2); }
    if (x1 > x0) voids.push({ lj, x0: x0 - 8, z0: z0 - 8, x1: x1 + 8, z1: z1 + 8 });
  });
  const propVis = L.levels.map(() => true);
  const updateVisibility = (li, x, z, outdoor) => {
    let nearB1 = false;
    for (const c of connectors) if ((c.x - x) ** 2 + (c.z - z) ** 2 < 15 * 15) nearB1 = true;
    let atrium = false;
    for (const v of voids) if (x > v.x0 && x < v.x1 && z > v.z0 && z < v.z1) atrium = true;
    for (let i = 0; i < vis.length; i++) {
      if (li === b1) vis[i] = i === b1 || i === b1 + 1 || nearB1;
      else vis[i] = i === b1 ? nearB1 || li === b1 : true;
      levelGroups[i].visible = vis[i];
      let pv = i === li || outdoor || atrium;
      if (!pv) for (const s of stairsP) if (((s.lo === li && s.hi === i) || (s.hi === li && s.lo === i)) && (s.x - x) ** 2 + (s.z - z) ** 2 < s.r * s.r) { pv = true; break; }
      propVis[i] = pv;
      propGroups[i].visible = pv;
    }
  };

  const stats = {
    buildMs: Math.round(performance.now() - t0), shellMs: Math.round(tShell - t0), propsMs: Math.round(tProps - tShell),
    meshes: meshes.length, propMeshes, propPbr, tris, fixtures: lights.fixtures.length, propLights: propLights.length, propEvents: propEvents.length,
    proc: procStats, pbr: pbrState, propErr: propErr ? String(propErr) : null,
  };
  console.log('[hospital] build', JSON.stringify(stats));

  // ---- 每幀 ----
  const camFwd = new THREE.Vector3();
  let shadowFrames = 0, lastLoaded = -1;
  const H = {
    group: root, stats, layout: L, lights, atmo, K, levelGroups, propGroups, propEvents, propLights, vis, propVis, events, game: null,
    // post.js 會呼叫:提供 renderer(環境貼圖、各向異性)與品質設定
    attachRenderer(r, game) {
      H.game = game || null;
      upgradePropMaterials(); // 之後才建的共用材質(商店、補給點…)也升級
      try { setAnisotropy(Math.min(8, r.capabilities.getMaxAnisotropy())); } catch { /* 忽略 */ }
      try { scene.environment = makeEnvironment(r); } catch (e) { console.warn('[hospital] 環境貼圖失敗', e); }
      H.setQuality(game?.quality);
      // 預先編譯 shader(KHR_parallel_shader_compile;避免第一次看到某材質時卡頓)
      if (game?.camera) { game.camera.layers.enable(NO_FLASH_SHADOW_LAYER); r.compileAsync?.(scene, game.camera).catch(() => {}); }
    },
    setQuality(q) {
      const pool = q?.get?.('lights') ?? q?.get?.('lightPool');
      if (Number.isFinite(pool)) lights.setPoolSize(pool);
    },
    update(time, dt, player) {
      if (!player) return;
      const p = player.pos;
      const li = Math.max(0, L.levelOfY(p.y + 0.3));
      const c = Math.floor(p.x / L.CELL), r = Math.floor(p.z / L.CELL);
      const zone = L.zoneAt(li, c, r);
      const style = zone || L.levelDefault[L.levels[li].id];
      const mood = L.moods[style.mood] || L.moods.corridor;
      const outdoor = (L.flagsAt(li, c, r) & L.F.OUTDOOR) !== 0 || L.ceilY(li, c, r) === Infinity;
      updateVisibility(li, p.x, p.z, outdoor);
      if ((dynTick = (dynTick + 1) % 12) === 0) for (const o of dynProps) { const dx = o.position.x - p.x, dz = o.position.z - p.z; o.visible = dx * dx + dz * dz < 34 * 34; }
      const cam = player.camera;
      cam.layers.enable(NO_FLASH_SHADOW_LAYER);
      cam.getWorldDirection(camFwd);
      const fl = Math.hypot(camFwd.x, camFwd.z) || 1;
      lights.update(time, dt, p.x, p.y + 1.6, p.z, camFwd.x / fl, camFwd.z / fl, li, vis);
      atmo.update(time, dt, cam, mood, outdoor);
      // 新的一局(狀態從非遊戲中變成遊戲中):驚嚇事件、被甩上的門、掉下的天花板都歸零
      const st = H.game?.state;
      if (st === 'playing' && H._state !== 'playing') events.reset();
      H._state = st;
      try { events.update(time, dt, player, H.game, { li, zone, mood: style.mood, outdoor, fx: camFwd.x / fl, fz: camFwd.z / fl }); } catch (e) { console.warn('[events]', e); }
      // 月光陰影:靜態,只在一開始與貼圖載完時重算(玩家在地面以上時)
      const loaded = pbrState.loaded + procStats.done;
      if (li !== b1 && (shadowFrames < 2 || loaded !== lastLoaded)) { atmo.moon.shadow.needsUpdate = true; shadowFrames++; lastLoaded = loaded; }
      H.zone = zone; H.level = li; H.mood = style.mood;
    },
    // 新回合/重新開始:驚嚇事件與燈光狀態歸零(地圖不重建)
    reset() { events.reset(); },
    // 換地圖時:移除場景、釋放幾何(材質/貼圖是全域快取,可給下一張地圖共用)
    dispose() {
      events.dispose();
      lights.dispose?.();
      scene.remove(root);
      root.traverse((o) => { if (o.geometry && !o.geometry.userData?.shared) o.geometry.dispose(); });
      if (scene.environment && scene.environment.isTexture) { scene.environment.dispose(); scene.environment = null; }
    },
  };
  return H;
}

// 道具的靜態網格依「樓層 × 材質」合併(和 ctx.finalize 相同的做法,但分樓層,才能整層隱藏)
function mergeStatics(statics, groups) {
  let count = 0;
  statics.forEach((list, li) => {
    const byMat = new Map();
    for (const m of list) {
      if (!m.parent || Array.isArray(m.material)) continue;
      m.updateMatrixWorld(true);
      const g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
      for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
      if (!g.attributes.normal) g.computeVertexNormals();
      if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
      g.applyMatrix4(m.matrixWorld);
      const arr = byMat.get(m.material) || [];
      arr.push(g);
      byMat.set(m.material, arr);
      m.parent.remove(m);
    }
    for (const [material, geos] of byMat) {
      for (let i = 0; i < geos.length; i += 400) {
        const merged = mergeGeometries(geos.slice(i, i + 400));
        if (!merged) continue;
        const mesh = new THREE.Mesh(merged, material);
        mesh.castShadow = !material.transparent;
        mesh.receiveShadow = true;
        mesh.matrixAutoUpdate = false;
        groups[li].add(mesh);
        count++;
      }
    }
  });
  return count;
}
