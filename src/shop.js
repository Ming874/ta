import * as THREE from 'three';
import { createDisplayGun } from './weapons/models.js';

const SHOP_X = 30;
const SHOP_Z = 50.9;
export const SHOP_INTERACT = { x: SHOP_X, z: 49.2, r: 4.2 };

function signTexture() {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 128;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#0b1a0d';
  ctx.fillRect(0, 0, 512, 128);
  ctx.strokeStyle = '#7dff8a';
  ctx.lineWidth = 6;
  ctx.strokeRect(6, 6, 500, 116);
  ctx.fillStyle = '#9dffa8';
  ctx.shadowColor = '#4dff5e';
  ctx.shadowBlur = 18;
  ctx.font = 'bold 72px "Microsoft JhengHei", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('武器商店', 256, 68);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class Shop {
  constructor(scene, world) {
    this.scene = scene;
    this.world = world;
    this.group = new THREE.Group();
    this.guns = [];

    const counterMat = new THREE.MeshStandardMaterial({ color: 0x2a2f2b, roughness: 0.6, metalness: 0.3 });
    const topMat = new THREE.MeshStandardMaterial({ color: 0x1b1f1c, roughness: 0.3, metalness: 0.6 });
    const counter = new THREE.Mesh(new THREE.BoxGeometry(4.6, 0.95, 0.8), counterMat);
    counter.position.set(SHOP_X, 0.475, SHOP_Z);
    counter.castShadow = counter.receiveShadow = true;
    this.group.add(counter);
    const top = new THREE.Mesh(new THREE.BoxGeometry(4.7, 0.06, 0.9), topMat);
    top.position.set(SHOP_X, 0.97, SHOP_Z);
    this.group.add(top);
    this.box = world.addBox(SHOP_X, SHOP_Z, 4.6, 0.8, 1);

    // 展示的槍
    const ids = ['revolver', 'ak47', 'm4a1'];
    ids.forEach((id, i) => {
      const gun = createDisplayGun(id);
      const wrap = new THREE.Group();
      wrap.add(gun);
      const s = id === 'revolver' ? 2.0 : 1.2;
      wrap.scale.setScalar(s);
      wrap.position.set(SHOP_X - 1.5 + i * 1.5, 1.28, SHOP_Z);
      wrap.rotation.y = Math.PI / 2;
      gun.position.z = id === 'revolver' ? 0.12 : id === 'ak47' ? 0.25 : 0.2;
      this.group.add(wrap);
      this.guns.push(wrap);
      const stand = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.12, 0.28, 8), topMat);
      stand.position.set(SHOP_X - 1.5 + i * 1.5, 1.12, SHOP_Z);
      this.group.add(stand);
    });

    // 招牌與燈光
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 0.65), new THREE.MeshBasicMaterial({ map: signTexture() }));
    sign.position.set(SHOP_X, 2.5, SHOP_Z + 0.25);
    sign.rotation.y = Math.PI;
    this.group.add(sign);
    const light = new THREE.PointLight(0x7dff9a, 9, 10, 1.8);
    light.position.set(SHOP_X, 2.2, SHOP_Z - 0.8);
    this.group.add(light);
    const warm = new THREE.PointLight(0xffd9a0, 3, 8, 1.8);
    warm.position.set(SHOP_X, 1.6, SHOP_Z - 2);
    this.group.add(warm);
    this.light = light;

    scene.add(this.group);
  }

  update(dt, t) {
    this.guns.forEach((g, i) => { g.rotation.y = Math.PI / 2 + Math.sin(t * 0.6 + i) * 0.5; });
    this.light.intensity = 9 + Math.sin(t * 3);
  }

  near(player) {
    return Math.hypot(player.pos.x - SHOP_INTERACT.x, player.pos.z - SHOP_INTERACT.z) < SHOP_INTERACT.r;
  }

  dispose() {
    this.scene.remove(this.group);
    this.world.removeBox(this.box);
  }
}
