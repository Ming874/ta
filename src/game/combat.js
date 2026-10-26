import * as THREE from 'three';
import { sfx } from '../audio.js';

const _o = new THREE.Vector3(), _d = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);

// 射擊、擊殺、爆炸、玩家受傷。以 mixin 方式掛到 Game 上
export const combatMethods = {
  // 所有對玩家的傷害都經過這裡:防彈衣吸收、受傷方向、死亡判定。src = 傷害來源位置(可省略)
  damagePlayer(p, amount, src = null) {
    if (!(amount > 0) || this.state !== 'playing') return 0;
    if (p !== this.player) return this.net ? this.net.damageRemote(p, amount, src) : 0; // 遠端隊友交給連線層
    if (p.hp <= 0) return 0;
    const dealt = p.hurt(amount, this.time, src);
    this.ui.damageFlash();
    this.ui.setHP(p.hp, p.maxHp);
    if (this.ui.setArmor) this.ui.setArmor(p.armor, p.maxArmor);
    if (p.hp <= 0) this.die();
    return dealt;
  },

  fire(def, id, speedNorm) {
    const cam = this.camera;
    this.player.kick(def.pitch, def.pitch * 0.9);
    cam.updateMatrixWorld(true);
    const origin = cam.getWorldPosition(_o).clone();
    const spread = def.spread * (1 + speedNorm * 1.6 + (this.player.sprinting ? 1 : 0));
    const dir = _d.set((Math.random() - 0.5) * 2 * spread, (Math.random() - 0.5) * 2 * spread, -1).normalize().applyQuaternion(cam.quaternion).clone();

    this.muzzleLight.position.copy(origin).addScaledVector(dir, 0.8);
    this.muzzleLight.intensity = 38;
    this.weaponLight.intensity = 6;
    setTimeout(() => { this.weaponLight.intensity = 0; }, 45);

    const liveZ = this.zombies.filter((z) => z.alive);
    for (const z of liveZ) z.root.updateMatrixWorld(true);
    this.ray.set(origin, dir);
    this.ray.near = 0;
    this.ray.far = 90;
    const hits = this.ray.intersectObjects(liveZ.flatMap((z) => z.meshes), false);
    const wallDist = this.world.rayDistance(origin.x, origin.y, origin.z, dir.x, dir.y, dir.z, 90);
    const end = new THREE.Vector3();

    if (hits.length && hits[0].distance < wallDist) {
      const h = hits[0];
      const z = h.object.userData.zombie;
      const part = h.object.userData.part;
      const head = part === 'head';
      end.copy(h.point);
      const killed = z.damage(def.damage, part);
      const n = dir.clone().negate();
      if (part === 'armor') { this.burst(h.point, n, 'spark', 5, z.pos.y); this.burst(h.point, n, 'blood', 3, z.pos.y); }
      else this.burst(h.point, n, 'blood', head ? 14 : 8, z.pos.y);
      if (z.type === 'bloater') this.burst(h.point, n, 'bile', 6, z.pos.y);
      this.ui.hitMarker(head);
      (head ? sfx.headshot : sfx.hit)();
      if (killed) this.onKill(z);
    } else {
      end.copy(origin).addScaledVector(dir, wallDist);
      const n = dir.clone().negate();
      this.burst(end, n, 'spark', 4);
      this.burst(end, n, 'dust', 4);
      sfx.wall();
    }

    this.tracer(new THREE.Vector3(0.18, -0.12, -0.8).applyMatrix4(cam.matrixWorld), end);
    this.updateAmmoHud();
  },

  // killer:擊殺者(多人時金幣歸屬用)
  onKill(z, killer = this.player) {
    this.coins.drop(z.pos.x, z.pos.y, z.pos.z, z.T.coins);
    if (z.type !== 'bloater') this.addPool(z.pos.x, z.pos.y, z.pos.z);
    z.corpse = z.type === 'brute' ? 9 : 6;
    z.killer = killer;
    this.kills = (this.kills || 0) + 1;
  },

  // 膿腫者死亡時爆開:傷害周圍的玩家與殭屍,留下毒氣(不同樓層幾乎不受影響)
  explode(z) {
    const E = z.T.explode, c = z.pos, p = this.player;
    const at = new THREE.Vector3(c.x, c.y + 1.0, c.z);
    this.hazards.flash(at, 6);
    this.hazards.gas(c.x, c.y, c.z);
    this.burst(at, _up, 'bile', 40, c.y);
    this.burst(at, _up, 'blood', 30, c.y);
    this.addPool(c.x, c.y, c.z);
    this.muzzleLight.position.copy(at);
    this.muzzleLight.intensity = 30;
    sfx.burst(z.vp);
    const dist = (q) => Math.hypot(q.x - c.x, q.z - c.z) + Math.abs(q.y - c.y) * 1.5;
    for (const pl of this.players) {
      const d = dist(pl.pos);
      if (d < E.radius) {
        this.damagePlayer(pl, Math.round(E.player * (1 - d / E.radius) + 5), c);
        if (pl === p) p.addShake(0.7);
      }
    }
    for (const o of this.zombies) {
      if (o === z || !o.alive) continue;
      const od = dist(o.pos);
      if (od < E.radius && o.damage(E.zombie * (1 - od / E.radius) + 10, 'body')) this.onKill(o, z.killer);
    }
  },
};
