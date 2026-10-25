import * as THREE from 'three';
import { sfx } from './audio.js';

export const ZOMBIE_HP = 150;

// 血條顏色:150 綠 → 100 橘 → 50 紅(中間線性漸變,≤50 維持紅)
const GREEN = [46, 204, 64];
const ORANGE = [255, 159, 26];
const RED = [225, 29, 29];
export function hpColor(hp) {
  let a, b, t;
  if (hp >= 150) return GREEN;
  if (hp >= 100) { a = ORANGE; b = GREEN; t = (hp - 100) / 50; }
  else if (hp > 50) { a = RED; b = ORANGE; t = (hp - 50) / 50; }
  else return RED;
  return a.map((v, i) => Math.round(v + (b[i] - v) * t));
}

const skinColors = [0x6a7562, 0x707a66, 0x62705a, 0x75705f];
const shirtColors = [0x44525a, 0x3c4e42, 0x362f27, 0x544b41, 0x2b3540, 0x5a5e56];
const pantColors = [0x2f3338, 0x3a3f33, 0x4b4a46, 0x25282c];
const mat = (c, r = 0.9) => new THREE.MeshStandardMaterial({ color: c, roughness: r });
const skinMats = skinColors.map((c) => mat(c, 0.75));
const shirtMats = shirtColors.map((c) => mat(c));
const pantMats = pantColors.map((c) => mat(c));
const bloodMat = new THREE.MeshStandardMaterial({ color: 0x4a0707, roughness: 0.4 });
const darkMat = new THREE.MeshStandardMaterial({ color: 0x0a0a0a, roughness: 1 });
const eyeMat = new THREE.MeshStandardMaterial({ color: 0xd6d2a0, emissive: 0x6a6420, emissiveIntensity: 0.8, roughness: 0.4 });

const G = {
  torso: new THREE.BoxGeometry(0.44, 0.62, 0.24),
  pelvis: new THREE.BoxGeometry(0.4, 0.2, 0.22),
  arm: new THREE.BoxGeometry(0.11, 0.62, 0.11),
  hand: new THREE.BoxGeometry(0.1, 0.12, 0.08),
  leg: new THREE.BoxGeometry(0.17, 0.9, 0.18),
  head: new THREE.SphereGeometry(0.135, 10, 8),
  jaw: new THREE.BoxGeometry(0.15, 0.06, 0.12),
  eye: new THREE.BoxGeometry(0.035, 0.025, 0.02),
  neck: new THREE.CylinderGeometry(0.05, 0.06, 0.1, 6),
  patch: new THREE.BoxGeometry(0.2, 0.25, 0.02),
};

function makeBar() {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 16;
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, fog: false }));
  sprite.scale.set(1.0, 0.13, 1);
  sprite.renderOrder = 10;
  return { c, tex, sprite };
}

export class Zombie {
  constructor(scene, x, z, round) {
    this.scene = scene;
    this.hp = ZOMBIE_HP;
    this.alive = true;
    this.dying = 0;
    this.pos = new THREE.Vector3(x, 0, z);
    this.vel = new THREE.Vector3();
    this.speed = Math.min(2.7, 1.0 + round * 0.07 + Math.random() * 0.45);
    this.walkPhase = Math.random() * 10;
    this.attackT = 0;
    this.attackCd = 0;
    this.groanT = 2 + Math.random() * 5;
    this.heading = Math.random() * 6.28;
    this.hitFlash = 0;
    this.lean = 0.12 + Math.random() * 0.15;
    this.limp = Math.random() < 0.3 ? 0.5 : 1;
    this.meshes = [];

    const skin = skinMats[(Math.random() * skinMats.length) | 0];
    const shirt = shirtMats[(Math.random() * shirtMats.length) | 0];
    const pants = pantMats[(Math.random() * pantMats.length) | 0];

    const root = new THREE.Group();
    this.root = root;
    root.rotation.order = 'YXZ';
    const part = (geo, m, parent, x, y, z, kind) => {
      const mesh = new THREE.Mesh(geo, m);
      mesh.position.set(x, y, z);
      mesh.castShadow = true;
      mesh.userData.zombie = this;
      mesh.userData.part = kind;
      parent.add(mesh);
      this.meshes.push(mesh);
      return mesh;
    };

    // 軀幹與頭
    this.body = new THREE.Group();
    this.body.position.y = 0.9;
    root.add(this.body);
    part(G.pelvis, pants, this.body, 0, 0.05, 0, 'body');
    part(G.torso, shirt, this.body, 0, 0.4, 0, 'body');
    part(G.patch, bloodMat, this.body, 0.02, 0.35, 0.115, 'body'); // 胸前血跡
    part(G.neck, skin, this.body, 0, 0.76, 0, 'body');
    this.head = new THREE.Group();
    this.head.position.set(0, 0.92, 0.02);
    this.body.add(this.head);
    const h = part(G.head, skin, this.head, 0, 0, 0, 'head');
    h.scale.set(1, 1.18, 1.05);
    part(G.jaw, bloodMat, this.head, 0, -0.1, 0.045, 'head');
    part(G.eye, eyeMat, this.head, -0.05, 0.03, 0.125, 'head');
    part(G.eye, eyeMat, this.head, 0.05, 0.03, 0.125, 'head');
    part(G.eye, darkMat, this.head, 0, -0.07, 0.13, 'head');
    this.head.rotation.z = (Math.random() - 0.5) * 0.4;

    // 手臂(前伸)
    this.arms = [];
    for (const sx of [-1, 1]) {
      const p = new THREE.Group();
      p.position.set(sx * 0.28, 0.65, 0);
      this.body.add(p);
      part(G.arm, Math.random() < 0.5 ? skin : shirt, p, 0, -0.28, 0, 'body');
      part(G.hand, skin, p, 0, -0.62, 0, 'body');
      this.arms.push(p);
    }
    // 腿
    this.legs = [];
    for (const sx of [-1, 1]) {
      const p = new THREE.Group();
      p.position.set(sx * 0.11, 0.9, 0);
      root.add(p);
      part(G.leg, pants, p, 0, -0.45, 0, 'body');
      this.legs.push(p);
    }

    // 頭頂血條
    this.bar = makeBar();
    this.bar.sprite.position.set(0, 2.2, 0);
    root.add(this.bar.sprite);
    this.drawBar();

    root.position.copy(this.pos);
    scene.add(root);
  }

  drawBar() {
    const { c, tex } = this.bar;
    const ctx = c.getContext('2d');
    ctx.clearRect(0, 0, 128, 16);
    ctx.fillStyle = 'rgba(0,0,0,0.65)';
    ctx.fillRect(0, 0, 128, 16);
    const [r, g, b] = hpColor(this.hp);
    ctx.fillStyle = `rgb(${r},${g},${b})`;
    ctx.fillRect(2, 2, Math.max(0, 124 * (this.hp / ZOMBIE_HP)), 12);
    ctx.fillStyle = 'rgba(255,255,255,0.2)';
    ctx.fillRect(2, 2, Math.max(0, 124 * (this.hp / ZOMBIE_HP)), 4);
    tex.needsUpdate = true;
  }

  damage(amount) {
    if (!this.alive) return false;
    this.hp = Math.max(0, this.hp - amount);
    this.hitFlash = 0.1;
    this.drawBar();
    if (this.hp <= 0) {
      this.alive = false;
      this.dying = 0.0001;
      this.bar.sprite.visible = false;
      sfx.zombieDie();
      return true;
    }
    return false;
  }

  // 回傳要對玩家造成的傷害(0 = 沒攻擊)
  update(dt, player, world, others) {
    if (!this.alive) {
      if (this.dying > 0) {
        this.dying += dt;
        const t = Math.min(1, this.dying / 0.7);
        const e = t * t;
        this.root.rotation.x = -e * (Math.PI / 2 - 0.1);
        this.root.position.y = 0.12 * e;
      }
      return 0;
    }
    let dealt = 0;
    const toX = player.pos.x - this.pos.x, toZ = player.pos.z - this.pos.z;
    const dist = Math.hypot(toX, toZ);

    // 方向:近距離且視線通暢就直線,否則走導航場
    let dx = 0, dz = 0, moving = true;
    if (dist < 4 && world.hasLineOfSight(this.pos.x, this.pos.z, player.pos.x, player.pos.z)) {
      dx = toX / dist; dz = toZ / dist;
    } else {
      const f = world.flowDir(this.pos.x, this.pos.z, this._dir || (this._dir = { x: 0, z: 0 }));
      if (f) { dx = f.x; dz = f.z; } else { dx = toX / (dist || 1); dz = toZ / (dist || 1); }
    }

    const reach = 1.05;
    if (dist < reach) moving = false;

    // 攻擊
    this.attackCd -= dt;
    if (dist < reach + 0.15) {
      if (this.attackCd <= 0) {
        this.attackT = 0.5;
        this.attackCd = 1.1;
        sfx.attack();
      }
      if (this.attackT > 0) {
        const before = this.attackT;
        this.attackT -= dt;
        if (before > 0.25 && this.attackT <= 0.25) dealt = 10;
      }
    } else if (this.attackT > 0) this.attackT = 0;

    // 移動
    const sp = moving ? this.speed * this.limp : 0;
    const k = Math.min(1, dt * 6);
    this.vel.x += (dx * sp - this.vel.x) * k;
    this.vel.z += (dz * sp - this.vel.z) * k;
    // 與其他殭屍分離
    for (const o of others) {
      if (o === this || !o.alive) continue;
      const ax = this.pos.x - o.pos.x, az = this.pos.z - o.pos.z;
      const d2 = ax * ax + az * az;
      if (d2 < 0.5 && d2 > 1e-4) {
        const d = Math.sqrt(d2);
        this.vel.x += (ax / d) * (0.7 - d) * 4 * dt * 10;
        this.vel.z += (az / d) * (0.7 - d) * 4 * dt * 10;
      }
    }
    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;
    world.resolve(this.pos, 0.34);
    // 別疊在玩家身上
    if (dist < 0.75) {
      const nx = (this.pos.x - player.pos.x) / (dist || 1), nz = (this.pos.z - player.pos.z) / (dist || 1);
      this.pos.x = player.pos.x + nx * 0.75;
      this.pos.z = player.pos.z + nz * 0.75;
    }

    // 朝向
    const speedNow = Math.hypot(this.vel.x, this.vel.z);
    const target = dist < 5 ? Math.atan2(toX, toZ) : speedNow > 0.1 ? Math.atan2(this.vel.x, this.vel.z) : this.heading;
    let diff = target - this.heading;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    this.heading += diff * Math.min(1, dt * 7);
    this.root.rotation.y = this.heading;
    this.root.position.set(this.pos.x, 0, this.pos.z);

    // 動畫
    this.walkPhase += dt * (3 + speedNow * 3.2);
    const sw = Math.sin(this.walkPhase) * Math.min(1, speedNow / 1.2);
    this.legs[0].rotation.x = sw * 0.6;
    this.legs[1].rotation.x = -sw * 0.6 * this.limp;
    const atk = this.attackT > 0 ? Math.sin((1 - this.attackT / 0.5) * Math.PI) : 0;
    const armBase = -1.45 + atk * 0.9;
    this.arms[0].rotation.x = armBase + Math.sin(this.walkPhase * 0.5) * 0.08;
    this.arms[1].rotation.x = armBase + Math.cos(this.walkPhase * 0.5) * 0.08;
    this.arms[0].rotation.z = 0.1;
    this.arms[1].rotation.z = -0.1;
    this.body.rotation.x = this.lean + atk * 0.35;
    this.body.rotation.z = Math.sin(this.walkPhase * 0.5) * 0.06;
    this.body.position.y = 0.9 + Math.abs(Math.sin(this.walkPhase)) * 0.03;
    this.head.rotation.x = Math.sin(this.walkPhase * 0.7) * 0.08 - 0.05;

    // 呻吟
    this.groanT -= dt;
    if (this.groanT <= 0) {
      this.groanT = 4 + Math.random() * 6;
      sfx.groan(dist);
    }
    return dealt;
  }

  dispose() {
    this.scene.remove(this.root);
    this.bar.tex.dispose();
    this.bar.sprite.material.dispose();
  }
}
