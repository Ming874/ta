import * as THREE from 'three';

// 戶外與工業區道具(停車場、後巷、墓園、遊戲場、中庭、頂樓、逃生梯、地下工業房間、納骨堂)
// 以及大型障礙物('X' 格:車、救護車、靈車、子母車、發電機、焚化爐、噴水池、雕像、水塔、冷氣主機…)。
// 由道具代理 B 實作;道具模型放在 src/map/props/outdoor/*.js。
export const OUTDOOR_THEMES = new Set([
  'alley', 'playground', 'cemetery', 'yard', 'ambulance_bay', 'plaza', 'parking', 'courtyard', 'rooftop', 'fire_escape',
  'tunnel', 'ossuary', 'boiler', 'dock', 'ramp', 'incinerator', 'pump', 'machine', 'stair_ext',
]);

export function dressOutdoor(ctx, zone) {
  void ctx;
  void zone;
}

// 佔位:先放一個有碰撞的方塊,讓碰撞/導航/視線正確;道具代理 B 會換成真正的模型
export function dressObstacle(ctx, o) {
  const h = { car: 1.5, police_car: 1.5, ambulance: 2.6, ambulance_crash: 2.6, hearse: 1.6, dumpster: 1.4, generator: 1.6, incinerator: 3, fountain: 1.2, statue: 3.2, water_tower: 4, ac_unit: 1.4, barricade: 1.1 }[o.kind] ?? 1.5;
  const m = new THREE.Mesh(new THREE.BoxGeometry(o.sx * 0.9, h, o.sz * 0.9), ctx.mat('metal_gray'));
  m.position.set(o.x, o.y + h / 2, o.z);
  ctx.add(m, { collide: true });
}
