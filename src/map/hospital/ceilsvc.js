import * as THREE from 'three';

// [scene6] 天花板設備:灑水頭、偵煙器、廣播喇叭、回風口。真實醫院的天花板幾乎每 2~4m 就有一個;沒有它們,輕鋼架天花板讀起來像空白貼圖。
// 只放在完整(沒掉板)的輕鋼架格子上,位置對齊 2/3m 的天花板格中心(和格線同一套節奏)。
// 幾何進結構的收邊桶(trim_white / trim_steel / trim_dark → TRIM_MATTE/METAL 桶,每層本來就有)→ 不新增材質與 draw call。
// 亂數用格座標雜湊,不動 shell 的 K.R 序列(其他隨機擺設不會因此改變)。
const T = 2 / 3;
const hash = (c, r, k) => { const s = Math.sin(c * 127.1 + r * 311.7 + k * 74.7) * 43758.5453; return s - Math.floor(s); };
const _m = new THREE.Matrix4(), _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(1, 1, 1);
let G = null;
function geos() {
  if (G) return G;
  const cyl = (r0, r1, h, n) => new THREE.CylinderGeometry(r0, r1, h, n, 1, false);
  G = {
    ring: cyl(0.038, 0.04, 0.008, 12), // 灑水頭飾蓋
    body: cyl(0.009, 0.011, 0.035, 8),
    defl: cyl(0.02, 0.02, 0.003, 10), // 迴水板
    bulb: cyl(0.0035, 0.0035, 0.016, 5), // 玻璃球(紅)
    det: cyl(0.06, 0.065, 0.035, 18), // 偵煙器
    detBase: cyl(0.07, 0.07, 0.008, 18),
    detLed: cyl(0.005, 0.005, 0.004, 6),
    spk: cyl(0.11, 0.11, 0.012, 20), // 喇叭面板
    spkRing: new THREE.TorusGeometry(0.075, 0.004, 3, 20).rotateX(Math.PI / 2),
    spkRing2: new THREE.TorusGeometry(0.045, 0.004, 3, 16).rotateX(Math.PI / 2),
    box: new THREE.BoxGeometry(1, 1, 1),
  };
  return G;
}
const put = (B, li, key, g, x, y, z, sx = 1, sy = 1, sz = 1) => { _p.set(x, y, z); _s.set(sx, sy, sz); _m.compose(_p, _q, _s); B.geo(li, key, g, _m); };

// 一格(2m)輕鋼架天花板的設備。zone:該格所屬區域;yC:天花板高度
export function ceilServices(B, li, c, r, yC, zone) {
  if (!zone) return;
  const th = zone.theme, corr = th === 'corridor', g = geos();
  const x0 = c * 2, z0 = r * 2;
  const tc = (i) => i * T + T / 2; // 第 i 片板的中心
  // 灑水頭:每 2 格一個(約 4m 間距),放在中央那片板
  if ((c + r) % 2 === 0 && hash(c, r, 1) < 0.92) {
    const x = x0 + 1, z = z0 + 1;
    put(B, li, 'trim_white', g.ring, x, yC - 0.004, z);
    put(B, li, 'trim_brass', g.body, x, yC - 0.025, z);
    put(B, li, 'trim_brass', g.defl, x, yC - 0.045, z);
    put(B, li, 'trim_red', g.bulb, x + 0.008, yC - 0.03, z);
  }
  // 偵煙器:走廊約每 3 格、房間每 4 格
  if (hash(c, r, 2) < (corr ? 0.34 : 0.22)) {
    const x = x0 + tc(0), z = z0 + tc(2);
    put(B, li, 'trim_white', g.detBase, x, yC - 0.004, z);
    put(B, li, 'trim_white', g.det, x, yC - 0.025, z);
    put(B, li, 'trim_red', g.detLed, x + 0.035, yC - 0.044, z); // 早就不亮的指示燈
  }
  // 廣播喇叭(「不要相信廣播」):走廊約每 4 格一個,圓形白面板 + 兩圈格柵
  if (corr && hash(c, r, 3) < 0.26) {
    const x = x0 + tc(2), z = z0 + tc(0);
    put(B, li, 'trim_white', g.spk, x, yC - 0.006, z);
    put(B, li, 'trim_dark', g.spkRing, x, yC - 0.013, z);
    put(B, li, 'trim_dark', g.spkRing2, x, yC - 0.013, z);
  }
  // 回風口:一片板換成白框 + 百葉(後面黑)
  if (hash(c, r, 4) < (corr ? 0.12 : 0.16)) {
    const x = x0 + tc(2), z = z0 + tc(2), w = T - 0.04;
    put(B, li, 'trim_plenum', g.box, x, yC - 0.002, z, w - 0.04, 0.002, w - 0.04);
    for (const [dx, dz, sx, sz] of [[0, -w / 2 + 0.015, w, 0.03], [0, w / 2 - 0.015, w, 0.03], [-w / 2 + 0.015, 0, 0.03, w], [w / 2 - 0.015, 0, 0.03, w]]) put(B, li, 'trim_white', g.box, x + dx, yC - 0.008, z + dz, sx, 0.012, sz);
    const along = hash(c, r, 5) < 0.5;
    for (let k = 0; k < 7; k++) { const o = -w / 2 + 0.06 + k * ((w - 0.12) / 6); put(B, li, 'trim_white', g.box, x + (along ? 0 : o), yC - 0.012, z + (along ? o : 0), along ? w - 0.05 : 0.012, 0.02, along ? 0.012 : w - 0.05); }
  }
}
