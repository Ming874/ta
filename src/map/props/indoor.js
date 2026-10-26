// 室內道具與房間擺設(醫療、公共空間、辦公、宗教、兒童、地下室室內房間)。
// 由道具代理 A 實作;每個 theme 一個擺設函式,道具模型放在 src/map/props/indoor/*.js。
export const INDOOR_THEMES = new Set([
  'xray', 'ct', 'pharmacy', 'cafeteria', 'rehab', 'waiting', 'er', 'chapel', 'lobby', 'security', 'corridor', 'stairwell',
  'ward', 'surgery', 'icu', 'nursery', 'delivery', 'playroom', 'peds_ward',
  'director', 'office', 'psych_cell', 'monitor', 'dorm',
  'morgue', 'autopsy', 'archive', 'laundry', 'supply',
]);

export function dressIndoor(ctx, zone) {
  void ctx;
  void zone;
}
