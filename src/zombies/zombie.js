import * as THREE from 'three';
import { sfx } from '../audio.js';
import { TYPES } from './types.js';
import { getVariant, instantiate } from './model.js';

const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const lerp = (a, b, t) => a + (b - a) * t;
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const env = (t, a, b, c, d) => sstep(a, b, t) * (1 - sstep(c, d, t)); // 進場 a→b、退場 c→d 的包絡
const wrapA = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const TAU = Math.PI * 2;
const say = (name, ...a) => sfx[name](...a);

// 斷口截面(血肉 + 骨頭),所有殭屍共用幾何與材質
let STUMP = null;
const _UP = new THREE.Vector3(0, 1, 0), _dir = new THREE.Vector3();
function stumpParts() {
  if (!STUMP) {
    STUMP = {
      geo: new THREE.SphereGeometry(1, 14, 10),
      meat: new THREE.MeshStandardMaterial({ color: 0x4a0907, roughness: 0.38, metalness: 0.05, emissive: 0x120101 }),
      bone: new THREE.MeshStandardMaterial({ color: 0xd9cfb6, roughness: 0.55 }),
    };
  }
  return STUMP;
}

// 血條顏色:滿血綠 → 2/3 橘 → 1/3 紅(中間線性漸變)
const GREEN = [46, 204, 64];
const ORANGE = [255, 159, 26];
const RED = [225, 29, 29];
export function hpColor(ratio) {
  const hp = ratio * 150;
  let a, b, t;
  if (hp >= 150) return GREEN;
  if (hp >= 100) { a = ORANGE; b = GREEN; t = (hp - 100) / 50; }
  else if (hp > 50) { a = RED; b = ORANGE; t = (hp - 50) / 50; }
  else return RED;
  return a.map((v, i) => Math.round(v + (b[i] - v) * t));
}

function makeBar(wide) {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 16;
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, fog: false }));
  sprite.scale.set(wide ? 1.5 : 1.0, wide ? 0.17 : 0.13, 1);
  sprite.renderOrder = 10;
  return { c, tex, sprite };
}

export class Zombie {
  // pos = {x, y, z}:出生點(y 為地面高度)
  constructor(scene, pos, round, type = 'walker') {
    const T = TYPES[type];
    this.type = type;
    this.T = T;
    this.scene = scene;
    this.maxHp = type === 'brute' ? T.hp + 60 * Math.max(0, round - 5) : T.hp;
    this.hp = this.maxHp;
    this.alive = true;
    this.dying = 0;
    this.pos = new THREE.Vector3(pos.x, pos.y || 0, pos.z);
    this.vel = new THREE.Vector3();
    this.speed = lerp(T.speed[0], T.speed[1], Math.random()) * (type === 'brute' ? 1 : 1 + Math.min(0.3, (round - 1) * 0.02));
    this.heading = Math.random() * TAU;
    this.state = 'chase';
    this.st = 0;
    this.st0 = 0;
    this.ph = Math.random() * TAU;
    this.t = Math.random() * 100;
    this.seed = Math.random() * 100;
    this.attackCd = 0.5;
    this.specialCd = 1.5 + Math.random() * 2;
    this.groanT = 1 + Math.random() * 5;
    this.losT = 0;
    this.los = false;
    this.dist = 99;
    this.want = { x: 0, z: 0, speed: 0, face: null, instant: false };
    this.flinch = 0; this.flinchV = 0; this.roll = 0; this.rollV = 0; this.headKick = 0;
    this.rootY = 0; this.rootPitch = 0; this.rootRoll = 0;
    this.jawT = 0;
    this.pull = 0;
    this.stepN = 0;
    // 個性:手臂姿勢、跛腳、歪頭、駝背
    const r = Math.random();
    this.armStyle = type !== 'walker' ? 'none' : r < 0.5 ? 'reach' : r < 0.75 ? 'one' : 'hang';
    this.limpSide = Math.random() < 0.5 ? 1 : -1;
    this.limp = type === 'walker' && Math.random() < 0.35 ? 0.5 + Math.random() * 0.5 : 0;
    this.tilt = (Math.random() - 0.5) * 0.5;
    this.lean = 0.08 + Math.random() * 0.16;
    this.twitchT = 1 + Math.random() * 3;
    this.twitch = 0;
    this.twitchDir = 0;
    this.stumbleT = 5 + Math.random() * 10;
    if (type === 'runner') this.specialCd = 0.3;

    // 模型
    const v = getVariant(type);
    this.V = v;
    const inst = instantiate(v);
    this.mesh = inst.mesh;
    this.b = inst.bones;
    this.boneList = inst.list;
    this.rest = inst.rest;
    for (const n of ['spine', 'chest', 'neck', 'head']) this.b[n].rotation.order = 'YXZ';
    this.hitboxes = inst.hits;
    for (const h of this.hitboxes) h.userData.zombie = this;
    this.meshes = this.hitboxes; // 射線判定只打隱形命中盒
    this.k = 0.95 + Math.random() * 0.1;
    this.mesh.scale.setScalar(this.k);
    this.legT = v.legT;
    this.legS = v.legS;
    this.hipY = this.b.hips.position.y;
    this.mouthOff = v.mouth.clone().sub(v.rig.bones[v.rig.index.head].head);
    this.headH = v.rig.HC.y * this.k;
    this.vp = { x: pos.x, y: (pos.y || 0) + (type === 'crawler' ? 0.4 : this.headH), z: pos.z };

    this.root = new THREE.Group();
    this.root.rotation.order = 'YXZ';
    this.root.add(this.mesh);
    this.bar = makeBar(type === 'brute');
    this.bar.sprite.position.set(0, type === 'crawler' ? 0.95 : this.headH + 0.32, 0);
    this.root.add(this.bar.sprite);
    this.drawBar();
    this.root.position.copy(this.pos);
    scene.add(this.root);
  }

  drawBar() {
    const { c, tex } = this.bar;
    const ctx = c.getContext('2d');
    const f = Math.max(0, this.hp / this.maxHp);
    ctx.clearRect(0, 0, 128, 16);
    ctx.fillStyle = 'rgba(0,0,0,0.65)';
    ctx.fillRect(0, 0, 128, 16);
    const [r, g, b] = hpColor(f);
    ctx.fillStyle = `rgb(${r},${g},${b})`;
    ctx.fillRect(2, 2, 124 * f, 12);
    ctx.fillStyle = 'rgba(255,255,255,0.2)';
    ctx.fillRect(2, 2, 124 * f, 4);
    tex.needsUpdate = true;
  }

  // 多人時追最近、活著且未倒地的玩家;對目前目標有黏著性,避免來回切換。單人只有自己
  pickTarget(ctx) {
    const list = ctx.players;
    if (!list || list.length < 2) return ctx.player;
    const dist = (p) => Math.hypot(p.pos.x - this.pos.x, p.pos.z - this.pos.z) + Math.abs(p.pos.y - this.pos.y) * 3;
    const ok = (p) => p && p.alive !== false && !p.downed;
    let best = ok(this.target) ? this.target : null, bd = best ? dist(best) * 0.75 : Infinity;
    for (const p of list) if (ok(p) && dist(p) < bd) { bd = dist(p); best = p; }
    return best || ctx.player;
  }
  // 鏡頭震動只作用在本機玩家,依與本機玩家的距離衰減
  _shakeLocal(ctx, a, range) {
    const lp = ctx.player;
    const d = Math.hypot(lp.pos.x - this.pos.x, lp.pos.z - this.pos.z) + Math.abs(lp.pos.y - this.pos.y) * 2;
    lp.addShake(a * Math.max(0, 1 - d / range));
  }

  go(s) {
    this.state = s;
    this.st = 0;
    this.st0 = -1;
  }
  cross(t) { return this.st0 < t && this.st >= t; }

  // part:'head' | 'body' | 'armor' | 'arm' | 'leg';回傳是否擊殺
  // hit(可省略,只在呼叫期間有效):{ bone 命中盒所在骨骼, point, dir, dmg 實際傷害, range 射擊距離, weapon, explosive, melee }
  damage(amount, part = 'body', hit = null) {
    if (!this.alive) return false;
    let m = part === 'head' ? 2 : 1;
    if (part === 'armor') m = this.T.bodyArmor ?? 1;
    if (this.state === 'stun') m *= 1.6;
    const dmg = amount * m;
    this.hp = Math.max(0, this.hp - dmg);
    const heavy = this.type === 'brute' ? 0.18 : this.type === 'bloater' ? 0.5 : 1;
    const k = Math.min(2, dmg / 30) * heavy;
    this.flinchV += (part === 'head' ? 7 : 4.5) * k;
    this.rollV += (Math.random() - 0.5) * 9 * k;
    if (part === 'head') this.headKick = Math.min(1.2, this.headKick + 0.7 * heavy);
    this.drawBar();
    if (this.hp <= 0) { this.die(part, hit); return true; }
    if (this.t - (this.painT ?? -9) > 0.7) { this.painT = this.t; say('zPain', this.type, this.vp); }
    if (part === 'leg') {
      if (this.type === 'runner' && dmg >= 20 && (this.state === 'chase' || this.state === 'attack')) this.go('trip');
      else if (this.type === 'walker' && this.state === 'chase' && Math.random() < 0.4) this.go('stagger');
    } else if (this.type === 'walker' && dmg >= 55 && this.state === 'chase') this.go('stagger');
    return false;
  }

  die(part, hit = null) {
    this.alive = false;
    this.dying = 1e-4;
    this.bar.sprite.visible = false;
    say('zDie', this.type, this.vp);
    const r = Math.random();
    this.deathKind = this.type === 'bloater' ? 'burst' : this.type === 'crawler' ? 'flat' : this.type === 'brute' ? 'kneel'
      : this.state === 'leap' || this.state === 'trip' ? 'front'
        : part === 'head' ? (r < 0.65 ? 'back' : 'kneel') : r < 0.4 ? 'front' : r < 0.72 ? 'back' : 'kneel';
    this.deathSide = Math.random() < 0.5 ? 1 : -1;
    this.landed = false;
    this.exploded = false;
    this.rootY = Math.max(0, this.rootY);
    this.killPart = part;
    this._gib(part, hit);
  }

  // ---- 斷頭/斷肢(擊殺時):把該骨骼縮到 0(連帶子骨骼與命中盒),斷口加一塊血肉截面;噴血由戰鬥系統依 this.gore 處理 ----
  _gib(part, hit) {
    this.gore = null;
    const b = this.b;
    const boom = !!(hit && hit.explosive);
    if ((part === 'head' && !boom) || (boom && Math.random() < 0.15)) {
      if (this.type === 'brute') { this.gore = { kind: 'headBlood', bone: 'neck', child: 'head' }; return; } // 巨屍頭太硬:只噴血
      b.head.scale.setScalar(0);
      this._stump('neck', 'head', 0.052);
      this.gore = { kind: 'head', bone: 'neck', child: 'head' };
      if (this.deathKind === 'kneel' && Math.random() < 0.5) this.deathKind = 'back';
      return;
    }
    const dmg = hit ? hit.dmg || 0 : 0;
    const strong = dmg >= 55 || (hit && hit.weapon === 'shotgun' && hit.range < 5) || boom;
    if (!strong || (part !== 'arm' && part !== 'leg' && !boom) || Math.random() > (boom ? 0.55 : 0.7)) return;
    const s = Math.random() < 0.5 ? 'L' : 'R';
    let bone = hit && hit.bone && b[hit.bone] ? hit.bone : null;
    if (boom || !bone) bone = Math.random() < 0.5 && !this.V.P.legless ? 'shin' + s : 'forearm' + s;
    if (/^hand/.test(bone)) bone = bone.replace('hand', 'forearm');
    if (/^foot/.test(bone)) bone = bone.replace('foot', 'shin');
    if (/^upperArm|^thigh/.test(bone) && Math.random() < 0.5) bone = bone.replace('upperArm', 'forearm').replace('thigh', 'shin'); // 一半機率只斷前段
    const bb = b[bone];
    if (!bb || !bb.parent || bb.scale.x === 0) return;
    bb.scale.setScalar(0);
    this._stump(bb.parent.name, bone, /^thigh/.test(bone) ? 0.07 : /^shin|^upperArm/.test(bone) ? 0.05 : 0.04);
    this.gore = { kind: 'limb', bone: bb.parent.name, child: bone };
    if (/^thigh|^shin/.test(bone) && this.deathKind === 'kneel') this.deathKind = 'front';
  }

  _stump(parent, child, r) {
    const S = stumpParts();
    const pb = this.b[parent], cb = this.b[child];
    const g = new THREE.Group();
    g.position.copy(cb.position);
    g.quaternion.setFromUnitVectors(_UP, _dir.copy(cb.position).normalize());
    const meat = new THREE.Mesh(S.geo, S.meat);
    meat.scale.set(r, r * 0.45, r);
    const bone = new THREE.Mesh(S.geo, S.bone);
    bone.scale.set(r * 0.32, r * 0.5, r * 0.32);
    bone.position.y = r * 0.12;
    g.add(meat, bone);
    pb.add(g);
  }

  // ctx = { player, world, zombies, hazards, game };回傳本幀對玩家的近戰傷害
  update(dt, ctx) {
    this.t += dt;
    if (!this.alive) { this._dead(dt, ctx); return 0; }
    const { world, zombies } = ctx;
    const player = (this.target = this.pickTarget(ctx));
    const toX = player.pos.x - this.pos.x, toZ = player.pos.z - this.pos.z;
    const dist = Math.hypot(toX, toZ) || 1e-3;
    this.dist = dist;
    this.losT -= dt;
    if (this.losT <= 0) {
      this.losT = 0.15 + Math.random() * 0.1;
      this.los = dist < 18 && world.hasLineOfSight(this.pos.x, this.pos.y + 1.4, this.pos.z, player.pos.x, player.pos.y + 1.4, player.pos.z);
    }
    const w = this.want;
    if (dist < 4 && this.los) { w.x = toX / dist; w.z = toZ / dist; }
    else {
      const f = world.flowDir(this.pos.x, this.pos.y, this.pos.z, this._dir || (this._dir = { x: 0, z: 0 }));
      if (f) { w.x = f.x; w.z = f.z; } else { w.x = toX / dist; w.z = toZ / dist; }
    }
    w.speed = this.speed;
    w.face = null;
    w.instant = false;
    this.st0 = this.st;
    this.st += dt;
    this.attackCd -= dt;
    this.specialCd -= dt;

    const dealt = this['_think_' + this.type](dt, ctx, dist, toX, toZ, w);

    // ---- 移動 ----
    if (w.instant) { this.vel.x = w.x * w.speed; this.vel.z = w.z * w.speed; }
    else {
      const k = Math.min(1, dt * (this.state === 'charge' ? 3 : 6));
      this.vel.x += (w.x * w.speed - this.vel.x) * k;
      this.vel.z += (w.z * w.speed - this.vel.z) * k;
    }
    for (const o of zombies) {
      if (o === this || !o.alive) continue;
      const ax = this.pos.x - o.pos.x, az = this.pos.z - o.pos.z, rr = this.T.radius + o.T.radius;
      const d2 = ax * ax + az * az;
      if (d2 < rr * rr && d2 > 1e-4) {
        const d = Math.sqrt(d2), push = (rr - d) * 80 * dt * (o.T.mass / (o.T.mass + this.T.mass));
        this.vel.x += (ax / d) * push;
        this.vel.z += (az / d) * push;
      }
    }
    const ox = this.pos.x, oz = this.pos.z;
    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;
    const ex = this.pos.x, ez = this.pos.z;
    world.resolve(this.pos, Math.min(this.T.radius, 0.42));
    const moved = Math.hypot(ex - ox, ez - oz);
    this.blocked = moved > 1e-4 && Math.hypot(this.pos.x - ex, this.pos.z - ez) > moved * 0.5;
    const minD = this.T.radius + 0.38;
    const pd = Math.hypot(this.pos.x - player.pos.x, this.pos.z - player.pos.z);
    if (pd < minD) {
      const nx = (this.pos.x - player.pos.x) / (pd || 1), nz = (this.pos.z - player.pos.z) / (pd || 1);
      this.pos.x = player.pos.x + nx * minD;
      this.pos.z = player.pos.z + nz * minD;
    }

    // ---- 朝向 ----
    const sp = Math.hypot(this.vel.x, this.vel.z);
    this.speedNow = sp;
    const target = w.face ?? (dist < 5 ? Math.atan2(toX, toZ) : sp > 0.1 ? Math.atan2(this.vel.x, this.vel.z) : this.heading);
    this.heading += wrapA(target - this.heading) * Math.min(1, dt * this.T.turn);

    // ---- 動畫 ----
    this.mesh.castShadow = dist < 11; // 遠處的不進陰影貼圖,省一半繪製量
    this._resetPose();
    this['_pose_' + this.type](dt, ctx, dist, toX, toZ);
    this._reactions(dt);
    this._applyRoot();
    // 腳步(巨屍用重踏,爬行者用拖行,另外處理)
    if (this.type !== 'brute' && this.type !== 'crawler') {
      const n = Math.floor((this.ph + Math.PI / 2) / Math.PI);
      if (n !== this.stepN) { this.stepN = n; if (sp > 0.3 && this.rootY < 0.05) say('zStep', this.type, this.pos); }
    }

    // ---- 叫聲 ----
    this.vp.x = this.pos.x;
    this.vp.y = this.pos.y + (this.type === 'crawler' ? 0.4 : this.headH);
    this.vp.z = this.pos.z;
    this.groanT -= dt;
    if (this.groanT <= 0) {
      this.groanT = { walker: 4, runner: 2.5, crawler: 4, bloater: 3.5, brute: 5 }[this.type] + Math.random() * 5;
      if (this.type === 'bloater' && Math.random() < 0.5) say('gurgle', this.vp);
      else say('groan', this.type, this.vp);
      this.jawT = 1.3;
    }
    this.jawT = Math.max(0, this.jawT - dt);
    return dealt;
  }

  // ======================= 行為 =======================
  _think_walker(dt, ctx, dist, toX, toZ, w) {
    const T = this.T;
    let dealt = 0;
    if (this.limp) w.speed *= 0.8;
    switch (this.state) {
      case 'chase':
        this.stumbleT -= dt;
        if (this.stumbleT <= 0 && this.speedNow > 0.4) { this.go('stumble'); this.stumbleT = 7 + Math.random() * 10; }
        else if (dist < T.reach + 0.1 && this.attackCd <= 0) { this.go('attack'); say('zAttack', this.type, this.vp); }
        if (dist < T.reach - 0.1) w.speed = 0;
        break;
      case 'stumble':
        w.speed *= this.st < 0.45 ? 1.4 : 0.15;
        if (this.st > 1.1) this.go('chase');
        break;
      case 'attack':
        w.speed = dist > T.reach * 0.8 ? this.speed * 0.4 : 0;
        if (this.cross(0.58) && dist < T.reach + 0.4) { dealt = T.dmg; say('bite', this.target.pos); }
        if (this.st > 1.1) { this.go('chase'); this.attackCd = T.cd - 1.1; }
        break;
      case 'stagger':
        w.speed = 0;
        if (this.st > 0.6) this.go('chase');
        break;
      default: this.go('chase');
    }
    return dealt;
  }

  _think_runner(dt, ctx, dist, toX, toZ, w) {
    const T = this.T, L = T.lunge, p = this.target;
    let dealt = 0;
    if (!this.spotted && this.los && dist < 15) { this.spotted = true; say('shriek', this.vp); this.jawT = 1; }
    switch (this.state) {
      case 'chase':
        if (this.los && dist > 3 && dist < 12) { // 之字形逼近,較難瞄準
          const s = Math.sin(this.t * 2.6 + this.seed) * 0.9;
          const px = -w.z, pz = w.x;
          w.x += px * s; w.z += pz * s;
          const l = Math.hypot(w.x, w.z); w.x /= l; w.z /= l;
        }
        if (this.los && dist > L.min && dist < L.max && this.specialCd <= 0) { this.go('crouch'); say('shriek', this.vp); }
        else if (dist < T.reach + 0.1 && this.attackCd <= 0) { this.go('attack'); say('zAttack', this.type, this.vp); }
        if (dist < T.reach - 0.15) w.speed = 0;
        break;
      case 'crouch':
        w.speed = 0;
        w.face = Math.atan2(toX, toZ);
        if (this.st > 0.32) {
          const tx = p.pos.x + (p.vx || 0) * 0.25 - this.pos.x, tz = p.pos.z + (p.vz || 0) * 0.25 - this.pos.z, l = Math.hypot(tx, tz) || 1;
          this.leap = { x: tx / l, z: tz / l, hit: false };
          this.go('leap');
        }
        break;
      case 'leap': {
        w.x = this.leap.x; w.z = this.leap.z; w.speed = L.speed; w.instant = true;
        w.face = Math.atan2(this.leap.x, this.leap.z);
        const u = this.st / 0.46;
        this.rootY = Math.max(0, 4 * 0.42 * u * (1 - u));
        if (!this.leap.hit && dist < 0.95) {
          this.leap.hit = true;
          dealt = L.dmg;
          p.knock(this.leap.x * 5, this.leap.z * 5);
          say('bite', p.pos);
        }
        if (this.st > 0.46) { this.rootY = 0; this.go('recover'); }
        break;
      }
      case 'recover':
        w.speed = this.speed * 0.1;
        if (this.st > 0.5) { this.go('chase'); this.specialCd = lerp(L.cd[0], L.cd[1], Math.random()); }
        break;
      case 'attack':
        w.speed = dist > 0.85 ? this.speed * 0.3 : 0;
        if (this.cross(0.5) && dist < T.reach + 0.35) { dealt = T.dmg; say('bite', p.pos); }
        if (this.st > 0.7) { this.go('chase'); this.attackCd = T.cd - 0.7; }
        break;
      case 'trip': // 腿中彈摔倒,滑行後爬起
        w.speed = Math.max(0, this.speed * (1 - this.st * 2.5));
        w.x = Math.sin(this.heading); w.z = Math.cos(this.heading);
        w.face = this.heading;
        if (this.cross(0.38)) say('thud', this.vp, false);
        if (this.st > 1.3) this.go('getup');
        break;
      case 'getup':
        w.speed = 0;
        if (this.st > 0.8) this.go('chase');
        break;
      default: this.go('chase');
    }
    return dealt;
  }

  _think_crawler(dt, ctx, dist, toX, toZ, w) {
    const T = this.T;
    let dealt = 0;
    switch (this.state) {
      case 'chase':
        w.speed = this.speed * (0.2 + 1.0 * this.pull);
        if (dist < T.reach && this.attackCd <= 0) { this.go('attack'); say('zAttack', this.type, this.vp); }
        if (dist < T.reach - 0.2) w.speed = 0;
        break;
      case 'attack':
        w.speed = 0;
        w.face = Math.atan2(toX, toZ);
        if (this.cross(0.48) && dist < T.reach + 0.3) { dealt = T.dmg; say('bite', this.target.pos); }
        if (this.st > 0.95) { this.go('chase'); this.attackCd = T.cd - 0.95; }
        break;
      default: this.go('chase');
    }
    return dealt;
  }

  _think_bloater(dt, ctx, dist, toX, toZ, w) {
    const T = this.T, S = T.spit, p = this.target;
    let dealt = 0;
    switch (this.state) {
      case 'chase':
        if (this.los && dist > S.min && dist < S.max && this.specialCd <= 0) this.go('spit');
        else if (dist < T.reach && this.attackCd <= 0) { this.go('attack'); say('zAttack', this.type, this.vp); }
        if (dist < T.reach - 0.15) w.speed = 0;
        break;
      case 'spit':
        w.speed = 0;
        w.face = Math.atan2(toX, toZ);
        if (this.cross(0.74)) {
          this.b.head.updateWorldMatrix(true, false);
          const from = this.b.head.localToWorld(this.mouthOff.clone());
          const lead = Math.min(1.2, dist / 11);
          ctx.hazards.spit(from, new THREE.Vector3(p.pos.x + (p.vx || 0) * lead * 0.6, p.pos.y + 0.9, p.pos.z + (p.vz || 0) * lead * 0.6));
          say('spit', this.vp);
        }
        if (this.st > 1.3) { this.go('chase'); this.specialCd = lerp(S.cd[0], S.cd[1], Math.random()); }
        break;
      case 'attack':
        w.speed = 0;
        w.face = Math.atan2(toX, toZ);
        if (this.cross(0.5) && dist < T.reach + 0.3) { dealt = T.dmg; say('bite', p.pos); }
        if (this.st > 1.0) { this.go('chase'); this.attackCd = T.cd - 1.0; }
        break;
      default: this.go('chase');
    }
    return dealt;
  }

  _think_brute(dt, ctx, dist, toX, toZ, w) {
    const T = this.T, C = T.charge, p = this.target;
    let dealt = 0;
    const shake = (a, range) => this._shakeLocal(ctx, a, range);
    switch (this.state) {
      case 'chase':
        if (this.los && dist > C.min && dist < C.max && this.specialCd <= 0) { this.go('roar'); say('roar', this.vp); this.jawT = 0; }
        else if (dist < T.reach + 0.1 && this.attackCd <= 0) { this.go('slam'); say('zAttack', this.type, this.vp); }
        if (dist < T.reach - 0.35) w.speed = 0;
        break;
      case 'roar':
        w.speed = 0;
        w.face = Math.atan2(toX, toZ);
        if (this.st > 0.3 && this.st < 1.0) shake(0.12, 22);
        if (this.st > 1.15) { this.charge = { x: toX / dist, z: toZ / dist, hit: false }; this.go('charge'); }
        break;
      case 'charge':
        w.x = this.charge.x; w.z = this.charge.z;
        w.speed = C.speed * Math.min(1, 0.35 + this.st * 2.2);
        w.face = Math.atan2(this.charge.x, this.charge.z);
        if (!this.charge.hit && dist < T.radius + 0.65) {
          this.charge.hit = true;
          dealt = C.dmg;
          p.knock(this.charge.x * 11, this.charge.z * 11);
          p.addShake(0.6);
          say('knock');
          this.go('recover');
        } else if (this.blocked && this.st > 0.3) {
          say('wallImpact', this.vp);
          shake(0.5, 16);
          this.go('stun');
        } else if (this.st > 2.3) this.go('recover');
        break;
      case 'stun':
        w.speed = 0;
        if (this.st > 2.4) { this.go('chase'); this.specialCd = lerp(C.cd[0], C.cd[1], Math.random()); }
        break;
      case 'recover':
        w.speed = this.speed * 0.2;
        if (this.st > 0.9) { this.go('chase'); this.specialCd = lerp(C.cd[0], C.cd[1], Math.random()); }
        break;
      case 'slam':
        w.speed = 0;
        if (this.st < 0.6) w.face = Math.atan2(toX, toZ);
        if (this.cross(0.74)) {
          say('stomp', this.vp);
          shake(0.45, 10);
          if (dist < T.reach + 0.55) dealt = T.dmg;
        }
        if (this.st > 1.4) { this.go('chase'); this.attackCd = T.cd - 1.4; }
        break;
      default: this.go('chase');
    }
    return dealt;
  }

  // ======================= 動畫 =======================
  _resetPose() {
    const L = this.boneList;
    for (let i = 0; i < L.length; i++) { L[i].rotation.set(0, 0, 0); L[i].position.copy(this.rest[i]); }
    this.b.belly.scale.setScalar(1);
  }

  // 雙腿步態;回傳著地腿的垂直長度(用來讓骨盆跟著上下)
  _legs(ph, amp, knee, crouch, o = {}) {
    const b = this.b;
    let ext = 0;
    for (let k = 0; k < 2; k++) {
      const s = k ? -1 : 1, L = k ? 'R' : 'L';
      const p = ph + k * Math.PI;
      const bad = this.limp && this.limpSide === s ? this.limp : 0;
      const c = Math.cos(p);
      const th = -amp * (1 - bad * 0.5) * Math.sin(p) - crouch + (o.th ?? 0);
      const kn = knee * (1 - bad * 0.8) * Math.pow(Math.max(0, c), 1.3) + crouch * 1.6 + 0.03 + (o.kn ?? 0);
      b['thigh' + L].rotation.set(th, s * ((o.toe ?? 0.06) + bad * 0.3), s * (o.wide ?? 0.03));
      b['shin' + L].rotation.x = kn;
      b['foot' + L].rotation.x = -(th + kn) * 0.85 + bad * 0.55 * Math.max(0, c) + (o.foot ?? 0);
      ext = Math.max(ext, this.legT * Math.cos(th) + this.legS * Math.cos(th + kn));
    }
    return ext;
  }
  _hipsTo(ext, extra = 0) { this.b.hips.position.y = this.hipY - (this.legT + this.legS - ext) - extra; }
  _advance(dt, amp, sp) { this.ph += (dt * Math.PI * sp) / (2 * (this.legT + this.legS) * Math.sin(Math.max(amp, 0.12))); }
  _arm(L, s, x, z, elbow, wrist = 0, y = 0) {
    const b = this.b;
    b['upperArm' + L].rotation.set(x, s * y, s * z);
    b['forearm' + L].rotation.x = -elbow;
    b['hand' + L].rotation.x = wrist;
  }
  _look(toX, toZ, amt = 1) {
    const rel = clamp(wrapA(Math.atan2(toX, toZ) - this.heading), -1.1, 1.1) * amt;
    this.b.neck.rotation.y += rel * 0.4;
    this.b.head.rotation.y += rel * 0.55;
  }
  _jaw(base) {
    const g = this.jawT > 0 ? Math.sin((1 - this.jawT / 1.3) * Math.PI) * 0.4 : 0;
    this.b.jaw.rotation.x = Math.max(this.b.jaw.rotation.x, base + g);
  }

  _pose_walker(dt, ctx, dist, toX, toZ) {
    const b = this.b, sp = this.speedNow, f = Math.min(1, sp / 0.8), st = this.st;
    const amp = 0.3 * f + 0.03;
    this._advance(dt, amp, sp);
    const ph = this.ph;
    let crouch = 0.07, extra = 0;
    const stumble = this.state === 'stumble' ? env(st, 0, 0.25, 0.6, 1.1) : 0;
    const stagger = this.state === 'stagger' ? env(st, 0, 0.1, 0.3, 0.6) : 0;
    crouch += stumble * 0.25 + stagger * 0.15;
    const ext = this._legs(ph, amp, 0.55 * f + 0.06, crouch, { toe: 0.1, wide: 0.04 });
    this._hipsTo(ext, extra);
    b.hips.rotation.z = Math.sin(ph) * 0.07 * f + (this.limp ? -this.limpSide * 0.06 * Math.max(0, Math.sin(ph + (this.limpSide > 0 ? 0 : Math.PI))) : 0);
    b.hips.rotation.y = Math.sin(ph) * 0.12 * f;
    b.spine.rotation.set(this.lean * 0.6 + stumble * 0.45 - stagger * 0.35, -b.hips.rotation.y * 0.7, -b.hips.rotation.z * 0.8 + this.tilt * 0.15);
    b.chest.rotation.set(this.lean * 0.4 + 0.04 * Math.sin(ph * 2) * f + stumble * 0.2, -b.hips.rotation.y * 0.4, 0);
    b.neck.rotation.x = 0.1 + stumble * 0.2;
    b.head.rotation.set(-0.08 + Math.sin(ph * 2) * 0.05 * f - stumble * 0.3, 0, this.tilt + Math.sin(this.t * 0.7) * 0.09);
    this._look(toX, toZ, 0.8);
    // 手臂
    const atk = this.state === 'attack';
    const raise = atk ? env(st, 0, 0.35, 0.75, 1.1) : 0;
    const clamp2 = atk ? env(st, 0.42, 0.56, 0.75, 1.05) : 0;
    for (let k = 0; k < 2; k++) {
      const s = k ? -1 : 1, L = k ? 'R' : 'L';
      const reach = this.armStyle === 'reach' || (this.armStyle === 'one' && k === 0);
      let x, z, el, wr;
      if (reach) {
        x = -1.32 - 0.1 * Math.sin(this.t * 1.3 + k * 2) + Math.sin(ph + k * Math.PI) * 0.06 * f;
        z = 0.14; el = 0.25 + 0.08 * Math.sin(this.t * 1.7 + k); wr = 0.35;
      } else {
        x = -Math.sin(ph + k * Math.PI) * 0.32 * f + 0.06;
        z = 0.08; el = 0.2 + 0.15 * f; wr = 0.12;
      }
      x = lerp(x, -1.6, raise) + clamp2 * 0.1;
      z = lerp(z, 0.45, raise) - clamp2 * 0.62;
      el = lerp(el, 0.35, raise);
      x += stumble * Math.sin(this.t * 13 + k * 2) * 0.6 - stumble * 0.6;
      this._arm(L, s, x, z, el, wr);
    }
    b.spine.rotation.x += clamp2 * 0.35;
    b.head.rotation.x += clamp2 * 0.35;
    b.jaw.rotation.x = 0.06 + clamp2 * 0.55 + raise * 0.2;
    this._jaw(0.06);
  }

  _pose_runner(dt, ctx, dist, toX, toZ) {
    const b = this.b, sp = this.speedNow, st = this.st, S = this.state;
    const f = clamp(sp / 4, 0, 1);
    const amp = lerp(0.3, 0.82, f) * Math.min(1, sp / 0.6 + 0.05);
    this._advance(dt, amp, sp);
    const ph = this.ph;
    let crouch = 0.1 + f * 0.08, lean = 0.2 + 0.35 * f;
    let o = { toe: 0.05, wide: 0.05 };
    if (S === 'crouch') { crouch = lerp(crouch, 0.5, sstep(0, 0.2, st)); lean = 0.6; }
    if (S === 'recover') { crouch = lerp(0.45, 0.15, st / 0.5); lean = 0.5; }
    if (S === 'leap') o = { th: 0.5, kn: 0.6, toe: 0.05, wide: 0.08 };
    const ext = this._legs(ph, S === 'leap' ? 0 : amp, lerp(0.6, 1.8, f), crouch, o);
    this._hipsTo(S === 'leap' ? this.legT + this.legS : ext);
    b.hips.rotation.y = Math.sin(ph) * 0.2 * f;
    b.hips.rotation.z = Math.sin(ph) * 0.05 * f;
    b.spine.rotation.set(lean * 0.6, -b.hips.rotation.y * 1.2, -b.hips.rotation.z);
    b.chest.rotation.set(lean * 0.5, -b.hips.rotation.y * 0.6, 0);
    b.neck.rotation.x = 0.1;
    b.head.rotation.set(-lean * 0.8, 0, 0);
    // 抽搐:不定時的猛甩頭
    this.twitchT -= dt;
    if (this.twitchT <= 0) { this.twitchT = 0.6 + Math.random() * 2.5; this.twitch = 1; this.twitchDir = (Math.random() - 0.5) * 2; }
    this.twitch = Math.max(0, this.twitch - dt * 5);
    b.head.rotation.z += this.twitch * this.twitchDir * 0.5 + Math.sin(this.t * 31) * 0.03;
    b.head.rotation.y += this.twitch * this.twitchDir * 0.3;
    this._look(toX, toZ, 0.7);
    for (let k = 0; k < 2; k++) {
      const s = k ? -1 : 1, L = k ? 'R' : 'L';
      const sw = Math.sin(ph + k * Math.PI);
      let x = -0.35 + sw * 0.95 * f - 0.25 * f + Math.sin(this.t * 7 + k * 3) * 0.15;
      let z = 0.3 + 0.15 * Math.sin(ph * 2 + k), el = 0.9 + 0.5 * f, wr = 0.25;
      if (S === 'crouch') { x = 0.7; z = 0.5; el = 0.6; }
      if (S === 'leap') { x = -2.3 + k * 0.2; z = 0.3; el = 0.3; wr = -0.3; }
      if (S === 'recover') { x = lerp(-1.2, -0.4, st / 0.5); z = 0.45; el = 0.6; }
      if (S === 'attack') { // 左右輪流爪擊
        const u = k ? env(st, 0.28, 0.45, 0.52, 0.7) : env(st, 0.0, 0.17, 0.24, 0.42);
        x = lerp(0.5, -1.9, u); z = lerp(0.6, 0.0, u) + 0.2; el = lerp(1.0, 0.2, u);
      }
      if (S === 'trip' || S === 'getup') { x = -1.4; z = 0.4; el = 0.2; }
      this._arm(L, s, x, z, el, wr);
    }
    if (S === 'leap') { b.spine.rotation.x = 0.55; b.head.rotation.x = -0.7; this.rootPitch = 0.35; }
    else this.rootPitch = 0;
    if (S === 'attack') { b.spine.rotation.x += 0.2; b.chest.rotation.y += Math.sin(st * 9) * 0.25; }
    if (S === 'trip') { const e = Math.min(1, (st / 0.38) ** 2); this.rootPitch = e * 1.42; this.rootY = e * 0.12; }
    else if (S === 'getup') { const e = 1 - sstep(0, 0.8, st); this.rootPitch = e * 1.42; this.rootY = e * 0.12; this._legs(0, 0, 0, e * 0.6); }
    else if (S !== 'leap') this.rootY = 0;
    b.jaw.rotation.x = S === 'crouch' || S === 'leap' ? 0.75 : 0.22 + Math.sin(this.t * 9) * 0.1;
    this._jaw(0.2);
  }

  _pose_crawler(dt, ctx, dist, toX, toZ) {
    const b = this.b, s0 = this.V.P.s, st = this.st;
    // 趴地:骨盆轉 90°,身體朝前平躺
    this.ph += dt * TAU * Math.max(0.25, this.speed * 1.1) / 0.62 * (this.state === 'attack' ? 0.2 : 1);
    const ph = this.ph;
    b.hips.position.set(0, 0.165 * s0, -0.36 * s0);
    b.hips.rotation.set(Math.PI / 2 - 0.06, 0, Math.sin(ph) * 0.06);
    let pull = 0;
    for (let k = 0; k < 2; k++) {
      const s = k ? -1 : 1, L = k ? 'R' : 'L';
      const u = (((ph + k * Math.PI) % TAU) + TAU) % TAU / TAU;
      let x, z, el;
      if (u < 0.42) { const q = sstep(0, 1, u / 0.42); x = lerp(-1.4, -2.75, q); el = lerp(1.1, 0.3, q); z = 0.42 + 0.25 * Math.sin(Math.PI * q); }
      else { const q = (u - 0.42) / 0.58; x = lerp(-2.75, -1.4, sstep(0, 1, q)); el = 0.3 + Math.sin(Math.PI * q) * 0.7; z = 0.4; pull = Math.max(pull, Math.sin(Math.PI * q)); }
      if (this.state === 'attack' && k === 0) { const e = env(st, 0.1, 0.4, 0.55, 0.9); x = lerp(x, -3.0, e) + env(st, 0.4, 0.5, 0.6, 0.9) * 1.3; el = lerp(el, 0.2, e); }
      this._arm(L, s, x, z, el, -0.2);
      if (!this.V.P.legless) {
        b['thigh' + L].rotation.set(-0.13 + Math.sin(ph * 0.5 + k) * 0.05, s * 0.15, s * (0.12 + k * 0.08));
        b['shin' + L].rotation.x = 0.25 + k * 0.4 + Math.sin(ph + k) * 0.08;
        b['foot' + L].rotation.x = 1.1;
      }
      const pu = (this.armU ||= [0, 0])[k];
      this.armU[k] = u;
      if (pu < 0.42 && u >= 0.42 && Math.random() < 0.6) say('crawl', this.vp); // 手掌拍地拖行
    }
    this.pull = pull;
    const rear = this.state === 'attack' ? env(st, 0.1, 0.4, 0.6, 0.95) : 0;
    b.spine.rotation.set(-0.1 - pull * 0.06 - rear * 0.35, Math.sin(ph) * 0.1, 0);
    b.chest.rotation.set(-0.16 - rear * 0.3, 0, Math.sin(ph) * 0.14);
    b.neck.rotation.x = -0.62 + rear * 0.2;
    b.head.rotation.set(-0.6 + Math.sin(ph * 2) * 0.07 + rear * 0.15, 0, Math.sin(this.t * 0.9) * 0.1);
    this._look(toX, toZ, 0.9);
    b.jaw.rotation.x = 0.3 + Math.sin(this.t * 4) * 0.12 + rear * 0.45;
    this._jaw(0.25);
  }

  _pose_bloater(dt, ctx, dist, toX, toZ) {
    const b = this.b, sp = this.speedNow, st = this.st, S = this.state;
    const f = Math.min(1, sp / 0.7);
    const amp = 0.2 * f + 0.02;
    this._advance(dt, amp, sp);
    const ph = this.ph;
    const ext = this._legs(ph, amp, 0.35 * f + 0.05, 0.08, { toe: 0.25, wide: 0.1 });
    this._hipsTo(ext);
    const rear = S === 'spit' ? env(st, 0, 0.6, 0.66, 0.75) : 0;
    const lurch = S === 'spit' ? env(st, 0.66, 0.76, 0.9, 1.3) : 0;
    const bump = S === 'attack' ? env(st, 0.25, 0.5, 0.6, 0.95) : 0;
    b.hips.rotation.z = Math.sin(ph) * 0.15 * f;
    b.hips.rotation.y = Math.sin(ph) * 0.08 * f;
    b.spine.rotation.set(-0.1 - rear * 0.35 + lurch * 0.45 + bump * 0.3, -b.hips.rotation.y, -b.hips.rotation.z * 0.6);
    b.chest.rotation.set(0.05 - rear * 0.2 + lurch * 0.25, 0, 0);
    b.neck.rotation.x = 0.15 - rear * 0.2;
    b.head.rotation.set(-0.05 - rear * 0.45 + lurch * 0.4, 0, Math.sin(this.t * 0.6) * 0.15);
    this._look(toX, toZ, 0.6);
    b.belly.scale.setScalar(1 + 0.04 * Math.sin(this.t * 2.2) + 0.03 * Math.sin(ph * 2) * f + rear * 0.18 - lurch * 0.08);
    for (let k = 0; k < 2; k++) {
      const s = k ? -1 : 1, L = k ? 'R' : 'L';
      this._arm(L, s, -0.2 + Math.sin(ph + k * Math.PI) * 0.12 * f - rear * 0.3 - bump * 0.9, 0.5 + rear * 0.3 + 0.04 * Math.sin(this.t + k), 0.6 + bump * 0.3, 0.2);
    }
    b.jaw.rotation.x = 0.1 + rear * 0.3 + lurch * 0.8;
    this._jaw(0.1);
  }

  _pose_brute(dt, ctx, dist, toX, toZ) {
    const b = this.b, sp = this.speedNow, st = this.st, S = this.state;
    const charging = S === 'charge';
    const f = Math.min(1, sp / (charging ? 6 : 1.1));
    const amp = charging ? 0.7 * f + 0.05 : 0.28 * f + 0.02;
    this._advance(dt, amp, sp);
    const ph = this.ph;
    const roar = S === 'roar' ? env(st, 0.05, 0.35, 0.95, 1.15) : 0;
    const raise = S === 'slam' ? env(st, 0.05, 0.6, 0.66, 0.76) : 0;
    const smash = S === 'slam' ? env(st, 0.66, 0.76, 1.0, 1.4) : 0;
    const stun = S === 'stun' ? env(st, 0, 0.3, 2.0, 2.4) : 0;
    const crouch = 0.16 + smash * 0.25 + stun * 0.2 + roar * 0.05;
    const ext = this._legs(ph, amp, charging ? 1.3 : 0.55 * f + 0.05, crouch, { toe: 0.15, wide: 0.1 });
    this._hipsTo(ext);
    // 重踏:每步震動鏡頭
    const n = Math.floor((ph + Math.PI / 2) / Math.PI);
    if (n !== this.stepN) {
      this.stepN = n;
      if (f > 0.3) { say('stomp', this.vp); this._shakeLocal(ctx, charging ? 0.25 : 0.14, 12); }
    }
    b.hips.rotation.z = Math.sin(ph) * 0.08 * f;
    b.hips.rotation.y = Math.sin(ph) * 0.12 * f;
    const lean = charging ? 0.55 : 0.28;
    b.spine.rotation.set(lean - roar * 0.4 - raise * 0.25 + smash * 0.6, -b.hips.rotation.y, -b.hips.rotation.z + Math.sin(this.t * 2.6) * 0.15 * stun);
    b.chest.rotation.set((charging ? 0.3 : 0.18) + 0.03 * Math.sin(ph * 2) * f - roar * 0.35 - raise * 0.15 + smash * 0.35, -b.hips.rotation.y * 1.2, 0);
    b.neck.rotation.x = 0.18 - roar * 0.2 + stun * 0.5;
    b.head.rotation.set(-0.35 - roar * 0.55 + stun * 0.4 + (charging ? -0.2 : 0), 0, Math.sin(this.t * 1.7) * 0.2 * stun);
    if (!stun) this._look(toX, toZ, 0.6);
    b.belly.scale.setScalar(1 + 0.05 * Math.sin(this.t * 1.6) + roar * 0.08);
    for (let k = 0; k < 2; k++) {
      const s = k ? -1 : 1, L = k ? 'R' : 'L';
      const sw = Math.sin(ph + k * Math.PI);
      let x = 0.05 - sw * (charging ? 0.6 : 0.32) * f + (charging ? 0.35 : 0);
      let z = 0.32 + (charging ? 0.15 : 0), el = 0.35 + (charging ? 0.4 : 0);
      x = lerp(x, -0.5, roar); z = lerp(z, 1.15, roar); el = lerp(el, 0.9, roar);
      x = lerp(x, -2.9, raise); z = lerp(z, 0.25, raise); el = lerp(el, 0.6, raise);
      x = lerp(x, -0.55, smash); z = lerp(z, 0.2, smash); el = lerp(el, 0.15, smash);
      x = lerp(x, 0.15, stun); z = lerp(z, 0.2, stun);
      this._arm(L, s, x, z, el, 0.1);
    }
    b.jaw.rotation.x = 0.1 + roar * 0.85 + smash * 0.4 + (charging ? 0.4 : 0);
    this._jaw(0.1);
  }

  // 受擊彈簧:往後仰、側傾、爆頭甩頭
  _reactions(dt) {
    const b = this.b;
    this.flinchV += (-this.flinch * 70 - this.flinchV * 10) * dt;
    this.flinch += this.flinchV * dt;
    this.rollV += (-this.roll * 60 - this.rollV * 9) * dt;
    this.roll += this.rollV * dt;
    this.headKick *= Math.pow(0.015, dt);
    b.spine.rotation.x -= this.flinch * 0.4;
    b.chest.rotation.x -= this.flinch * 0.4;
    b.chest.rotation.z += this.roll * 0.3;
    b.head.rotation.x -= this.flinch * 0.5 + this.headKick * 0.9;
    b.head.rotation.z += this.roll * 0.5;
  }

  _applyRoot() {
    this.root.position.set(this.pos.x, this.pos.y + this.rootY, this.pos.z);
    this.root.rotation.set(this.rootPitch, this.heading, this.rootRoll);
  }

  // ======================= 死亡 =======================
  _dead(dt, ctx) {
    this.dying += dt;
    const t = this.dying, b = this.b, kind = this.deathKind, side = this.deathSide;
    this.vel.multiplyScalar(Math.pow(0.03, dt));
    this.pos.addScaledVector(this.vel, dt);
    ctx.world.resolve(this.pos, 0.3);
    const sm = Math.min(1, dt * 9);
    const R = (bone, x, y, z, k = sm) => { const r = b[bone].rotation; r.x += (x - r.x) * k; r.y += (y - r.y) * k; r.z += (z - r.z) * k; };
    const fall = (t0, t1) => {
      const u = clamp((t - t0) / (t1 - t0), 0, 1);
      if (u >= 1 && !this.landed) { this.landed = true; say('thud', this.vp, this.type === 'brute'); if (this.type === 'brute') this._shakeLocal(ctx, 0.35, 12); }
      return u < 1 ? u * u : 1 - Math.exp(-(t - t1) * 9) * Math.sin((t - t1) * 22) * 0.05;
    };
    const limpLegs = (kn) => { for (const L of ['L', 'R']) { R('thigh' + L, -0.15, 0, 0); R('shin' + L, kn, 0, 0); R('foot' + L, 0.4, 0, 0); } };
    let e;
    switch (kind) {
      case 'back':
        e = fall(0.12, 0.85);
        this.rootPitch = -e * 1.5;
        this.rootY = e * 0.13;
        limpLegs(t < 0.4 ? 0.7 : 0.2);
        R('spine', -0.15, 0, 0); R('chest', -0.1, 0, 0); R('neck', -0.2, 0, 0); R('head', -0.35, e * side * 0.7, 0);
        R('upperArmL', -2.3 * e, 0, 0.5); R('upperArmR', -2.1 * e, 0, -0.6); R('forearmL', -0.3, 0, 0); R('forearmR', -0.5, 0, 0);
        break;
      case 'front':
        e = fall(0.08, 0.7);
        this.rootPitch = e * 1.48;
        this.rootY = e * 0.12;
        limpLegs(t < 0.35 ? 0.8 : 0.15);
        R('spine', 0.2, 0, 0); R('chest', 0.1, 0, 0); R('neck', 0, 0, 0); R('head', -0.2, side * 1.1 * e, 0);
        R('upperArmL', -0.5 + e * 0.4, 0, 0.35); R('upperArmR', -0.9 + e * 0.6, 0, -0.5); R('forearmL', -0.4, 0, 0); R('forearmR', -0.8, 0, 0);
        break;
      case 'kneel': { // 先跪下,再側倒
        const k1 = sstep(0, 0.45, t);
        const h = this.legT * 0.98 + 0.07;
        b.hips.position.y += ((this.hipY - (this.hipY - h) * k1) - b.hips.position.y) * sm;
        for (const L of ['L', 'R']) { R('thigh' + L, -0.1 * k1, 0, 0); R('shin' + L, 1.5 * k1, 0, 0); R('foot' + L, 0.5 * k1, 0, 0); }
        R('spine', 0.35, 0, 0); R('chest', 0.2, 0, 0); R('head', 0.3, 0, side * 0.3);
        R('upperArmL', 0.1, 0, 0.1); R('upperArmR', 0.1, 0, -0.1); R('forearmL', -0.2, 0, 0); R('forearmR', -0.2, 0, 0);
        e = fall(0.6, 1.3);
        this.rootRoll = side * e * 1.42;
        this.rootY = e * 0.16 * this.V.P.s;
        break;
      }
      case 'flat':
        b.hips.position.y += (0.11 * this.V.P.s - b.hips.position.y) * sm;
        R('spine', 0.05, 0, 0); R('chest', 0.08, 0, 0); R('neck', -0.1, 0, 0); R('head', 0.1, side * 1.0, 0);
        R('upperArmL', -2.4, 0, 0.6); R('upperArmR', -1.8, 0, -0.5); R('forearmL', -0.3, 0, 0); R('forearmR', -0.6, 0, 0);
        if (t > 0.4 && !this.landed) { this.landed = true; say('thud', this.vp, false); }
        break;
      case 'burst': { // 膨脹 → 爆開 → 往後倒
        if (t < 0.5) {
          const k = t / 0.5;
          b.belly.scale.setScalar(1 + k * 0.7 + Math.sin(t * 60) * 0.04 * k);
          R('upperArmL', -0.4, 0, 0.9); R('upperArmR', -0.4, 0, -0.9); R('head', -0.5, 0, 0);
          b.jaw.rotation.x = 0.9 * k;
          this.rootY = 0;
        } else {
          if (!this.exploded) { this.exploded = true; ctx.game.explode(this); }
          b.belly.scale.setScalar(Math.max(0.55, b.belly.scale.x - dt * 6));
          e = fall(0.55, 1.15);
          this.rootPitch = -e * 1.5;
          this.rootY = e * 0.2;
          limpLegs(0.3);
          R('upperArmL', -2.0 * e, 0, 0.7); R('upperArmR', -2.2 * e, 0, -0.7);
        }
        break;
      }
    }
    if (this.corpse !== undefined && this.corpse < 1.5) this.rootY -= (1.5 - this.corpse) * 0.3;
    this._applyRoot();
  }

  dispose() {
    this.scene.remove(this.root);
    this.bar.tex.dispose();
    this.bar.sprite.material.dispose();
  }
}
