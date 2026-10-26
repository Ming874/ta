import { prng, hashStr } from './paint.js';

// 區域 → 牆/地板/天花板做法。同一個 levels.js 的 wall 鍵,依主題/樓層會換成不同的配方
// (護牆板高度、腰線、踢腳板、扶手、牆角護條、磁磚高度…),讓每一區看起來都不一樣。
// 牆配方:up 上段材質、low 下段材質(到 dado 高)、rail 腰線、base 踢腳板、hand 扶手、guard 牆角護條、
//         bumper 推床防撞條、stripe 色帶(樓梯間)、tint 色調、dirt 髒污程度
const W = (up, o = {}) => ({ up, ...o });
const THEME_WALL = {
  corridor: { '1F': W('paint_green', { low: 'dado_green', dado: 1.1, rail: 'trim_wood', base: 'trim_rubber', hand: 'trim_wood', guard: 'trim_steel' }),
    '2F': W('paint_mint', { low: 'dado_teal', dado: 1.0, rail: 'trim_steel', base: 'trim_rubber', hand: 'trim_steel', guard: 'trim_steel', tint: [0.98, 1.0, 0.98] }),
    '3F': W('paint_sterile', { low: 'dado_gray', dado: 1.25, base: 'trim_rubber', guard: 'trim_white', tint: [0.97, 0.98, 1.02] }),
    B1: W('concrete_wall', { base: 'trim_concrete' }) },
  ward: W('paint_mint', { low: 'dado_teal', dado: 0.9, bumper: 'trim_white', base: 'trim_rubber' }),
  pharmacy: W('paint_olive', { low: 'dado_brown', dado: 1.1, rail: 'trim_wood', base: 'trim_rubber' }),
  waiting: W('paint_green', { low: 'dado_green', dado: 1.1, rail: 'trim_wood', base: 'trim_rubber', tint: [1.03, 1.02, 0.94] }),
  xray: W('paint_white', { low: 'dado_gray', dado: 1.2, base: 'trim_rubber', stripe: 'trim_yellow' }),
  ct: W('paint_sterile', { low: 'dado_gray', dado: 1.2, base: 'trim_rubber' }),
  rehab: W('paint_cream', { low: 'dado_brown', dado: 1.0, hand: 'trim_wood', base: 'trim_wood' }),
  cafeteria: W('paint_cream', { low: 'tile_subway', dado: 1.6, rail: 'trim_dark', base: 'trim_dark' }),
  er: W('paint_sterile', { low: 'tile_white', dado: 1.5, rail: 'trim_steel', base: 'trim_rubber', guard: 'trim_steel', tint: [1.02, 0.97, 0.96] }),
  chapel: W('plaster_chapel', { low: 'dado_brown', dado: 1.2, rail: 'trim_wood', base: 'trim_wood', pilaster: 'trim_stone' }),
  lobby: W('plaster', { low: 'marble_wall', dado: 1.2, rail: 'trim_marble', base: 'trim_stone' }),
  shop: W('paint_white', { low: 'dado_gray', dado: 1.0, base: 'trim_rubber' }),
  security: W('paint_gray', { low: 'dado_gray', dado: 1.1, base: 'trim_rubber' }),
  stairwell: W('cmu_paint', { stripe: 'trim_red', base: 'trim_concrete' }),
  surgery: W('paint_sterile', { low: 'tile_green', dado: 2.3, rail: 'trim_steel', base: 'trim_steel', guard: 'trim_steel' }),
  icu: W('paint_sterile', { low: 'dado_gray', dado: 1.0, bumper: 'trim_white', base: 'trim_rubber', guard: 'trim_steel', tint: [0.97, 1.0, 1.02] }),
  nursery: W('wallpaper_ducks', { low: 'dado_rose', dado: 1.0, rail: 'trim_white', base: 'trim_white' }),
  delivery: W('paint_pink', { low: 'tile_pink', dado: 1.8, rail: 'trim_white', base: 'trim_rubber' }),
  playroom: W('wallpaper_stars', { low: 'dado_teal', dado: 1.0, rail: 'trim_white', base: 'trim_white' }),
  peds_ward: W('wallpaper_animals', { low: 'dado_green', dado: 1.0, rail: 'trim_white', base: 'trim_white' }),
  director: W('wood_panel', { base: 'trim_wood' }),
  office: W('paint_cream', { low: 'dado_brown', dado: 0.9, rail: 'trim_wood', base: 'trim_wood' }),
  psych_cell: W('padded'),
  monitor: W('paint_gray', { low: 'dado_gray', dado: 1.0, base: 'trim_rubber', tint: [0.95, 0.97, 1.02] }),
  dorm: W('plaster_dorm', { low: 'dado_brown', dado: 1.0, rail: 'trim_wood', base: 'trim_wood' }),
  morgue: W('tile_white', { base: 'trim_steel', tint: [0.94, 0.98, 1.02] }),
  autopsy: W('tile_white', { base: 'trim_steel', tint: [1.0, 0.97, 0.95] }),
  archive: W('paint_gray', { low: 'dado_gray', dado: 1.1, base: 'trim_rubber', tint: [1.02, 0.99, 0.92] }),
  laundry: W('paint_blue', { low: 'tile_blue', dado: 1.5, rail: 'trim_dark', base: 'trim_dark' }),
  supply: W('paint_gray', { low: 'dado_gray', dado: 1.2, base: 'trim_rubber', tint: [0.98, 1.0, 0.95] }),
  tunnel: W('concrete_wall', { base: 'trim_concrete', stripe: 'trim_yellow', tint: [0.95, 0.95, 0.9] }),
  ossuary: W('stone_wall'),
  boiler: W('concrete_wall', { low: 'dado_gray', dado: 1.0, base: 'trim_concrete', tint: [1.04, 0.98, 0.9] }),
  pump: W('concrete_wet_wall', { tint: [0.9, 0.96, 0.98] }),
  dock: W('cmu_paint', { stripe: 'trim_yellow', base: 'trim_concrete', tint: [0.96, 0.95, 0.9] }),
  ramp: W('concrete_wall', { stripe: 'trim_yellow' }),
  incinerator: W('brick'),
  machine: W('cmu_paint', { base: 'trim_concrete', tint: [0.92, 0.94, 0.95] }),
  stair_ext: W('concrete_wet_wall'),
};
export const FACADE = W('facade'), COURT = W('facade_dark', { tint: [0.92, 0.95, 0.92] }), BOUNDARY = W('brick_old');
export const REVEAL = W('paint_white', { tint: [0.92, 0.92, 0.9] });

const FLOOR_BY_THEME = {
  corridor: { '1F': 'tile_ward', '2F': 'linoleum_b', '3F': 'linoleum_c' },
  ward: 'linoleum', icu: 'linoleum_c', xray: 'linoleum_b', ct: 'linoleum_b', pharmacy: 'linoleum_b', security: 'linoleum_c', monitor: 'linoleum_c',
  archive: 'linoleum_b', nursery: 'linoleum_d', peds_ward: 'linoleum_d', cafeteria: 'tile_ward_b', laundry: 'tile_ward_b',
  chapel: 'wood_parquet', rehab: 'wood_gym', director: 'wood_floor', dorm: 'wood_old', playroom: 'carpet_kids', office: 'carpet',
  dock: 'concrete_paint', boiler: 'concrete_paint', supply: 'concrete_paint', machine: 'concrete_paint',
};
const FLOOR_BY_KEY = { tile_white: 'tile_white_floor', padded: 'padded_floor' };
export function floorKey(zone, lvId) {
  if (!zone) return 'concrete';
  const t = FLOOR_BY_THEME[zone.theme];
  if (t) return typeof t === 'string' ? t : t[lvId] || zone.floor;
  return FLOOR_BY_KEY[zone.floor] || zone.floor || 'concrete';
}
// 天花板:ceil 鍵優先,其次主題
const CEIL_BY_THEME = {
  lobby: 'ceil_plaster', chapel: 'ceil_wood', director: 'ceil_wood', dorm: 'ceil_plaster', psych_cell: 'ceil_plaster',
  stairwell: 'ceil_concrete', morgue: 'ceil_concrete', autopsy: 'ceil_plaster', dock: 'ceil_concrete', ramp: 'ceil_concrete',
  incinerator: 'ceil_concrete', boiler: 'ceil_concrete', machine: 'ceil_concrete', tunnel: 'ceil_concrete', pump: 'ceil_concrete', supply: 'ceil_concrete',
  laundry: 'ceil_tile_b', archive: 'ceil_tile_b', stair_ext: 'ceil_concrete', ossuary: 'vault_stone',
};
export function ceilKey(zone, lvId) {
  if (!zone) return lvId === 'B1' ? 'ceil_concrete' : 'ceil_tile';
  if (zone.ceil === 'pipes') return 'ceil_concrete';
  if (zone.ceil === 'vault') return 'vault_stone';
  return CEIL_BY_THEME[zone.theme] || (zone.light === 'fluoro_dying' ? 'ceil_tile_b' : 'ceil_tile');
}
export function wallRecipe(zone, lvId) {
  if (!zone) return THEME_WALL.corridor[lvId] || THEME_WALL.corridor['1F'];
  const t = THEME_WALL[zone.theme];
  if (!t) return W(zone.wall || 'paint_white');
  return t.up ? t : t[lvId] || t['1F'];
}
// 每個區域的色調(固定,依區域 id 雜湊)× 配方色調
const tintCache = new Map();
export function zoneTint(zone, recipe) {
  const key = (zone ? zone.id : 'none') + '|' + recipe.up;
  let t = tintCache.get(key);
  if (t) return t;
  const R = prng(hashStr(key));
  const k = R.r(0.9, 1.04), base = recipe.tint || [1, 1, 1];
  t = [base[0] * k * R.r(0.97, 1.03), base[1] * k * R.r(0.97, 1.03), base[2] * k * R.r(0.96, 1.03)];
  tintCache.set(key, t);
  return t;
}
export const OUTDOOR_THEMES = new Set(['alley', 'playground', 'cemetery', 'yard', 'ambulance_bay', 'plaza', 'parking', 'courtyard', 'rooftop', 'fire_escape']);
