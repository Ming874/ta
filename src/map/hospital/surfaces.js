import * as THREE from 'three';
import { pbrTex, onPbrFail, PBR_SETS } from './pbr.js';
import { SURF as PROC, TRIM } from './texdefs.js';
import { procTextures, procClone } from './proctex.js';

// 結構表面材質(牆/地板/天花板/收邊)。多數用 CC0 PBR 貼圖組,以「色調 tint + 飽和度 sat + 縮放 tile + 旋轉 rot」
// 從同一組貼圖衍生出很多種不同的牆(綠漆、白漆、灰漆、粉色、薄荷綠…);沒有對應照片貼圖的(壁紙、軟包、空心磚、
// 兒童地墊…)用程式貼圖。幾何 UV 是世界座標公尺,頂點色再疊上每面牆的色調與髒污漸層。
// pbr: 貼圖組;tile: 一張貼圖幾公尺;tint: 乘色;sat: 飽和度(0 = 灰階再染色);rough: 粗糙度倍率;n: 法線強度
// gen: 程式貼圖鍵(texdefs.js);fb: PBR 載入失敗時改用的程式貼圖鍵
const S = (pbr, tile, o = {}) => ({ pbr, tile, ...o });
export const SURFACES = {
  // ---- 牆:油漆(同一組剝落灰泥,染成不同顏色/比例) ----
  paint_green: S('paint_peeling', 1.7, { tint: 0x8eb59a, sat: 1 }),
  paint_mint: S('paint_peeling', 2.1, { tint: 0xb2d6c4, n: 0.8 }),
  paint_olive: S('paint_peeling', 1.5, { tint: 0xb4b486 }),
  paint_white: S('paint_peeling', 1.8, { tint: 0xe2dccc }),
  paint_sterile: S('paint_peeling', 2.6, { tint: 0xe8ecea, n: 0.6, rough: 0.85 }),
  paint_gray: S('paint_peeling', 1.6, { tint: 0xa2aab0 }),
  paint_cream: S('plaster', 2.6, { tint: 0xe8dcc0, sat: 0.55 }),
  paint_blue: S('paint_peeling', 1.9, { tint: 0xa6bed2 }),
  paint_pink: S('paint_peeling', 1.9, { tint: 0xe6b8b8 }),
  // 護牆下段(亮光漆:剝落的烤漆鋼板質感)
  dado_green: S('metal_painted', 1.2, { tint: 0x4f7058, sat: 0.35, rough: 0.75, n: 0.8 }),
  dado_teal: S('metal_painted', 1.2, { tint: 0x46716e, sat: 0.35, rough: 0.75, n: 0.8 }),
  dado_gray: S('metal_painted', 1.3, { tint: 0x7a8084, sat: 0.2, rough: 0.8, n: 0.7 }),
  dado_brown: S('wood_old', 1.6, { tint: 0x9a7a5e, rot: Math.PI / 2 }),
  dado_rose: S('metal_painted', 1.2, { tint: 0xb48688, sat: 0.3, rough: 0.8 }),
  // 磁磚(細長白磚,染色/轉向)
  tile_white: S('tile_wall', 1.27, { tint: 0xf4f2ea }),
  tile_green: S('tile_wall', 1.27, { tint: 0xa6d8bc, sat: 0.4, rot: Math.PI / 2 }),
  tile_subway: S('tile_wall', 1.9, { tint: 0xf4e4c4, rot: Math.PI / 2 }),
  tile_blue: S('tile_wall', 1.0, { tint: 0xaecadb, sat: 0.3 }),
  tile_pink: S('tile_wall', 1.27, { tint: 0xf2c8c4, sat: 0.3, rot: Math.PI / 2 }),
  // 灰泥/清水模/磚/石/木
  plaster: S('plaster', 3.2, { tint: 0xd8d0c0, sat: 0.6 }),
  plaster_chapel: S('plaster', 2.6, { tint: 0xe0caa4, sat: 1 }),
  plaster_dorm: S('plaster', 2.9, { tint: 0xcfcbc0, sat: 0.4 }),
  marble_wall: { gen: 'marble_wall' },
  concrete_wall: S('concrete_wall', 2.3, { tint: 0xbab4ac }),
  concrete_wet_wall: S('concrete_wet', 2.2, { tint: 0xa8a69e, rough: 0.55 }),
  cmu_paint: { gen: 'cmu_paint' },
  cmu_red: { gen: 'cmu_red' },
  brick: S('brick', 1.5, { tint: 0x9a8c84 }),
  brick_old: S('brick', 1.7, { tint: 0xa8a098, sat: 0.75 }),
  stone_wall: S('stone_wall', 2.5, { tint: 0xc8c0b0 }),
  wood_panel: S('wood_panel', 2.1, { tint: 0x9c8070, sat: 0.65, rough: 0.9 }),
  wallpaper_ducks: { gen: 'wallpaper_ducks' },
  wallpaper_stars: { gen: 'wallpaper_stars' },
  wallpaper_animals: { gen: 'wallpaper_animals' },
  padded: { gen: 'padded' },
  facade: S('plaster', 3.8, { tint: 0xa6a298, sat: 0.3 }),
  facade_dark: S('concrete_wall', 2.4, { tint: 0x9a968e }),
  // ---- 地板 ----
  tile_ward: S('tile_ward', 1.8),
  tile_ward_b: S('tile_lobby', 1.4, { tint: 0xd4ccbc }),
  tile_lobby: S('tile_lobby', 2.0, { tint: 0xe4dccc }),
  terrazzo: S('terrazzo', 1.1, { rough: 0.55, tint: 0xd8d2c8 }),
  linoleum: S('linoleum', 2.0, { tint: 0xb4c4b4, sat: 0.55 }),
  linoleum_b: S('linoleum', 2.3, { tint: 0xd6c6a6, sat: 0.06, rot: Math.PI / 2 }),
  linoleum_c: S('linoleum', 2.2, { tint: 0xa8b6c8, sat: 0.08 }),
  linoleum_d: S('linoleum', 2.0, { tint: 0xd4aeaa, sat: 0.08, rot: Math.PI / 2 }),
  tile_white_floor: S('tile_white', 1.6),
  concrete: S('concrete', 3.0),
  concrete_paint: S('concrete', 3.2, { tint: 0xc8c0b0 }),
  concrete_wet: S('concrete_wet', 2.0, { rough: 0.42 }),
  wood_floor: S('wood_floor', 2.0),
  wood_gym: S('wood_floor', 2.6, { tint: 0xe6c49a, sat: 1.25 }),
  wood_parquet: { gen: 'wood_parquet' },
  wood_old: S('wood_old', 2.0),
  carpet: S('carpet', 0.8, { tint: 0xa6b0c0, sat: 0.4 }),
  carpet_kids: { gen: 'carpet_kids' },
  padded_floor: { gen: 'padded_floor' },
  stone: S('stone', 1.8),
  asphalt: S('asphalt', 3.2),
  paving: S('paving', 3.0),
  gravel: S('gravel', 2.0),
  grass: S('grass', 2.5),
  soil: S('dirt', 2.2),
  roof_gravel: S('roof_gravel', 2.2),
  metal_grate: S('metal_grate', 0.5, { metal: 0.75, alphaTest: 0.5, side: 2 }),
  // ---- 天花板 ----
  ceil_tile: S('ceiling_tile', 4.0, { tint: 0xd8d4c8 }),
  ceil_tile_b: S('ceiling_tile', 4.0, { tint: 0xb4a48c, sat: 1.2 }),
  ceil_plaster: S('plaster', 3.0, { tint: 0xbcb6aa, sat: 0.4 }),
  ceil_concrete: S('concrete', 2.6, { tint: 0x8c8882 }),
  ceil_wood: S('wood_panel', 2.1, { tint: 0x8a7264, sat: 0.6 }),
  vault_stone: S('stone_wall', 2.5, { tint: 0xb8b0a0 }),
};

// 飽和度調整(共用同一個 onBeforeCompile → 共用 shader 程式,每個材質自己的 uSat)
function satHook(shader) {
  shader.uniforms.uSat = this.userData.uSat;
  shader.fragmentShader = shader.fragmentShader
    .replace('void main() {', 'uniform float uSat;\nvoid main() {')
    .replace('#include <map_fragment>', `#ifdef USE_MAP
	vec4 sampledDiffuseColor = texture2D( map, vMapUv );
	float satL = dot( sampledDiffuseColor.rgb, vec3( 0.299, 0.587, 0.114 ) );
	sampledDiffuseColor.rgb = max( mix( vec3( satL ), sampledDiffuseColor.rgb, uSat ), 0.0 );
	diffuseColor *= sampledDiffuseColor;
#endif`);
}

const cache = new Map();
export function surf(key) {
  let m = cache.get(key);
  if (m) return m;
  const def = SURFACES[key];
  if (def?.pbr && PBR_SETS[def.pbr]) {
    const set = PBR_SETS[def.pbr];
    const o = { tile: def.tile, rot: def.rot || 0 };
    m = new THREE.MeshStandardMaterial({
      color: def.tint ?? 0xffffff, roughness: def.rough ?? 1, metalness: def.metal ?? 0, vertexColors: true,
      map: pbrTex(def.pbr, 'color', o), normalMap: pbrTex(def.pbr, 'normal', o),
    });
    const orm = pbrTex(def.pbr, 'orm', o);
    m.roughnessMap = orm;
    if (set.ao) { m.aoMap = orm; m.aoMapIntensity = def.ao ?? 1; }
    const n = def.n ?? 1;
    m.normalScale.set(n, n);
    if (set.alpha) { m.alphaMap = pbrTex(def.pbr, 'opacity', o); m.alphaTest = def.alphaTest ?? 0.5; }
    if (def.side === 2) m.side = THREE.DoubleSide;
    m.userData.uSat = { value: def.sat ?? 1 };
    m.onBeforeCompile = satHook;
    // PBR 下載失敗 → 換成程式貼圖
    const fb = def.fb || key;
    if (PROC[fb]) onPbrFail(def.pbr, () => {
      const p = procTextures(fb);
      m.map = p.tex; m.normalMap = null; m.roughnessMap = null; m.aoMap = null; m.alphaMap = null;
      if (p.bump) { m.bumpMap = p.bump; m.bumpScale = PROC[fb].bump ?? 1; }
      m.color.set(0xffffff); m.userData.uSat.value = 1; m.roughness = PROC[fb].rough ?? 0.85;
      m.needsUpdate = true;
    });
  } else if (def?.gen || PROC[key]) {
    const gk = def?.gen || key, pd = PROC[gk];
    const p = procTextures(gk, { placeholder: pd.ph || '#77736a' });
    m = new THREE.MeshStandardMaterial({ map: p.tex, roughness: pd.rough ?? 0.85, metalness: pd.metal ?? 0, vertexColors: true });
    if (p.bump) { m.bumpMap = p.bump; m.bumpScale = pd.bump ?? 1; }
    if (pd.alphaTest) m.alphaTest = pd.alphaTest;
    if (pd.side === 2) m.side = THREE.DoubleSide;
  } else {
    const d = TRIM[key] || [0xff00ff, 1];
    m = new THREE.MeshStandardMaterial({ color: d[0], roughness: d[1], metalness: d[2] ?? 0, vertexColors: true });
  }
  m.name = 's:' + key;
  cache.set(key, m);
  return m;
}
export const surfKeys = () => [...cache.keys()];
// 貼圖的公尺尺寸(UV 位移用)
export function surfSize(key) {
  const d = SURFACES[key];
  if (d?.pbr) return [d.tile, d.tile];
  const p = PROC[d?.gen || key];
  return p ? p.size : [1, 1];
}
// v 是否要從地面起算(只有畫了牆腳/頂端細節的程式貼圖需要)
export const isRoomMapped = (key) => { const d = SURFACES[key]; if (d?.pbr) return false; return !!PROC[d?.gen || key]?.room; };
export { procClone };
