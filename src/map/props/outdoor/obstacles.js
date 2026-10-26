import { placeCar, placePolice, placeAmbulance, placeHearse } from './cars.js';

// 大型障礙物分派(L.obstacles):每種都佔滿格子範圍並登記碰撞
export function buildObstacle(ctx, o) {
  const zone = ctx.L.zoneAt(o.levelIndex, Math.floor(o.x / ctx.CELL), Math.floor(o.z / ctx.CELL));
  switch (o.kind) {
    case 'car': placeCar(ctx, o); return true;
    case 'police_car': placePolice(ctx, o, zone); return true;
    case 'ambulance': placeAmbulance(ctx, o, zone, false); return true;
    case 'ambulance_crash': placeAmbulance(ctx, o, zone, true); return true;
    case 'hearse': placeHearse(ctx, o, zone); return true;
    default: return false;
  }
}

// 展示間(檢視腳本用):依名稱建單一障礙物
export const GALLERY = {
  police_car: (ctx, o) => { o.sx = 4; o.sz = 2; placePolice(ctx, o, null); return 2; },
  ambulance: (ctx, o) => { o.sx = 6; o.sz = 2; placeAmbulance(ctx, o, null, false); return 2.8; },
  ambulance_crash: (ctx, o) => { o.sx = 6; o.sz = 2; placeAmbulance(ctx, o, null, true); return 2.8; },
  hearse: (ctx, o) => { o.sx = 6; o.sz = 2; placeHearse(ctx, o, null); return 1.6; },
  car: (ctx, o) => { o.sx = 4; o.sz = 2; placeCar(ctx, o); return 1.5; },
};
