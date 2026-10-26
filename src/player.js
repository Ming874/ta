import * as THREE from 'three';
import { sfx } from './audio.js';

const EYE = 1.65, EYE_CROUCH = 1.05; // 眼睛高度(腳底起算)
const HEIGHT = 1.8, HEIGHT_CROUCH = 1.25; // 身高(天花板/道具盒判定)
const RADIUS = 0.35;
const G = 9.8;
const JUMP_V = 3.6; // 起跳速度(約 0.66m 高)
const WALK = 3.3, SPRINT = 5.4, CROUCH = 1.7; // m/s
const ACCEL = 20, FRICTION = 16, AIR_ACCEL = 3; // m/s²:地面加速、無輸入時的摩擦減速、空中控制
// 耐力(0..1):衝刺消耗,停止衝刺一小段時間後恢復;耗盡後要恢復到 STAM_MIN 才能再衝
const STAM_DRAIN = 0.17, STAM_REGEN = 0.24, STAM_DELAY = 0.7, STAM_MIN = 0.3, JUMP_COST = 0.08;

export class Player {
  constructor(camera, world) {
    this.camera = camera;
    this.world = world;
    const st = world.start;
    this.pos = new THREE.Vector3(st.x, st.y || 0, st.z);
    this.yaw = st.yaw || 0; // 0 = 朝北(-Z)
    this.pitch = 0;
    this.keys = {};
    this.id = 'local';
    this.name = '';
    this.alive = true;
    this.downed = false; // 多人合作:倒地等待救援
    this.hp = 100;
    this.maxHp = 100;
    this.armor = 0; // 防彈背心耐久;受傷時吸收 60% 傷害直到耗盡
    this.maxArmor = 0;
    this.coins = 0;
    this.grenades = 0;
    this.medkits = 0;
    this.speedMul = 1; // 開鏡/負重等造成的移動速度倍率
    this.sensMul = 1; // 開鏡時的滑鼠靈敏度倍率
    this.surface = 'tile'; // 腳下地面材質(腳步聲)
    this.lastHurtFrom = null; // 最近一次傷害來源位置 {x,z}(受傷方向指示)
    this.speedNorm = 0;
    this.sprinting = false;
    this.bobT = 0;
    this.stepT = 0;
    this.recoilBank = 0;
    this.shake = 0;
    this.lastHurt = -10;
    // ---- 移動物理(world.resolve 的 body 介面:vy / onGround / ground / height / landV) ----
    this.vx = 0;
    this.vz = 0;
    this.vy = 0;
    this.onGround = true;
    this.ground = this.pos.y;
    this.height = HEIGHT;
    this.landV = 0;
    this.crouching = false;
    this.crouchT = 0; // 0 站 → 1 蹲(平滑)
    this.stamina = 1;
    this.exhausted = false;
    this.inWater = false;
    this.onStair = -1;
    this.eyeH = EYE; // 目前眼睛高度(蹲下會降低)
    this.viewY = this.pos.y; // 平滑後的鏡頭基準高度
    this.dip = 0; // 落地鏡頭下沉
    this.dipV = 0;
    this._stamT = 0;
    this._jumpBuf = 0;
    this._coyote = 0;
    this._cPrev = false;
    this._spacePrev = false;
    this._crouchToggle = false;
    this._cell = -1;

    // 手電筒
    this.flashlight = new THREE.SpotLight(0xfff1d6, 75, 30, 0.62, 0.95, 1.8);
    this.flashlight.castShadow = true;
    this.flashlight.shadow.mapSize.set(1024, 1024);
    this.flashlight.shadow.camera.near = 0.2;
    this.flashlight.shadow.camera.far = 28;
    this.flashlight.shadow.bias = -0.0004;
    this.flashlight.position.set(0.12, -0.08, 0);
    camera.add(this.flashlight);
    const target = new THREE.Object3D();
    target.position.set(0.12, -0.08, -5);
    camera.add(target);
    this.flashlight.target = target;
    this.flashOn = true;
  }

  // 瞬移到指定位置(重開/出生/復活),清掉速度與跳躍狀態
  place(x, y, z, yaw = this.yaw) {
    this.pos.set(x, y, z);
    this.yaw = yaw;
    this.pitch = 0;
    this.vx = this.vz = this.vy = 0;
    this.onGround = true;
    this.ground = y;
    this.viewY = y;
    this.dip = this.dipV = 0;
    this.crouching = this._crouchToggle = false;
    this.crouchT = 0;
    this.height = HEIGHT;
    this.stamina = 1;
    this.exhausted = false;
    this._jumpBuf = 0;
  }

  toggleFlashlight() {
    this.flashOn = !this.flashOn;
    this.flashlight.visible = this.flashOn;
    sfx.dry();
  }

  look(dx, dy) {
    this.yaw -= dx * 0.0022 * this.sensMul;
    this.pitch -= dy * 0.0022 * this.sensMul;
    this.pitch = Math.max(-1.45, Math.min(1.45, this.pitch));
  }

  kick(pitch, yawRand) {
    this.pitch = Math.min(1.45, this.pitch + pitch);
    this.recoilBank += pitch;
    this.yaw += (Math.random() - 0.5) * yawRand;
  }

  // src:傷害來源位置(可省略);回傳實際扣的生命值
  hurt(amount, t, src = null) {
    let dmg = amount;
    if (this.armor > 0) {
      const absorbed = Math.min(this.armor, amount * 0.6);
      this.armor -= absorbed;
      dmg -= absorbed;
      sfx.armorHit();
    }
    this.hp = Math.max(0, this.hp - dmg);
    this.shake = Math.max(this.shake, 0.35);
    this.lastHurt = t;
    if (src) this.lastHurtFrom = { x: src.x, z: src.z };
    sfx.hurt();
    return dmg;
  }

  knock(dx, dz) {
    this.vx = (this.vx || 0) + dx;
    this.vz = (this.vz || 0) + dz;
  }

  addShake(a) {
    this.shake = Math.max(this.shake, a);
  }

  update(dt, canMove) {
    const k = this.keys, w = this.world, p = this.pos;
    let fx = 0, fz = 0;
    if (canMove) {
      if (k.KeyW) fz -= 1;
      if (k.KeyS) fz += 1;
      if (k.KeyA) fx -= 1;
      if (k.KeyD) fx += 1;
    }
    const len = Math.hypot(fx, fz);
    if (len > 0) { fx /= len; fz /= len; }

    // ---- 地形(換格時才查材質) ----
    const cell = Math.floor(p.x / 2) + Math.floor(p.z / 2) * 1000 + Math.round(p.y * 4) * 1e6;
    if (cell !== this._cell) {
      this._cell = cell;
      this.surface = w.surfaceAt ? w.surfaceAt(p.x, p.y, p.z) : 'tile';
      this.inWater = this.surface === 'water';
    }
    this.onStair = w.stairAt ? w.stairAt(p.x, p.y, p.z) : -1;

    // ---- 蹲下:C 切換、Ctrl 按住;頭頂空間不足時不能站起來 ----
    const cDown = !!k.KeyC;
    if (canMove && cDown && !this._cPrev) this._crouchToggle = !this._crouchToggle;
    this._cPrev = cDown;
    let crouch = canMove && (this._crouchToggle || !!k.ControlLeft || !!k.ControlRight);
    if (!crouch && this.crouching && w.ceilAt && w.ceilAt(p.x, p.z, p.y) - p.y < HEIGHT + 0.02) crouch = true;
    this.crouching = crouch;
    this.height = crouch ? HEIGHT_CROUCH : HEIGHT;
    this.crouchT += ((crouch ? 1 : 0) - this.crouchT) * Math.min(1, dt * 9);

    // ---- 衝刺與耐力 ----
    if (this.exhausted && this.stamina >= STAM_MIN) this.exhausted = false;
    const wantSprint = canMove && !!(k.ShiftLeft || k.ShiftRight) && fz < 0 && !crouch;
    this.sprinting = wantSprint && this.onGround && !this.exhausted && this.stamina > 0;
    if (this.sprinting) {
      this.stamina = Math.max(0, this.stamina - STAM_DRAIN * (this.inWater ? 1.8 : 1) * dt);
      this._stamT = STAM_DELAY;
      if (this.stamina <= 0) this.exhausted = true;
    } else if ((this._stamT -= dt) <= 0) this.stamina = Math.min(1, this.stamina + STAM_REGEN * (len > 0 ? 0.75 : 1) * dt);

    // ---- 目標速度(蹲/走/衝;淺水與上樓梯變慢) ----
    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    const wx = fx * cos + fz * sin;
    const wz = -fx * sin + fz * cos;
    let speed = (crouch ? CROUCH : this.sprinting ? SPRINT : WALK) * this.speedMul;
    if (this.inWater) speed *= 0.68;
    if (this.onStair >= 0 && len > 0) {
      const s = w.layout.stairs[this.onStair], up = Math.sign(s.highAt - s.lowAt);
      const along = (s.axis === 'z' ? wz : wx) * up; // >0 上樓
      speed *= 1 - 0.2 * Math.max(0, along) - 0.06 * Math.max(0, -along);
    }
    const tx = wx * speed, tz = wz * speed;
    // 加速度/摩擦(慣性);空中只有少量控制
    const acc = this.onGround ? (len > 0 ? ACCEL : FRICTION) : AIR_ACCEL;
    let dvx = tx - this.vx, dvz = tz - this.vz;
    const dl = Math.hypot(dvx, dvz), maxd = acc * dt;
    if (dl > maxd) { dvx *= maxd / dl; dvz *= maxd / dl; }
    this.vx += dvx;
    this.vz += dvz;

    // ---- 跳躍(按鍵緩衝 0.12s、離地寬限 0.1s) ----
    const space = canMove && !!k.Space;
    if (space && !this._spacePrev) this._jumpBuf = 0.12;
    this._spacePrev = space;
    this._jumpBuf -= dt;
    this._coyote = this.onGround ? 0.1 : this._coyote - dt;
    if (this._jumpBuf > 0 && this._coyote > 0 && !crouch && this.stamina >= JUMP_COST * 0.5) {
      this.vy = JUMP_V * (this.inWater ? 0.8 : 1);
      this.onGround = false;
      this._coyote = this._jumpBuf = 0;
      this.stamina = Math.max(0, this.stamina - JUMP_COST);
      this._stamT = STAM_DELAY;
      sfx.step(true, this.surface);
    }

    // ---- 積分 + 碰撞(world.resolve 處理牆/道具/地面/天花板/落地) ----
    const wasAir = !this.onGround;
    if (!this.onGround) { this.vy -= G * dt; p.y += this.vy * dt; }
    const ex = p.x + this.vx * dt, ez = p.z + this.vz * dt;
    p.x = ex;
    p.z = ez;
    w.resolve(p, RADIUS, this);
    // 被牆推回:去掉往牆裡的速度分量(貼牆滑行、被擊退撞牆不會黏住)
    const px = p.x - ex, pz = p.z - ez, pl = Math.hypot(px, pz);
    if (pl > 1e-5) {
      const nx = px / pl, nz = pz / pl, vn = this.vx * nx + this.vz * nz;
      if (vn < 0) { this.vx -= nx * vn; this.vz -= nz * vn; }
    }
    if (wasAir && this.onGround && this.landV > 1) { // 落地:鏡頭下沉 + 腳步聲
      this.dipV -= Math.min(5, this.landV) * 0.32;
      sfx.step(this.landV > 3, this.surface);
    }
    const sp = Math.hypot(this.vx, this.vz);
    this.speedNorm = Math.min(1, sp / 3.3);

    // ---- 鏡頭擺動與腳步聲(只在地面上) ----
    if (this.onGround) {
      this.bobT += dt * sp * 1.9;
      const prev = this.stepT;
      this.stepT = Math.floor(this.bobT / Math.PI);
      if (this.stepT !== prev && sp > 1) sfx.step(this.sprinting, this.surface);
    }

    // 後座力回復
    const rec = this.recoilBank * Math.min(1, dt * 5);
    this.recoilBank -= rec;
    this.pitch -= rec * 0.7;

    // ---- 鏡頭:蹲姿與踏上矮台平滑、落地下沉彈簧 ----
    this.dipV += (-this.dip * 110 - this.dipV * 16) * dt;
    this.dip += this.dipV * dt;
    if (this.onGround) {
      const d = p.y - this.viewY;
      this.viewY = d > 1 || d < -1 ? p.y : this.viewY + d * Math.min(1, dt * 16);
    } else this.viewY = p.y;
    this.eyeH = EYE + (EYE_CROUCH - EYE) * this.crouchT;
    this.shake = Math.max(0, this.shake - dt);
    const bobAmp = this.onGround ? 1 - this.crouchT * 0.5 : 0;
    const bobY = Math.sin(this.bobT * 2) * 0.035 * this.speedNorm * bobAmp;
    const bobX = Math.cos(this.bobT) * 0.025 * this.speedNorm * bobAmp;
    const sh = this.shake * (Math.random() - 0.5) * 0.08;
    this.camera.position.set(p.x + bobX * cos, this.viewY + this.eyeH + bobY + this.dip + sh, p.z - bobX * sin);
    this.camera.rotation.order = 'YXZ';
    this.camera.rotation.set(this.pitch + sh, this.yaw, 0);
  }

  get eye() {
    return this.camera.position;
  }
}
