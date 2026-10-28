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
  K.propGroups = propGroups; // 門扇實例跟著道具群組顯示(src/map/hospital/leaves.js)
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
  const chunks = []; // 合併後的道具區塊(距離剔除用)
  const propMeshes = mergeStatics(statics, propGroups, chunks);
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
      if (li === b1) vis[i] = i === b1 || (nearB1 && i === b1 + 1); // 地下室只有靠近樓梯/坡道時看得到 1F;2F 以上看不到
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
  let cullTick = 0;
  const H = {
    group: root, stats, layout: L, lights, atmo, K, levelGroups, propGroups, propEvents, propLights, vis, propVis, events, game: null, chunks,
    leaves: K.leaves, doorLeaves: K.doorLeaves || [], // 門扇實例與代理(src/map/hospital/leaves.js;互動與碰撞在 src/interact/doors.js)
    propDistance: 54, // 道具區塊的顯示距離(公尺):霧裡看不到的就不畫,setQuality 依 drawDistance 調整
    // post.js 會呼叫:提供 renderer(環境貼圖、各向異性)與品質設定
    attachRenderer(r, game) {
      H.game = game || null;
      try { setAnisotropy(Math.min(8, r.capabilities.getMaxAnisotropy())); } catch { /* 忽略 */ }
      try { scene.environment = makeEnvironment(r); } catch (e) { console.warn('[hospital] 環境貼圖失敗', e); }
      H.setQuality(game?.quality);
      // shader 預編譯統一由 main.js boot()(src/sys/warmup.js)在畫質設定套用後分批做;這裡先編會用錯參數、還會同步等編譯
      if (game?.camera) game.camera.layers.enable(NO_FLASH_SHADOW_LAYER);
    },
    setQuality(q) {
      const pool = q?.get?.('lights') ?? q?.get?.('lightPool');
      if (Number.isFinite(pool)) lights.setPoolSize(pool);
      const dd = q?.get?.('drawDistance');
      if (Number.isFinite(dd)) H.propDistance = dd * 0.6;
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
      // 可推動的小道具:34m(或畫質的道具距離,取小)以外不畫
      if ((dynTick = (dynTick + 1) % 12) === 0) { const fd = Math.min(34, H.propDistance); for (const o of dynProps) { const dx = o.position.x - p.x, dz = o.position.z - p.z; o.visible = dx * dx + dz * dz < fd * fd; } }
      // 道具區塊距離剔除(每 4 幀一次;區塊包圍球表面到眼睛的距離)。
      // 小東西在霧裡更早就看不清楚:半徑越小顯示距離越短(半徑 0.2m ≈ 1/3,4m 以上 = 完整距離)
      if ((cullTick = (cullTick + 1) & 3) === 0) {
        const ey = p.y + 1.6, far = H.propDistance;
        for (let i = 0; i < chunks.length; i++) {
          const m = chunks[i], s = m.geometry.boundingSphere, c = s.center;
          m.visible = Math.hypot(c.x - p.x, c.y - ey, c.z - p.z) - s.radius < far * Math.min(1, 0.3 + s.radius / 6);
        }
      }
      const cam = player.camera;
      cam.layers.enable(NO_FLASH_SHADOW_LAYER);
      cam.getWorldDirection(camFwd);
      const fl = Math.hypot(camFwd.x, camFwd.z) || 1;
      lights.update(time, dt, p.x, p.y + 1.6, p.z, camFwd.x / fl, camFwd.z / fl, li, vis);
      atmo.update(time, dt, cam, mood, outdoor);
      // 新的一局(狀態從非遊戲中變成遊戲中):驚嚇事件、被甩上的門、掉下的天花板都歸零
      const st = H.game?.state;
      if (st === 'playing' && H._state !== 'playing') { events.reset(); lights.calmUntil?.(time + 60); } // [ghost] 開局 60 秒內燈不閃
      H._state = st;
      try { events.update(time, dt, player, H.game, { li, zone, mood: style.mood, outdoor, fx: camFwd.x / fl, fz: camFwd.z / fl }); } catch (e) { console.warn('[events]', e); }
      K.leaves?.update(); // 角度有變的門扇才重寫實例矩陣
      // 月光陰影:靜態,只在一開始與貼圖載完時重算(玩家在地面以上時)
      const loaded = pbrState.alpha + procStats.done; // 只有鏤空貼圖會改變陰影形狀(其他貼圖載完不必重畫 2048 陰影圖)
      if (li !== b1 && (shadowFrames < 2 || loaded !== lastLoaded)) { atmo.moon.shadow.needsUpdate = true; shadowFrames++; lastLoaded = loaded; }
      H.zone = zone; H.level = li; H.mood = style.mood;
    },
    // 新回合/重新開始:驚嚇事件與燈光狀態歸零(地圖不重建)
    reset() { events.reset(); },
    // 換地圖時:移除場景、釋放幾何(材質/貼圖是全域快取,可給下一張地圖共用)
    dispose() {
      events.dispose();
      K.leaves?.dispose();
      lights.dispose?.();
      scene.remove(root);
      root.traverse((o) => { if (o.geometry && !o.geometry.userData?.shared) o.geometry.dispose(); });
      if (scene.environment && scene.environment.isTexture) { scene.environment.dispose(); scene.environment = null; }
    },
  };
  return H;
}

// 道具的靜態網格依「樓層 × 材質」合併;三角形多的材質再依 24m 區塊切開。
// 整層合成一個大網格雖然 draw call 少,但包圍球涵蓋整層 → 視錐剔除、距離剔除、手電筒陰影的剔除全部失效,
// 每幀(含每個陰影 pass)都得畫整層上百萬個三角形。只切「重」的材質:三角形大幅減少,draw call 不會因為
// 上百種輕量材質被切成很多塊而暴增。
const CHUNK = 24, HEAVY_VERTS = 60000; // 單一材質在一層超過 ~2 萬個三角形才切區塊
// 沒有任何貼圖的純色材質(道具材質八成以上是這種)改成頂點色,依「粗糙度/金屬度/面向」合併成少數共用材質:
// 145 種材質 → 約 20 種,draw call 與材質切換大減。透明、自發光、有自訂 shader 的材質維持原樣。
const MAP_KEYS = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap', 'alphaMap', 'bumpMap', 'displacementMap', 'lightMap', 'envMap'];
const plainMats = new Map();
function plainBucket(mat) {
  if (!mat.isMeshStandardMaterial || mat.isMeshPhysicalMaterial || mat.transparent || mat.alphaTest > 0 || mat.vertexColors || mat.wireframe || mat.fog === false) return null;
  if (mat.onBeforeCompile !== THREE.Material.prototype.onBeforeCompile || mat.customProgramCacheKey !== THREE.Material.prototype.customProgramCacheKey) return null;
  if (mat.defines && Object.keys(mat.defines).some((k) => k !== 'STANDARD')) return null; // STANDARD 是 MeshStandardMaterial 內建的
  if (mat.emissive && mat.emissive.r + mat.emissive.g + mat.emissive.b > 0) return null;
  if (MAP_KEYS.some((k) => mat[k])) return null;
  const r = Math.round(mat.roughness * 5), mt = Math.round(mat.metalness * 5);
  const key = r + '|' + mt + '|' + mat.side + '|' + (mat.flatShading ? 1 : 0) + '|' + Math.round((mat.envMapIntensity ?? 1) * 4);
  let b = plainMats.get(key);
  if (!b) plainMats.set(key, (b = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: r / 5, metalness: mt / 5, side: mat.side, flatShading: mat.flatShading, envMapIntensity: mat.envMapIntensity ?? 1, name: 'plain:' + key })));
  return b;
}
function mergeStatics(statics, groups, chunks) {
  let count = 0;
  statics.forEach((list, li) => {
    const eff = new Map(); // 原材質 → 實際合併用的材質(純色材質 → 共用頂點色材質)
    const verts = new Map(); // 合併用材質 → 這一層的頂點數
    for (const m of list) {
      if (!m.parent || Array.isArray(m.material)) continue;
      if (!eff.has(m.material)) eff.set(m.material, plainBucket(m.material) || m.material);
      const mat = eff.get(m.material), pa = m.geometry.attributes.position;
      verts.set(mat, (verts.get(mat) || 0) + (m.geometry.index ? m.geometry.index.count : pa ? pa.count : 0));
    }
    const byKey = new Map(); // 區塊 → (材質 → 幾何)
    for (const m of list) {
      if (!m.parent || Array.isArray(m.material)) continue;
      m.updateMatrixWorld(true);
      const g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
      for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
      if (!g.attributes.normal) g.computeVertexNormals();
      if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
      g.applyMatrix4(m.matrixWorld);
      const mat = eff.get(m.material);
      if (mat !== m.material) { // 純色 → 頂點色(Color 內部已是線性值,和頂點色的解讀一致)
        const n = g.attributes.position.count, col = new Float32Array(n * 3), c = m.material.color;
        for (let i = 0; i < n * 3; i += 3) { col[i] = c.r; col[i + 1] = c.g; col[i + 2] = c.b; }
        g.setAttribute('color', new THREE.BufferAttribute(col, 3));
      }
      g.computeBoundingBox();
      const bb = g.boundingBox;
      const key = verts.get(mat) < HEAVY_VERTS ? 'all' : Math.floor((bb.min.x + bb.max.x) * 0.5 / CHUNK) + ',' + Math.floor((bb.min.z + bb.max.z) * 0.5 / CHUNK);
      let byMat = byKey.get(key);
      if (!byMat) byKey.set(key, (byMat = new Map()));
      const arr = byMat.get(mat) || [];
      arr.push(g);
      byMat.set(mat, arr);
      m.parent.remove(m);
    }
    for (const byMat of byKey.values()) {
      for (const [material, geos] of byMat) {
        for (let i = 0; i < geos.length; i += 400) {
          const merged = mergeGeometries(geos.slice(i, i + 400));
          if (!merged) continue;
          merged.computeBoundingSphere();
          const mesh = new THREE.Mesh(merged, material);
          mesh.castShadow = !material.transparent;
          mesh.receiveShadow = true;
          mesh.matrixAutoUpdate = false;
          mesh.updateMatrix();
          groups[li].add(mesh);
          chunks.push(mesh);
          count++;
        }
      }
    }
  });
  return count;
}
