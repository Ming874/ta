// 室內道具與房間擺設(醫療、公共空間、辦公、宗教、兒童、地下室室內房間)。
// 每個 theme 一個擺設函式(src/map/props/indoor/th_*.js),道具模型在 src/map/props/indoor/*.js。
// 規劃器 Room(indoor/place.js)負責:不擋路的可達性檢查、碰撞登記(ctx.add)、區域內依材質合併、實例化小物件、可推動道具。
import { Room } from './indoor/place.js';
import { THEMES } from './indoor/themes.js';

export const INDOOR_THEMES = new Set([
  'xray', 'ct', 'pharmacy', 'cafeteria', 'rehab', 'waiting', 'er', 'chapel', 'lobby', 'security', 'corridor', 'stairwell',
  'ward', 'surgery', 'icu', 'nursery', 'delivery', 'playroom', 'peds_ward',
  'director', 'office', 'psych_cell', 'monitor', 'dorm',
  'morgue', 'autopsy', 'archive', 'laundry', 'supply',
]);

export function dressIndoor(ctx, zone) {
  const fn = THEMES[zone.theme];
  if (!fn) return;
  const R = new Room(ctx, zone);
  try {
    fn(R, zone);
  } catch (e) {
    console.warn('[props-in] 擺設失敗', zone.id, e && e.stack ? e.stack.split('\n').slice(0, 4).join(' | ') : e);
  }
  R.done();
}
