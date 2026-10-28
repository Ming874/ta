import * as THREE from 'three';
import { sfx } from './audio.js';

// 錢(STORY_v2 §3.4):回來的人身上還有生前的零錢與鈔票,打倒後掉在地上;燈篙熄的時候一起算。
// 不發光、不旋轉、不飛:地上就是幾張摺起來的鈔票和幾枚銅板,燈篙暗下時就地淡掉、算進你的錢(看不到的那些也一樣算)。
// 介面沿用舊的金幣堆(drop / collectAll / update / clear / total / onGain / pendingDone / collecting),
// 呼叫端(擊殺獎勵、互動物件、連線)不用改。材質與舊的金幣同一種 shader(無貼圖的標準材質),不新增 program。
const BILL_GEO = new THREE.BoxGeometry(0.15, 0.004, 0.068); // 摺一半的鈔票
const COIN_GEO = new THREE.CylinderGeometry(0.013, 0.013, 0.0025, 12); // 十元、五十元銅板
const BILL_MAT = [0xb8b49a, 0x9fb0c2, 0xc9a98e].map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.92, metalness: 0, name: 'cash:bill' })); // 百元(紅)、千元(藍)、五百(褐) 褪色後
const COIN_MAT = new THREE.MeshStandardMaterial({ color: 0x8e8a80, metalness: 0.65, roughness: 0.55, name: 'cash:coin' });

export class Coins {
  constructor(scene) {
    this.scene = scene;
    this.piles = [];
    this.collecting = false;
    this.onGain = null; // (amount, pile) => void
    this.player = null;
    this.world = null;
    this.pendingDone = null;
  }

  get total() { return this.piles.reduce((s, p) => s + p.count, 0); }

  // 在 (x,z) 掉 n 元;附近已有一堆就疊上去
  drop(x, y, z, n = 5) {
    for (const p of this.piles) {
      if (!p.flying && Math.hypot(p.group.position.x - x, p.group.position.z - z) < 0.6 && Math.abs(p.group.position.y - y) < 1) { this._add(p, n); return p; }
    }
    const group = new THREE.Group();
    group.position.set(x + (Math.random() - 0.5) * 0.3, y, z + (Math.random() - 0.5) * 0.3);
    group.rotation.y = Math.random() * 6.28;
    const pile = { group, count: 0, flying: false, t: 0, delay: 0, items: 0 };
    this.scene.add(group);
    this.piles.push(pile);
    this._add(pile, n);
    return pile;
  }

  // 多少錢 → 看起來有幾張鈔票、幾枚銅板(最多 4 張、5 枚;多的只算錢)
  _add(pile, n) {
    pile.count += n;
    const bills = Math.min(4, Math.floor(pile.count / 12)), coins = Math.min(5, 1 + Math.floor((pile.count % 12) / 3));
    const put = (bill) => {
      const m = bill ? new THREE.Mesh(BILL_GEO, BILL_MAT[(Math.random() * 3) | 0]) : new THREE.Mesh(COIN_GEO, COIN_MAT);
      const r = Math.random() * 0.16, a = Math.random() * 6.28, k = pile.items++;
      m.position.set(Math.cos(a) * r, (bill ? 0.003 : 0.0015) + k * 0.0012, Math.sin(a) * r);
      m.rotation.set(bill ? (Math.random() - 0.5) * 0.08 : 0, Math.random() * 6.28, bill ? (Math.random() - 0.5) * 0.12 : 0);
      m.castShadow = false; m.receiveShadow = true;
      pile.group.add(m);
    };
    while ((pile.nb || 0) < bills) { pile.nb = (pile.nb || 0) + 1; put(true); }
    while ((pile.nc || 0) < coins) { pile.nc = (pile.nc || 0) + 1; put(false); }
  }

  // 燈篙熄:地上的錢一起算(就地淡掉,不飛)
  collectAll() {
    this.collecting = true;
    this.piles.forEach((p, i) => { p.flying = true; p.t = 0; p.delay = Math.min(0.6, i * 0.04); });
    if (!this.piles.length) this.collecting = false;
  }

  update(dt) {
    for (let i = this.piles.length - 1; i >= 0; i--) {
      const p = this.piles[i];
      if (!p.flying) continue;
      if (p.delay > 0) { p.delay -= dt; continue; }
      p.t += dt / 0.6;
      p.group.scale.setScalar(Math.max(0.01, 1 - p.t * p.t)); // 慢慢縮掉(像被撿走)
      if (p.t >= 1) {
        if (i % 3 === 0) sfx.coin(i);
        if (this.onGain) this.onGain(p.count, p);
        this.scene.remove(p.group);
        this.piles.splice(i, 1);
      }
    }
    if (this.collecting && this.piles.length === 0) {
      this.collecting = false;
      if (this.pendingDone) { const f = this.pendingDone; this.pendingDone = null; f(); }
    }
  }

  clear() {
    for (const p of this.piles) this.scene.remove(p.group);
    this.piles.length = 0;
    this.collecting = false;
  }
}
