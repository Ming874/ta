import * as THREE from 'three';
import { CELL } from '../map/layout.js';
import { sfx } from '../audio.js';

// 膿腫者的酸液彈、地上的酸池、爆炸後的毒氣雲。update() 回傳本幀要扣玩家的血量(以 5 為單位結算,避免每幀都觸發受傷音效)
const GRAV = 9.8;

function canvasTex(S, draw) {
  const c = document.createElement('canvas');
  c.width = c.height = S;
  draw(c.getContext('2d'), S);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
const glowTex = canvasTex(128, (x, S) => {
  const g = x.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  g.addColorStop(0, 'rgba(240,255,170,1)');
  g.addColorStop(0.3, 'rgba(170,220,60,0.6)');
  g.addColorStop(1, 'rgba(90,140,20,0)');
  x.fillStyle = g;
  x.fillRect(0, 0, S, S);
});
const splatTex = canvasTex(256, (x, S) => {
  const c = S / 2;
  for (let i = 0; i < 26; i++) {
    const a = Math.random() * Math.PI * 2, d = Math.random() * S * 0.28, r = S * (0.08 + Math.random() * 0.14);
    const px = c + Math.cos(a) * d, py = c + Math.sin(a) * d;
    const g = x.createRadialGradient(px, py, 0, px, py, r);
    g.addColorStop(0, 'rgba(200,230,90,0.85)');
    g.addColorStop(0.7, 'rgba(150,190,40,0.6)');
    g.addColorStop(1, 'rgba(120,160,20,0)');
    x.fillStyle = g;
    x.fillRect(px - r, py - r, r * 2, r * 2);
  }
  for (let i = 0; i < 40; i++) { // 氣泡
    const a = Math.random() * Math.PI * 2, d = Math.random() * S * 0.3;
    x.strokeStyle = 'rgba(235,255,170,0.7)';
    x.lineWidth = 1.5;
    x.beginPath();
    x.arc(c + Math.cos(a) * d, c + Math.sin(a) * d, 2 + Math.random() * 6, 0, Math.PI * 2);
    x.stroke();
  }
});
const smokeTex = canvasTex(128, (x, S) => {
  for (let i = 0; i < 30; i++) {
    const px = S / 2 + (Math.random() - 0.5) * S * 0.5, py = S / 2 + (Math.random() - 0.5) * S * 0.5, r = S * (0.15 + Math.random() * 0.2);
    const g = x.createRadialGradient(px, py, 0, px, py, r);
    g.addColorStop(0, 'rgba(255,255,255,0.22)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g;
    x.fillRect(0, 0, S, S);
  }
});

const blobGeo = new THREE.SphereGeometry(0.07, 12, 10);
const blobMat = new THREE.MeshBasicMaterial({ color: 0xc8f060 });
const poolGeo = new THREE.PlaneGeometry(1, 1);

export class Hazards {
  constructor(scene) {
    this.scene = scene;
    this.shots = [];
    this.pools = [];
    this.clouds = [];
    this.flashes = [];
    this.acc = 0;
  }

  // 拋物線吐射:飛行時間依距離而定
  spit(from, target) {
    const dx = target.x - from.x, dz = target.z - from.z, dy = target.y - from.y;
    const d = Math.hypot(dx, dz);
    const T = Math.min(1.3, Math.max(0.45, d / 11));
    const vel = new THREE.Vector3(dx / T, (dy + 0.5 * GRAV * T * T) / T, dz / T);
    const g = new THREE.Group();
    g.add(new THREE.Mesh(blobGeo, blobMat));
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.9 }));
    glow.scale.setScalar(0.6);
    g.add(glow);
    g.position.copy(from);
    this.scene.add(g);
    const trail = [];
    for (let i = 0; i < 6; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.5 - i * 0.07 }));
      s.scale.setScalar(0.35 - i * 0.04);
      s.position.copy(from);
      this.scene.add(s);
      trail.push(s);
    }
    this.shots.push({ g, vel, trail, hist: [], t: 0 });
  }

  pool(x, y, z, r = 1.25) {
    const m = new THREE.Mesh(poolGeo, new THREE.MeshBasicMaterial({ map: splatTex, transparent: true, depthWrite: false, color: 0xb0e050, opacity: 0.9, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }));
    m.rotation.x = -Math.PI / 2;
    m.rotation.z = Math.random() * 6.28;
    m.position.set(x, y + 0.02 + Math.random() * 0.004, z);
    m.scale.setScalar(0.1);
    const glow = new THREE.Mesh(poolGeo, new THREE.MeshBasicMaterial({ map: glowTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.35 }));
    glow.rotation.x = -Math.PI / 2;
    glow.position.set(x, y + 0.03, z);
    glow.scale.setScalar(r * 2.6);
    this.scene.add(m, glow);
    this.pools.push({ m, glow, r, t: 0, life: 5.5, sizzle: 0 });
  }

  gas(x, y, z) {
    const sprites = [];
    for (let i = 0; i < 12; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: smokeTex, transparent: true, depthWrite: false, color: 0x8faa30, opacity: 0 }));
      const a = Math.random() * 6.28, d = Math.random() * 1.4;
      s.position.set(x + Math.cos(a) * d, y + 0.3 + Math.random() * 1.6, z + Math.sin(a) * d);
      s.userData = { base: 1.6 + Math.random() * 1.6, spin: (Math.random() - 0.5) * 0.6, rise: 0.05 + Math.random() * 0.15 };
      this.scene.add(s);
      sprites.push(s);
    }
    this.clouds.push({ x, y, z, sprites, t: 0, life: 6, r: 2.4 });
  }

  flash(pos, size = 5) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    s.position.copy(pos);
    s.scale.setScalar(size);
    this.scene.add(s);
    this.flashes.push({ s, t: 0, size });
  }

  update(dt, player, world) {
    this.world = world;
    const pp = player.pos;
    // 酸液彈
    for (let i = this.shots.length - 1; i >= 0; i--) {
      const s = this.shots[i];
      s.t += dt;
      s.vel.y -= GRAV * dt;
      const prev = s.g.position.clone();
      s.g.position.addScaledVector(s.vel, dt);
      s.hist.unshift(s.g.position.clone());
      if (s.hist.length > 12) s.hist.pop();
      s.trail.forEach((t, k) => t.position.copy(s.hist[Math.min(s.hist.length - 1, k * 2 + 1)] || s.g.position));
      const p = s.g.position;
      const hitPlayer = Math.hypot(p.x - pp.x, p.z - pp.z) < 0.5 && p.y > 0.2 && p.y < 1.9;
      const wall = world.isSolidCell(Math.floor(p.x / CELL), Math.floor(p.z / CELL));
      if (hitPlayer || wall || p.y <= 0.05 || s.t > 3) {
        const at = wall ? prev : p;
        if (hitPlayer) { this.acc += 15; sfx.splash(pp); }
        else sfx.splash(at);
        this.pool(at.x, this.world?.groundY?.(at.x, at.z, at.y) ?? 0, at.z);
        this.scene.remove(s.g, ...s.trail);
        s.g.children[1].material.dispose();
        for (const t of s.trail) t.material.dispose();
        this.shots.splice(i, 1);
      }
    }
    // 酸池
    for (let i = this.pools.length - 1; i >= 0; i--) {
      const p = this.pools[i];
      p.t += dt;
      const grow = Math.min(1, p.t / 0.35);
      const fade = Math.min(1, (p.life - p.t) / 1.5);
      p.m.scale.setScalar(p.r * 2 * (0.2 + 0.8 * grow));
      p.m.material.opacity = 0.9 * fade;
      p.glow.material.opacity = (0.25 + Math.sin(p.t * 7) * 0.08) * fade;
      const inside = Math.hypot(pp.x - p.m.position.x, pp.z - p.m.position.z) < p.r * 0.85 && Math.abs(pp.y - p.m.position.y) < 1 && fade > 0.3;
      if (inside) this.acc += 6 * dt;
      p.sizzle -= dt;
      if (p.sizzle <= 0) { p.sizzle = inside ? 0.6 : 1.4; sfx.sizzle(p.m.position); }
      if (p.t >= p.life) {
        this.scene.remove(p.m, p.glow);
        p.m.material.dispose();
        p.glow.material.dispose();
        this.pools.splice(i, 1);
      }
    }
    // 毒氣
    for (let i = this.clouds.length - 1; i >= 0; i--) {
      const c = this.clouds[i];
      c.t += dt;
      const a = Math.min(1, c.t / 0.4) * Math.min(1, (c.life - c.t) / 2);
      for (const s of c.sprites) {
        const u = s.userData;
        s.scale.setScalar(u.base * (0.6 + c.t * 0.18));
        s.material.rotation += u.spin * dt;
        s.material.opacity = 0.55 * a;
        s.position.y += u.rise * dt;
      }
      if (Math.hypot(pp.x - c.x, pp.z - c.z) < c.r && Math.abs(pp.y - c.y) < 2.5 && a > 0.3) this.acc += 7 * dt;
      if (c.t >= c.life) {
        for (const s of c.sprites) { this.scene.remove(s); s.material.dispose(); }
        this.clouds.splice(i, 1);
      }
    }
    for (let i = this.flashes.length - 1; i >= 0; i--) {
      const f = this.flashes[i];
      f.t += dt;
      f.s.material.opacity = Math.max(0, 1 - f.t / 0.35);
      f.s.scale.setScalar(f.size * (1 + f.t * 2));
      if (f.t > 0.35) { this.scene.remove(f.s); f.s.material.dispose(); this.flashes.splice(i, 1); }
    }
    if (this.acc >= 5) {
      const d = Math.floor(this.acc / 5) * 5;
      this.acc -= d;
      return d;
    }
    return 0;
  }

  clear() {
    for (const s of this.shots) { this.scene.remove(s.g, ...s.trail); }
    for (const p of this.pools) this.scene.remove(p.m, p.glow);
    for (const c of this.clouds) for (const s of c.sprites) this.scene.remove(s);
    for (const f of this.flashes) this.scene.remove(f.s);
    this.shots.length = this.pools.length = this.clouds.length = this.flashes.length = 0;
    this.acc = 0;
  }
}
