// 殭屍類型數值表(血量、速度、攻擊、金幣…集中在這裡調整)
export const TYPES = {
  walker: {
    name: '行屍', hp: 150, speed: [0.95, 1.4], coins: 6, radius: 0.34, mass: 1, reach: 1.05, dmg: 10, cd: 1.5, turn: 6,
  },
  runner: {
    name: '狂奔者', hp: 90, speed: [3.9, 4.5], coins: 8, radius: 0.32, mass: 0.9, reach: 1.0, dmg: 6, cd: 1.0, turn: 10,
    lunge: { min: 2.2, max: 4.2, speed: 7.6, dmg: 14, cd: [2.5, 4.5] },
  },
  crawler: {
    name: '爬行者', hp: 80, speed: [1.35, 1.7], coins: 7, radius: 0.3, mass: 0.7, reach: 1.0, dmg: 8, cd: 1.1, turn: 4,
  },
  bloater: {
    name: '膿腫者', hp: 220, speed: [0.75, 0.95], coins: 12, radius: 0.46, mass: 1.8, reach: 1.15, dmg: 8, cd: 1.6, turn: 3.5,
    spit: { min: 3.5, max: 14, cd: [3.2, 4.8], dmg: 15 }, explode: { radius: 3.2, player: 30, zombie: 80 },
  },
  brute: {
    name: '巨屍', hp: 900, speed: [1.1, 1.25], coins: 45, radius: 0.58, mass: 5, reach: 1.7, dmg: 25, cd: 2.2, turn: 3,
    charge: { min: 4.5, max: 15, speed: 7.4, dmg: 32, cd: [6, 9] }, bodyArmor: 0.55,
  },
};

// 第 n 回合的出怪清單:第 1 回合只有行屍,之後逐步加入新類型(首次出現的回合保證至少一隻)
// 地圖是 4 層約 17000m²:每回合數量隨回合加速成長,搭配 pace() 的同場上限與生成間隔讓節奏保持緊湊
export function roster(n) {
  const count = 5 + 3 * n + Math.floor((n * n) / 10); // 8, 11, 14, 18, 22, 26, 30, 35 … 第 10 回合 45
  const brutes = n >= 5 ? 1 + Math.floor((n - 5) / 4) : 0;
  const pr = n >= 2 ? Math.min(0.32, 0.08 + 0.03 * n) : 0;
  const pc = n >= 3 ? 0.13 : 0;
  const pb = n >= 4 ? Math.min(0.15, 0.04 + 0.015 * n) : 0;
  const list = [];
  for (let i = 0; i < count - brutes; i++) {
    const r = Math.random();
    list.push(r < pr ? 'runner' : r < pr + pc ? 'crawler' : r < pr + pc + pb ? 'bloater' : 'walker');
  }
  const intro = { 2: 'runner', 3: 'crawler', 4: 'bloater' }[n];
  if (intro && !list.includes(intro)) list[1 + Math.floor(Math.random() * (list.length - 1))] = intro;
  for (let k = 0; k < brutes; k++) list.splice(Math.floor(list.length * (0.35 + 0.5 * Math.random())), 0, 'brute');
  return list;
}

// 第 n 回合的節奏:同場上限、平均生成間隔(秒)、開場連續快速生成的數量
export function pace(n) {
  return {
    maxAlive: Math.min(16, 7 + n),
    interval: Math.max(0.55, 1.75 - 0.1 * n),
    burst: Math.min(5, 2 + Math.floor(n / 3)),
  };
}
