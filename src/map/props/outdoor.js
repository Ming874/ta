import * as THREE from 'three';
import { initMats } from './outdoor/mats.js';
import { buildObstacle } from './outdoor/obstacles.js';
import { THEMES } from './outdoor/themes.js';

// 戶外與工業區道具(停車場、後巷、墓園、遊戲場、中庭、頂樓、逃生梯、地下工業房間、納骨堂)
// 以及大型障礙物('X' 格:車、救護車、靈車、子母車、發電機、焚化爐、噴水池、雕像、水塔、冷氣主機…)。
// 模型與擺設在 src/map/props/outdoor/*.js:
//   kit.js 幾何/合併/實例池/動態物件   mats.js 材質與程式貼圖   gltf.js 下載模型(CC0)
//   vehicles.js 車輛   obstacles.js 大型障礙物   street.js 街道設施   nature.js 植物   play.js 遊樂設施
//   industrial.js 管線機械   figures.js 雕像人形   themes.js 各主題擺設
export const OUTDOOR_THEMES = new Set([
  'alley', 'playground', 'cemetery', 'yard', 'ambulance_bay', 'plaza', 'parking', 'courtyard', 'rooftop', 'fire_escape',
  'tunnel', 'ossuary', 'boiler', 'dock', 'ramp', 'incinerator', 'pump', 'machine', 'stair_ext',
]);

export function dressOutdoor(ctx, zone) {
  initMats();
  const fn = THEMES[zone.theme];
  if (fn) fn(ctx, zone);
}

// 大型障礙物:佔滿 rect 的格子並登記碰撞
export function dressObstacle(ctx, o) {
  initMats();
  if (buildObstacle(ctx, o)) return;
  // 未知種類:有碰撞的方塊(確保碰撞/導航/視線正確)
  const h = 1.5;
  const m = new THREE.Mesh(new THREE.BoxGeometry(o.sx * 0.9, h, o.sz * 0.9), ctx.mat('metal_gray'));
  m.position.set(o.x, o.y + h / 2, o.z);
  ctx.add(m, { collide: true });
}
