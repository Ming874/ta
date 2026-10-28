import * as THREE from 'three';
import { sfx, ix as ixs } from '../audio.js';
import { Model, mats } from './kit.js';
import { rng } from '../map/props/ctx.js';
import { MATS } from '../physics/truth.js';

// 門:醫院每一扇門扇(src/map/hospital/leaves.js 的代理)都有實體碰撞盒,並且可以開關、釘木板。
//  開著:門扇停在牆邊 → 一般碰撞盒(擋人、擋子彈、導航繞過)
//  半開/關著:碰撞盒照樣擋人擋子彈,但標記 nav:false → 導航照樣穿過;殭屍走到門前會把門推開(巨屍直接撞開)
//  釘木板(單人/房主):碰撞盒 + 木板;殭屍要捶一陣子才破(巨屍幾下),破掉時木板變成物理碎片飛出去
//  上鎖(劇情包 lock):關著、導航繞過,拿到鑰匙/旗標成立才打得開
// 碰撞盒只在門停住時更新(addBox/removeBox 會把導航局部重建排進佇列,不會整張重建)。
// 多人:開關門與木板狀態用 'ixd' 事件同步(殭屍推門由房主判定後廣播);晚加入的人看到的是門的初始狀態。
const _v = new THREE.Vector3();
const PUSH = { walker: 1, runner: 1.7, crawler: 0.7, bloater: 0.9, brute: 5 };
const KIND = { fire: 'fire', cell: 'cell', glass: 'glass', wood: 'wood', chapel: 'wood', metal: 'fire', swing: 'ward', ward: 'ward' };
const NAME = { fire: '防火門', cell: '隔離房門', glass: '玻璃門', wood: '木門', chapel: '禮拜堂木門', metal: '鐵門', swing: '雙開門', ward: '病房門' };
// 子彈穿透類別(physics/truth.js MATS):木門/病房門 = wood、玻璃門 = glass、鐵門/雙開門 = metal、防火門與隔離房門 = heavy(手槍打不穿)
const PEN = { fire: 'heavy', cell: 'heavy', metal: 'metal', swing: 'metal', glass: 'glass', ward: 'wood', wood: 'wood', chapel: 'wood' };
const BARRICADE_COST = 10, BARRICADE_HP = 9, MAX_BARRICADES = 3;
const angDiff = (a, b) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));

export function setupDoors(game, ix, { leaves = [], seed = 77, lockSpecs = [] } = {}) {
  const world = game.world, R = rng(seed);
  const ways = new Map();
  for (const l of leaves) {
    let w = ways.get(l.door);
    if (!w) { w = { key: l.door, li: l.li, leaves: [], cx: l.cx, cz: l.cz, y: l.y, style: l.style, zone: l.zone, za: l.za, zb: l.zb, out: l.out, press: 0, pressT: -9, bar: null, lock: null, idx: ways.size }; ways.set(l.door, w); }
    w.leaves.push(l);
    l.boxes = [];
    l.anim = null;
  }
  const list = [...ways.values()];
  const kindOf = (w) => KIND[w.style] || 'ward';
  const isOpen = (l) => angDiff(l.group.rotation.y, l.swingA) < 0.15 || angDiff(l.group.rotation.y, l.swingB) < 0.15;
  const isClosed = (l) => angDiff(l.group.rotation.y, l.closed) < 0.12;
  const allClosed = (w) => w.leaves.every(isClosed);
  const anyShut = (w) => w.leaves.some((l) => !isOpen(l));

  // ---------- 碰撞盒 ----------
  function colliders(l) {
    for (const b of l.boxes) world.removeBox(b);
    l.boxes.length = 0;
    const a = l.group.rotation.y, c = Math.cos(a), s = -Math.sin(a), th = Math.max(0.1, (l.t || 0.06) + 0.04);
    const hx = l.group.position.x, hz = l.group.position.z, y0 = l.y, h = l.lh;
    const locked = !!(l.way?.lock && !l.way.lock.open); // [story] 解鎖之後(lock.open)就跟一般的門一樣
    const nav = isOpen(l) && !locked; // 開到牆邊的門扇:導航繞過;其他(半開/關著)導航穿過,殭屍會推
    const aligned = Math.abs(c) < 0.1 || Math.abs(s) < 0.1;
    const n = aligned ? 1 : Math.ceil(l.lw / 0.28);
    const seg = l.lw / n;
    for (let i = 0; i < n; i++) {
      const u = (i + 0.5) * seg;
      const sx = Math.abs(c) * seg + Math.abs(s) * th, sz = Math.abs(s) * seg + Math.abs(c) * th;
      const b = world.addBox(hx + c * u, hz + s * u, sx, sz, h, y0);
      if (!nav && !locked) b.nav = false; // 上鎖的門例外:導航繞過(殭屍不會卡在門前)
      b.leaf = l;
      b.pm = PEN[l.style] || 'wood'; b.mat = MATS[b.pm]?.fx || 'wood'; b.tag = 'door:' + l.style; // 子彈穿透與彈著效果
      l.boxes.push(b);
    }
    l.colA = a;
  }
  for (const w of list) for (const l of w.leaves) l.way = w;

  // 一開始有些房門是關著的(更像有人住過、也更緊張);樓梯間與戶外的門保持原狀
  for (const w of list) {
    if (w.out || w.style === 'fire' || w.style === 'glass' || w.leaves.length < 2) continue;
    if (R() < 0.22) for (const l of w.leaves) { l.group.rotation.y = l.closed; }
  }
  for (const l of leaves) colliders(l);

  // ---------- 動畫 ----------
  let animOn = false;
  const anims = new Set();
  function swing(l, to, dur = 0.55) {
    for (const b of l.boxes) world.removeBox(b);
    l.boxes.length = 0;
    l.anim = { from: l.group.rotation.y, to: l.group.rotation.y + Math.atan2(Math.sin(to - l.group.rotation.y), Math.cos(to - l.group.rotation.y)), t: 0, dur };
    anims.add(l);
    if (!animOn) { animOn = true; ix.tick(stepAnims); }
  }
  function stepAnims(dt) {
    for (const l of anims) {
      const A = l.anim;
      A.t += dt;
      const k = Math.min(1, A.t / A.dur), e = k < 1 ? 1 - Math.pow(1 - k, 3) : 1;
      l.group.rotation.y = A.from + (A.to - A.from) * e;
      if (k >= 1) { l.anim = null; anims.delete(l); colliders(l); }
    }
    if (!anims.size) { animOn = false; return false; }
    return true;
  }
  // 往遠離 (px,pz) 的那一側打開
  const awayFrom = (l, px, pz) => {
    const far = (a) => { const c = Math.cos(a), s = -Math.sin(a); return (l.group.position.x + c * l.lw - px) ** 2 + (l.group.position.z + s * l.lw - pz) ** 2; };
    return far(l.swingA) >= far(l.swingB) ? l.swingA : l.swingB;
  };
  const pos = (w, dy = 1.1) => ({ x: w.cx, y: w.y + dy, z: w.cz });
  const blocked = (w) => { // 關門前:門口有人/殭屍就不關
    const near = (p) => p && Math.abs(p.y - w.y) < 1.6 && Math.hypot(p.x - w.cx, p.z - w.cz) < 1.05;
    if (near(game.player.pos)) return true;
    for (const z of game.zombies) if (z.alive && near(z.pos)) return true;
    if (game.players) for (const p of game.players) if (p !== game.player && near(p.pos)) return true;
    return false;
  };

  function setState(w, st, { by = null, sound = true, net = true, fast = false } = {}) { // st:'closed' | 'open'
    for (const l of w.leaves) {
      const to = st === 'closed' ? l.closed : by ? awayFrom(l, by.x, by.z) : (isOpen(l) ? l.group.rotation.y : l.swingA);
      if (angDiff(l.group.rotation.y, to) < 0.02 && !l.anim) continue;
      swing(l, to, fast ? 0.28 : st === 'closed' ? 0.5 : 0.65);
    }
    if (sound) (st === 'closed' ? ixs.doorClose : ixs.doorOpen)(pos(w), kindOf(w));
    if (net) sync(w);
    ix.emit('door', w, st);
  }

  // ---------- 木板 ----------
  const planks = (() => {
    const m = new Model();
    m.box(mats().wood, 0x8a6b48, 0, 0, 0, 1, 1, 1);
    const im = new THREE.InstancedMesh(m.geometry(), mats().wood, MAX_BARRICADES * 3);
    im.name = 'ix-planks';
    im.castShadow = true;
    im.frustumCulled = false;
    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < im.count; i++) im.setMatrixAt(i, zero);
    game.scene.add(im);
    return { im, zero, slots: new Array(MAX_BARRICADES).fill(null) };
  })();
  const plankM = (w, side, k, out) => {
    const ax = w.leaves[0].axis, hy = w.y + 0.62 + k * 0.58 + (R() - 0.5) * 0.08, tilt = (k - 1) * 0.12 + (R() - 0.5) * 0.12;
    const off = 0.09 * side;
    const x = ax === 'z' ? w.cx : w.cx + off, z = ax === 'z' ? w.cz + off : w.cz;
    const e = new THREE.Euler(0, ax === 'z' ? 0 : Math.PI / 2, tilt);
    return out.compose(_v.set(x, hy, z), new THREE.Quaternion().setFromEuler(e), new THREE.Vector3(2.25, 0.17, 0.035));
  };
  function barricade(w, side, { net = true, sound = true } = {}) {
    let slot = planks.slots.indexOf(null);
    if (slot < 0) { const old = planks.slots.findIndex((x) => x); unbar(planks.slots[old], false, false); slot = old; }
    planks.slots[slot] = w;
    w.bar = { hp: BARRICADE_HP, slot, side, mats: [0, 1, 2].map((k) => plankM(w, side, k, new THREE.Matrix4())) };
    w.bar.mats.forEach((m, k) => planks.im.setMatrixAt(slot * 3 + k, m));
    planks.im.instanceMatrix.needsUpdate = true;
    for (const l of w.leaves) { if (!isClosed(l)) swing(l, l.closed, 0.3); else colliders(l); }
    if (sound) ixs.barricade(pos(w));
    if (net) sync(w);
    ix.emit('barricade', w);
  }
  function unbar(w, burst = false, net = true) {
    if (!w?.bar) return;
    const b = w.bar;
    w.bar = null;
    planks.slots[b.slot] = null;
    for (let k = 0; k < 3; k++) planks.im.setMatrixAt(b.slot * 3 + k, planks.zero);
    planks.im.instanceMatrix.needsUpdate = true;
    if (burst) {
      ixs.barricadeBreak(pos(w));
      const ph = game.physics;
      if (ph?.ready) for (const m of b.mats) { // 木板飛出去(物理碎片;共用材質與幾何 → 不會新增 shader)
        const mesh = new THREE.Mesh(planks.im.geometry, mats().wood);
        m.decompose(mesh.position, mesh.quaternion, mesh.scale);
        game.scene.add(mesh);
        const sx = (R() - 0.5) * 3, sz = (R() - 0.5) * 3;
        ph.addDebris(mesh, { vel: { x: sx, y: 1.5 + R() * 1.5, z: sz }, mass: 3, life: 7, shape: 'box' });
      }
      game.burst?.(_v.set(w.cx, w.y + 1.1, w.cz), new THREE.Vector3(0, 1, 0), 'dust', 12, w.y);
    }
    if (net) sync(w);
  }

  // ---------- 殭屍推門 / 捶木板(每秒 4 次;單人或房主) ----------
  let pushT = 0, extT = 0;
  ix.tick((dt) => {
    if (game.state !== 'playing') return true;
    if ((extT -= dt) <= 0) { // 驚嚇事件甩門 → 門停下來後更新碰撞盒
      extT = 0.25;
      for (const l of leaves) if (l.events && !l.anim && angDiff(l.group.rotation.y, l.colA) > 0.02) {
        if ((l.way.bar || (l.way.lock && !l.way.lock.open)) && angDiff(l.group.rotation.y, l.closed) > 0.02) { l.group.rotation.y = l.closed; continue; } // 釘了木板/上鎖的門:靈異事件推不動
        colliders(l);
      }
    }
    if ((pushT -= dt) > 0) return true;
    pushT = 0.25;
    if (game.net && !game.net.isHost) return true;
    for (const w of list) {
      if ((w.lock && !w.lock.open) || !anyShut(w)) { w.press = 0; continue; } // [story] 解鎖之後殭屍也推得開
      let who = null, k = 0;
      for (const z of game.zombies) {
        if (!z.alive) continue;
        const p = z.pos;
        if (Math.abs(p.y - w.y) > 1.6) continue;
        const d = Math.hypot(p.x - w.cx, p.z - w.cz);
        if (d > 1.15) continue;
        const kk = PUSH[z.type] || 1;
        if (kk > k) { k = kk; who = z; }
        z._noProg = 0; // 正在推門/捶門:不算卡住(不會瞬移走)
      }
      if (!who) { if (game.time - w.pressT > 1) w.press = 0; continue; }
      w.pressT = game.time;
      if (w.bar) {
        w.bar.hp -= 0.25 * k;
        if (R() < 0.6) ixs.doorBash(pos(w), who.type === 'brute');
        if (w.bar.hp <= 0) { unbar(w, true); setState(w, 'open', { by: who.pos, sound: false, fast: true }); }
        continue;
      }
      w.press += 0.25 * k;
      if (who.type === 'brute' || w.press >= 1) {
        w.press = 0;
        setState(w, 'open', { by: who.pos, fast: true, sound: false });
        (who.type === 'brute' ? ixs.doorBash : ixs.doorOpen)(pos(w), who.type === 'brute' ? true : kindOf(w));
      } else if (R() < 0.35) ixs.doorBash(pos(w), false);
    }
    return true;
  });

  // ---------- 多人同步 ----------
  let netBound = null;
  function sync(w) {
    const s = game.net;
    if (!s?.send) return;
    try { s.send('ixd', [w.idx, allClosed(w) ? 0 : 1, w.bar ? Math.max(1, Math.round(w.bar.hp)) : 0, w.bar ? w.bar.side : 0]); } catch { /* 連線中斷 */ }
  }
  ix.tick(() => {
    const s = game.net;
    if (s && s !== netBound && s.on) {
      netBound = s;
      s.on('ixd', (d) => {
        const w = Array.isArray(d) && list[d[0]];
        if (!w) return;
        if (d[2] > 0 && !w.bar) barricade(w, d[3] || 1, { net: false });
        else if (!d[2] && w.bar) unbar(w, true, false);
        if (w.bar) w.bar.hp = d[2];
        const want = d[1] === 0 ? 'closed' : 'open';
        if ((want === 'closed') !== allClosed(w)) setState(w, want, { net: false });
      });
    }
    return true;
  });

  // ---------- 互動 ----------
  for (const w of list) {
    const nm = NAME[w.style] || '門';
    // 互動點:門扇關上時所在的那條線的中點(門洞中央);視線檢查不會被自己的門扇擋掉
    let px = 0, pz = 0;
    for (const l of w.leaves) { px += l.group.position.x + Math.cos(l.closed) * l.lw / 2; pz += l.group.position.z - Math.sin(l.closed) * l.lw / 2; }
    px /= w.leaves.length; pz /= w.leaves.length;
    if (w.leaves.length === 1) { px = w.cx; pz = w.cz; }
    w.px = px; w.pz = pz;
    const e = ix.register({ x: px, y: w.y + 1.05, z: pz }, {
      id: `door:${w.key}`, kind: 'door', name: nm, reach: 2.4, radius: 0.6, losPad: 0.6, hold: 0,
      prompt: (ctx) => {
        if (w.lock && !unlocked(w)) return { text: w.lock.text || `${nm} · 上鎖了`, dim: true };
        if (w.bar) { e.hold = 1.6; e.onTap = null; e.holdText = '拆木板'; return '拆掉木板'; }
        const closed = allClosed(w);
        if (closed && !ctx.mp || closed && ctx.isHost) { e.hold = 2.2; e.onTap = tap; e.holdText = '釘木板'; e.tapText = `打開${nm}`; return `釘上木板（${BARRICADE_COST} 元）`; }
        e.hold = 0; e.onTap = null;
        return closed ? `打開${nm}` : `關上${nm}`;
      },
      onUse: (ctx) => {
        if (w.lock && !unlocked(w)) return false;
        if (w.bar) { unbar(w, false); ixs.barricadeBreak(pos(w)); return; }
        if (e.hold > 0) { // 按住完成:釘木板
          const p = game.player;
          if ((p.coins || 0) < BARRICADE_COST) { game.ui.pickup(`需要 ${BARRICADE_COST} 元`, '#a3a39a'); sfx.pickupDeny(); return false; }
          p.coins -= BARRICADE_COST; game.ui.setCoins(p.coins); game.ui.spend?.(BARRICADE_COST);
          const side = sideOf(w, p.pos);
          barricade(w, side);
          return;
        }
        return tap(ctx);
      },
    });
    function tap() {
      if (w.lock && !unlocked(w)) return false;
      const p = game.player.pos;
      if (allClosed(w) || anyShut(w) && !w.leaves.some(isOpen)) setState(w, 'open', { by: p });
      else {
        if (blocked(w)) { game.ui.pickup('門口有東西擋著', '#a3a39a'); sfx.pickupDeny(); return false; }
        setState(w, 'closed');
      }
      return true;
    }
    w.e = e;
  }
  const sideOf = (w, p) => (w.leaves[0].axis === 'z' ? (p.z > w.cz ? 1 : -1) : (p.x > w.cx ? 1 : -1));

  // ---------- 鎖(劇情包:{ door: zoneId, item, flag, text }) ----------
  function unlocked(w) {
    const L = w.lock;
    if (!L) return true;
    if (L.open) return true;
    if (L.flag && ix.flags.has(L.flag)) return (L.open = true);
    if (L.item && ix.inv.has(L.item)) { if (L.consume) ix.inv.take(L.item); game.ui.pickup(`用 ${ix.inv.name(L.item)} 打開了門鎖`, '#d9c48a'); ixs.lockerOpen(pos(w)); return (L.open = true); }
    return false;
  }
  for (const spec of lockSpecs) {
    for (const w of list) {
      if (w.out || !(w.za?.id === spec.door || w.zb?.id === spec.door)) continue;
      w.lock = { ...spec, open: false };
      for (const l of w.leaves) { l.group.rotation.y = l.closed; colliders(l); }
    }
  }
  ix.on('flag', () => { for (const w of list) if (w.lock && !w.lock.open && w.lock.flag && ix.flags.has(w.lock.flag)) { w.lock.open = true; for (const l of w.leaves) colliders(l); ix.emit('unlock', w); } });

  const api = {
    list, ways, colliders, setState, barricade, unbar, isClosed, allClosed,
    reset() { // 新的一局:門回到建構時的狀態,木板拆掉,鎖重新鎖上
      for (const w of list) {
        if (w.bar) unbar(w, false, false);
        for (const l of w.leaves) { l.anim = null; anims.delete(l); l.group.rotation.y = w.lock ? l.closed : l.init; colliders(l); }
        if (w.lock) w.lock.open = false;
        w.press = 0;
      }
    },
    stats() { let boxes = 0, closed = 0; for (const w of list) { for (const l of w.leaves) boxes += l.boxes.length; if (allClosed(w)) closed++; } return { doorways: list.length, leaves: leaves.length, boxes, closed, barricades: planks.slots.filter(Boolean).length }; },
    dispose() { for (const l of leaves) { for (const b of l.boxes) world.removeBox(b); l.boxes.length = 0; } game.scene.remove(planks.im); },
  };
  for (const l of leaves) l.init = l.group.rotation.y;
  return api;
}
