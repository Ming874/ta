import { dressIndoor, INDOOR_THEMES } from './indoor.js';
import { dressOutdoor, dressObstacle, OUTDOOR_THEMES } from './outdoor.js';

// 道具擺設入口:依區域 theme 分派到室內 / 戶外工業兩個模組,再擺大型障礙物('X' 格)。
// 商店('shop' 主題)由 src/shop.js 自己建,這裡跳過。
export function dressWorld(ctx) {
  for (const zone of ctx.L.zones) {
    if (zone.theme === 'shop') continue;
    if (INDOOR_THEMES.has(zone.theme)) dressIndoor(ctx, zone);
    else if (OUTDOOR_THEMES.has(zone.theme)) dressOutdoor(ctx, zone);
  }
  for (const o of ctx.L.obstacles) dressObstacle(ctx, o);
}
