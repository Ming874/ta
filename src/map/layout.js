// 醫院平面圖:每格 2m。row 0 在北邊,row 越大越靠南(南邊是大門)。
// # 牆  . 地板  Z 殭屍出生點  P 玩家起點
export const CELL = 2;
export const WALL_H = 3.2;

const rep = (line, n) => Array(n).fill(line);

export const ROWS = [
  '##############################', // 0
  '#Z..#Z....#Z....#Z....#Z.....#', // 1  病房 A-E
  ...rep('#...#.....#.....#.....#......#', 4), // 2-5
  '##.####.#####.#####.#####.####', // 6  病房門
  ...rep('#............................#', 2), // 7-8 北走廊
  '####.#######......#######.####', // 9
  '#Z......#Z...........#......Z#', // 10 手術室 / 候診區 / 儲藏室
  ...rep('#.......#............#.......#', 6), // 11-16
  '####.#######......#######.####', // 17
  ...rep('#............................#', 3), // 18-20 大廳
  '#..............P.............#', // 21
  ...rep('#............................#', 2), // 22-23
  ...rep('#############....#############', 2), // 24-25 玄關(大門在 row 26)
  '##############################', // 26
];

export function parseLayout() {
  const rows = ROWS;
  const h = rows.length;
  const w = rows[0].length;
  const solid = new Uint8Array(w * h);
  const spawns = [];
  let start = { x: 30, z: 42 };
  for (let r = 0; r < h; r++) {
    if (rows[r].length !== w) throw new Error(`layout row ${r} width ${rows[r].length} != ${w}`);
    for (let c = 0; c < w; c++) {
      const ch = rows[r][c];
      if (ch === '#') solid[r * w + c] = 1;
      else if (ch === 'Z') spawns.push({ x: (c + 0.5) * CELL, z: (r + 0.5) * CELL });
      else if (ch === 'P') start = { x: (c + 0.5) * CELL, z: (r + 0.5) * CELL };
    }
  }
  return { w, h, solid, spawns, start };
}
