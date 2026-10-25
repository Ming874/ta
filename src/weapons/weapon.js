import * as THREE from 'three';
import { createWeaponModel, tryLoadGLB } from './models.js';
import { makeFlashStar } from '../map/textures.js';
import { sfx } from '../audio.js';

// 武器數值表(價格、傷害、射速…都集中在這裡調整)
export const WEAPONS = {
  pistol: {
    name: '手槍', desc: 'Glock 17 · 半自動', price: 0, damage: 25, rpm: 380, auto: false,
    mag: 17, reserveStart: 85, reserveCap: 136, reload: 1.5, spread: 0.007, kick: 0.035, pitch: 0.011,
    hold: [0.15, -0.17, -0.36], slot: 1,
  },
  revolver: {
    name: '左輪', desc: 'Colt Python · 357 Magnum', price: 100, damage: 70, rpm: 130, auto: false,
    mag: 6, reserveStart: 30, reserveCap: 48, reload: 2.6, spread: 0.005, kick: 0.075, pitch: 0.03,
    hold: [0.15, -0.18, -0.33], slot: 2,
  },
  ak47: {
    name: 'AK-47', desc: '7.62×39mm · 全自動', price: 250, damage: 35, rpm: 600, auto: true,
    mag: 30, reserveStart: 90, reserveCap: 180, reload: 2.5, spread: 0.014, kick: 0.05, pitch: 0.016,
    hold: [0.16, -0.2, -0.44], slot: 3,
  },
  m4a1: {
    name: 'M4A1', desc: '5.56×45mm · 全自動', price: 400, damage: 30, rpm: 780, auto: true,
    mag: 30, reserveStart: 90, reserveCap: 180, reload: 2.1, spread: 0.01, kick: 0.036, pitch: 0.011,
    hold: [0.16, -0.19, -0.42], slot: 4,
  },
};

export const ORDER = ['pistol', 'revolver', 'ak47', 'm4a1'];

export class WeaponSystem {
  constructor(weaponScene) {
    this.scene = weaponScene;
    this.models = {};
    this.inv = {}; // id -> {mag, reserve}
    this.current = null;
    this.reloading = 0; // 剩餘秒數
    this.cooldown = 0;
    this.raise = 1; // 1=放下,0=舉起
    this.kickZ = 0;
    this.kickRot = 0;
    this.bobT = 0;
    this.flashT = 0;
    this.onFire = null; // (def, id) => void
    this.onEmptyDry = null;
    this.swayX = 0;
    this.swayY = 0;

    const tex = makeFlashStar();
    this.flash = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    this.flash.visible = false;
    this.scene.add(this.flash);

    for (const id of ORDER) {
      const m = createWeaponModel(id);
      m.root.visible = false;
      m.root.position.set(...WEAPONS[id].hold);
      this.scene.add(m.root);
      this.models[id] = m;
      tryLoadGLB(m, id); // 有放 public/models/<id>.glb 就自動換成該模型
    }
    this.give('pistol');
    this.switchTo('pistol', true);
  }

  has(id) { return !!this.inv[id]; }

  give(id) {
    const def = WEAPONS[id];
    if (!this.inv[id]) this.inv[id] = { mag: def.mag, reserve: def.reserveStart };
    else {
      this.inv[id].mag = def.mag;
      this.inv[id].reserve = def.reserveCap;
    }
  }

  refillAll() {
    for (const id in this.inv) {
      this.inv[id].mag = WEAPONS[id].mag;
      this.inv[id].reserve = WEAPONS[id].reserveCap;
    }
  }

  // 每回合開始補給兩個彈匣
  resupply() {
    for (const id in this.inv) {
      const d = WEAPONS[id];
      this.inv[id].reserve = Math.min(d.reserveCap, this.inv[id].reserve + d.mag * 2);
    }
  }

  switchTo(id, instant = false) {
    if (!this.inv[id] || (id === this.current && !instant)) return;
    if (this.current) this.models[this.current].root.visible = false;
    this.current = id;
    this.models[id].root.visible = true;
    this.reloading = 0;
    this.raise = instant ? 0 : 1;
    this.cooldown = 0.2;
    if (!instant) sfx.switch();
  }

  cycle(dir) {
    const owned = ORDER.filter((id) => this.inv[id]);
    const i = owned.indexOf(this.current);
    this.switchTo(owned[(i + dir + owned.length) % owned.length]);
  }

  get def() { return WEAPONS[this.current]; }
  get ammo() { return this.inv[this.current]; }

  startReload() {
    const a = this.ammo, d = this.def;
    if (this.reloading > 0 || a.mag >= d.mag || a.reserve <= 0) return;
    this.reloading = d.reload;
    this.reloadTotal = d.reload;
    sfx.reload(this.current);
  }

  update(dt, input, speedNorm, sprinting, look) {
    const d = this.def, a = this.ammo, m = this.models[this.current];
    this.cooldown = Math.max(0, this.cooldown - dt);
    this.raise = Math.max(0, this.raise - dt / 0.35);

    if (this.reloading > 0) {
      this.reloading -= dt;
      if (this.reloading <= 0) {
        const take = Math.min(d.mag - a.mag, a.reserve);
        a.mag += take;
        a.reserve -= take;
        this.reloading = 0;
      }
    }

    const canShoot = this.reloading <= 0 && this.raise < 0.4 && !sprinting;
    const wantFire = d.auto ? input.fireHeld : input.firePressed;
    if (wantFire && this.cooldown <= 0 && canShoot) {
      if (a.mag > 0) {
        a.mag--;
        this.cooldown = 60 / d.rpm;
        this.kickZ += d.kick;
        this.kickRot += d.kick * 3.2;
        this.flashT = 0.05;
        sfx.shot(this.current);
        if (this.onFire) this.onFire(d, this.current, speedNorm);
        if (a.mag === 0 && a.reserve > 0) setTimeout(() => this.startReload(), 250);
      } else if (input.firePressed) {
        sfx.dry();
        this.cooldown = 0.25;
        this.startReload();
      }
    }
    input.firePressed = false;

    // ---- 視角模型動畫 ----
    this.kickZ += (0 - this.kickZ) * Math.min(1, dt * 14);
    this.kickRot += (0 - this.kickRot) * Math.min(1, dt * 12);
    this.bobT += dt * (sprinting ? 11 : 7.5) * speedNorm;
    this.swayX += (-look.x * 0.0012 - this.swayX) * Math.min(1, dt * 8);
    this.swayY += (-look.y * 0.0012 - this.swayY) * Math.min(1, dt * 8);
    look.x = look.y = 0;

    const bobAmp = 0.008 * speedNorm * (sprinting ? 1.8 : 1);
    const bx = Math.sin(this.bobT) * bobAmp;
    const by = Math.abs(Math.cos(this.bobT)) * bobAmp * 0.9;
    let px = d.hold[0] + bx + this.swayX, py = d.hold[1] - by + this.swayY, pz = d.hold[2] + this.kickZ;
    let rx = this.kickRot, ry = 0, rz = 0;

    if (sprinting) { px += -0.05; py += -0.06; rx += 0.1; ry += 0.55; }
    if (this.raise > 0) { py -= this.raise * 0.35; rx -= this.raise * 0.8; }
    if (this.reloading > 0) {
      const t = 1 - this.reloading / this.reloadTotal;
      const s = Math.pow(Math.sin(Math.PI * Math.min(1, t * 1.05)), 0.7);
      py -= 0.13 * s;
      rx += 0.5 * s;
      rz += 0.35 * s;
      px -= 0.03 * s;
      // 左輪:甩出彈巢
      if (this.current === 'revolver' && m.info.drum) m.info.drum.rotation.y = Math.sin(t * 20) * 0.1;
    }
    m.root.position.set(px, py, pz);
    m.root.rotation.set(rx, ry, rz);

    // 槍口火光
    if (this.flashT > 0) {
      this.flashT -= dt;
      m.root.updateMatrixWorld(true);
      const p = new THREE.Vector3();
      m.muzzle.getWorldPosition(p);
      this.flash.position.copy(p);
      const s = 0.1 + Math.random() * 0.08;
      this.flash.scale.set(s * (this.current === 'pistol' ? 0.8 : 1.3), s * (this.current === 'pistol' ? 0.8 : 1.3), 1);
      this.flash.material.rotation = Math.random() * 6.28;
      this.flash.visible = true;
    } else this.flash.visible = false;
  }

  get flashing() { return this.flashT > 0; }
}
