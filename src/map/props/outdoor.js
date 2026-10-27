import * as THREE from 'three';
import { initMats } from './outdoor/mats.js';
import { initGround } from './outdoor/ground.js';
import { initNature } from './outdoor/nature.js';
import { initPlay } from './outdoor/play.js';
import { initCamp } from './outdoor/camp.js';
import { initFurniture } from './outdoor/furniture.js';
import { buildObstacle } from './outdoor/obstacles.js';
import { THEMES } from './outdoor/themes.js';

// 戶外與工業區道具(停車場、後巷、墓園、遊戲場、中庭、頂樓、逃生梯、地下工業房間、納骨堂)
// 以及大型障礙物('X' 格:車、救護車、靈車、子母車、發電機、焚化爐、噴水池、雕像、水塔、冷氣主機…)。
// 模型與擺設在 src/map/props/outdoor/*.js:
//   kit.js 幾何/合併/實例池/動態物件   mats.js 材質與程式貼圖   gltf.js 下載模型(CC0)
//   vehicles.js 車輛   obstacles.js 大型障礙物   street.js 路燈拒馬   furniture.js 街道家具   nature.js 植物烏鴉   play.js 遊樂設施
//   camp.js 災難現場(帳篷/屍袋/檢查站)   ground.js 地面標線/緣石/人孔/雜物   industrial.js 管線機械   figures.js 雕像人形
//   basement.js 地下室工業房間   edges.js 地圖外圍景   themes.js 各主題擺設   env.js 天氣共用狀態(風/閃電/燈具閃爍)
export const OUTDOOR_THEMES = new Set([
  'alley', 'playground', 'cemetery', 'yard', 'ambulance_bay', 'plaza', 'parking', 'courtyard', 'rooftop', 'fire_escape',
  'tunnel', 'ossuary', 'boiler', 'dock', 'ramp', 'incinerator', 'pump', 'machine', 'stair_ext',
]);

function initAll() { initMats(); initGround(); initNature(); initPlay(); initCamp(); initFurniture(); }
export function dressOutdoor(ctx, zone) {
  initAll();
  const fn = THEMES[zone.theme];
  if (!fn) return;
  try { fn(ctx, zone); } catch (e) { console.error('[props-out] 擺設失敗', zone.id, e); }
}

// 大型障礙物:佔滿 rect 的格子並登記碰撞
export function dressObstacle(ctx, o) {
  initAll();
  if (buildObstacle(ctx, o)) return;
  // 未知種類:有碰撞的方塊(確保碰撞/導航/視線正確)
  const h = 1.5;
  const m = new THREE.Mesh(new THREE.BoxGeometry(o.sx * 0.9, h, o.sz * 0.9), ctx.mat('metal_gray'));
  m.position.set(o.x, o.y + h / 2, o.z);
  ctx.add(m, { collide: true });
}
