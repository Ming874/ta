// 殭屍類型數值表(血量、速度、攻擊、金幣…集中在這裡調整)
export const TYPES = {
  walker: {
    name: '行屍', hp: 150, speed: [0.8, 1.25], coins: 5, radius: 0.34, mass: 1, reach: 1.05, dmg: 10, cd: 1.5, turn: 6,
  },
  runner: {
    name: '狂奔者', hp: 90, speed: [3.9, 4.5], coins: 6, radius: 0.32, mass: 0.9, reach: 1.0, dmg: 6, cd: 1.0, turn: 10,
    lunge: { min: 2.2, max: 4.2, speed: 7.6, dmg: 14, cd: [2.5, 4.5] },
  },
  crawler: {
    name: '爬行者', hp: 80, speed: [1.25, 1.6], coins: 5, radius: 0.3, mass: 0.7, reach: 1.0, dmg: 8, cd: 1.1, turn: 4,
  },
  bloater: {
    name: '膿腫者', hp: 220, speed: [0.65, 0.85], coins: 8, radius: 0.46, mass: 1.8, reach: 1.15, dmg: 8, cd: 1.6, turn: 3.5,
    spit: { min: 3.5, max: 14, cd: [3.2, 4.8], dmg: 15 }, explode: { radius: 3.2, player: 30, zombie: 80 },
  },
  brute: {
    name: '巨屍', hp: 900, speed: [1.05, 1.2], coins: 25, radius: 0.58, mass: 5, reach: 1.7, dmg: 25, cd: 2.2, turn: 3,
    charge: { min: 4.5, max: 15, speed: 7.4, dmg: 32, cd: [6, 9] }, bodyArmor: 0.55,
  },
};

// 第 n 回合的出怪清單:第 1 回合只有行屍,之後逐步加入新類型(首次出現的回合保證至少一隻)
export function roster(n) {
  const count = 5 + 3 * (n - 1);
  const brutes = n >= 5 ? 1 + Math.floor((n - 5) / 5) : 0;
  const pr = n >= 2 ? Math.min(0.3, 0.1 + 0.03 * n) : 0;
  const pc = n >= 3 ? 0.14 : 0;
  const pb = n >= 4 ? Math.min(0.14, 0.05 + 0.015 * n) : 0;
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
