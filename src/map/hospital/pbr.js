import * as THREE from 'three';

// CC0 PBR 貼圖組(public/textures/<set>/{color,normal,orm[,opacity]}.webp;orm = R:AO G:粗糙度)。
// pbrTex(set, map, opts) 立刻回傳 Texture(先用平均色的佔位圖),圖片載入後就地換上同一個 Texture
// → 材質的 define 不變,不會重新編譯 shader。載入失敗時呼叫 onFail(set) 讓呼叫端換成程式貼圖。
// tile = 一張貼圖對應的公尺數(幾何 UV 是公尺,所以 repeat = 1/tile)。
export const PBR_SETS = {
  tile_ward: { tile: 3.0, ao: 1, avg: '#7a6f6b' },
  tile_lobby: { tile: 2.0, ao: 1, avg: '#4a453a' },
  terrazzo: { tile: 0.6, ao: 0, avg: '#bfbbbe' },
  linoleum: { tile: 2.0, ao: 1, avg: '#486a4f' },
  tile_white: { tile: 2.0, ao: 0, avg: '#d3cac2' },
  concrete: { tile: 3.0, ao: 1, avg: '#898377' },
  concrete_wet: { tile: 2.0, ao: 1, avg: '#514d42' },
  wood_floor: { tile: 2.0, ao: 1, avg: '#534a3f' },
  carpet: { tile: 0.5, ao: 0, avg: '#736f5f' },
  stone: { tile: 1.8, ao: 1, avg: '#665647' },
  asphalt: { tile: 3.0, ao: 1, avg: '#5b5955' },
  paving: { tile: 3.0, ao: 1, avg: '#847e73' },
  gravel: { tile: 2.0, ao: 1, avg: '#4f4f4c' },
  grass: { tile: 2.51, ao: 1, avg: '#6e603e' },
  roof_gravel: { tile: 2.2, ao: 1, avg: '#403b36' },
  metal_grate: { tile: 0.5, ao: 0, alpha: 1, avg: '#4e4d4f' },
  paint_peeling: { tile: 1.0, ao: 1, avg: '#b7b5ae' },
  tile_wall: { tile: 1.27, ao: 1, avg: '#cec6b6' },
  plaster: { tile: 3.0, ao: 1, avg: '#ceb89d' },
  concrete_wall: { tile: 1.55, ao: 1, avg: '#6c655e' },
  brick: { tile: 1.5, ao: 1, avg: '#816149' },
  stone_wall: { tile: 2.5, ao: 1, avg: '#4d422f' },
  wood_panel: { tile: 2.1, ao: 1, avg: '#4e2213' },
  ceiling_tile: { tile: 3.85, ao: 1, avg: '#e6e2d6' },
  rust: { tile: 2.2, ao: 1, avg: '#62391f' },
  metal_painted: { tile: 1.0, ao: 1, avg: '#d5d3cc' },
  steel: { tile: 1.0, ao: 0, avg: '#929598' },
  wood_old: { tile: 2.0, ao: 1, avg: '#615546' },
  fabric: { tile: 0.5, ao: 0, avg: '#c3c1bc' },
  leather: { tile: 0.5, ao: 0, avg: '#4f3632' },
  cardboard: { tile: 0.75, ao: 0, avg: '#b99050' },
  bark: { tile: 2.15, ao: 1, avg: '#847668' },
  dirt: { tile: 1.3, ao: 1, avg: '#4d4537' },
  chainlink: { tile: 1.0, ao: 0, alpha: 1, avg: '#9b9ea0' },
  // wave 2:更多牆/地/天花板(見 public/credits/indoor.md)
  plaster_paint: { tile: 2.5, ao: 1, avg: '#aba3a0' },
  wallpaper_old: { tile: 2.0, ao: 1, avg: '#776b5e' },
  plaster_blue: { tile: 2.4, ao: 1, avg: '#87a5a0' },
  plaster_damaged: { tile: 2.4, ao: 1, avg: '#948271' },
  brick_white: { tile: 2.0, ao: 1, avg: '#8d806b' },
  gloss_paint: { tile: 1.6, ao: 1, avg: '#547c58' },
  tile_sq: { tile: 1.5, ao: 1, avg: '#bdc3c0' },
  plaster_mould: { tile: 2.4, ao: 1, avg: '#75714c' },
  lino_pattern: { tile: 1.5, ao: 1, avg: '#b0834f' },
  checker_bw: { tile: 1.6, ao: 1, avg: '#868580' },
  rubber_floor: { tile: 2.0, ao: 1, avg: '#1f2125' },
  anti_skid: { tile: 1.2, ao: 1, avg: '#866b54' },
  carpet_dirty: { tile: 1.5, ao: 1, avg: '#352f25' },
  epoxy: { tile: 3.0, ao: 1, avg: '#4f493f' },
  ceiling_tile2: { tile: 2.4, ao: 1, avg: '#f5f5f5' },
};
// 新地圖註冊自己的貼圖組(public/textures/<name>/…):registerPbrSets({ name: { tile, ao, avg, alpha? } })
export function registerPbrSets(defs) { Object.assign(PBR_SETS, defs); }
const BASE = ((typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.BASE_URL) || '/') + 'textures/';
const PH = { color: null, normal: '#8080ff', orm: '#ffd0ff', opacity: '#ffffff' };
const sets = new Map(); // set → { maps: {color, normal, orm, opacity}: base Texture, clones: [], state }
let aniso = 8;
export function setAnisotropy(n) { aniso = n; for (const s of sets.values()) for (const t of s.all) t.anisotropy = n; }
const failHandlers = new Map();
export const pbrState = { requested: 0, loaded: 0, failed: 0 };

function ph(color) {
  const c = document.createElement('canvas');
  c.width = c.height = 4;
  const x = c.getContext('2d');
  x.fillStyle = color; x.fillRect(0, 0, 4, 4);
  return c;
}
function getSet(name) {
  let s = sets.get(name);
  if (s) return s;
  const def = PBR_SETS[name];
  s = { name, def, maps: {}, all: [], loaded: false, failed: false };
  for (const m of ['color', 'normal', 'orm', 'opacity']) {
    if (m === 'opacity' && !def.alpha) continue;
    const t = new THREE.Texture(ph(m === 'color' ? def.avg : PH[m]));
    t.colorSpace = m === 'color' ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = aniso;
    t.needsUpdate = true;
    s.maps[m] = t;
    s.all.push(t);
  }
  sets.set(name, s);
  queue.push(s);
  pump();
  return s;
}
// 載入佇列(限制同時下載數,先要求的先載)
const queue = [];
let active = 0;
function pump() {
  while (active < 6 && queue.length) {
    const s = queue.shift();
    const maps = Object.keys(s.maps);
    let left = maps.length, bad = false;
    active++;
    pbrState.requested++;
    for (const m of maps) {
      const img = new Image();
      img.decoding = 'async';
      img.onload = () => {
        const base = s.maps[m];
        // 尺寸不同的新圖:先釋放舊的 GL 貼圖(不可變儲存無法改尺寸),下次使用時重新配置
        const same = s.all.filter((t) => t.source === base.source);
        for (const t of same) t.dispose();
        base.image = img;
        for (const t of same) t.needsUpdate = true;
        if (--left === 0) done();
      };
      img.onerror = () => { bad = true; if (--left === 0) done(); };
      img.src = BASE + s.name + '/' + m + '.webp';
    }
    const done = () => {
      active--;
      if (bad) { s.failed = true; pbrState.failed++; for (const fn of failHandlers.get(s.name) || []) fn(s.name); }
      else { s.loaded = true; pbrState.loaded++; }
      pump();
    };
  }
}
// 取得某組某張貼圖的複本(共用影像,自己的 repeat/rotation)
export function pbrTex(name, map, { tile, rot = 0, repeatX = 1 } = {}) {
  const s = getSet(name);
  const base = s.maps[map];
  if (!base) return null;
  const t = base.clone();
  const tl = tile || s.def.tile;
  t.repeat.set(repeatX / tl, 1 / tl);
  if (rot) { t.rotation = rot; t.center.set(0, 0); }
  t.anisotropy = aniso;
  t.needsUpdate = true;
  s.all.push(t);
  return t;
}
export function onPbrFail(name, fn) {
  const s = getSet(name);
  if (s.failed) { fn(name); return; }
  if (!failHandlers.has(name)) failHandlers.set(name, []);
  failHandlers.get(name).push(fn);
}
export const pbrHas = (name) => !!PBR_SETS[name];
