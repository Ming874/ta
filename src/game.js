import * as THREE from 'three';

import { World } from './map/collision.js';
import { buildHospital } from './map/hospital.js';
import { Player } from './player.js';
import { WeaponSystem } from './weapons/weapon.js';
import { prewarm } from './zombies/model.js';
import { Hazards } from './zombies/hazards.js';
import { Coins } from './coins.js';
import { UI } from './ui.js';
import { sfx } from './audio.js';
import { setupPost } from './game/post.js';
import { fxMethods } from './game/fx.js';
import { combatMethods } from './game/combat.js';
import { flowMethods } from './game/flow.js';
import { inputMethods } from './game/input.js';

// 遊戲主體:建立渲染器/場景/各系統,並跑主迴圈。
// 細節分在 src/game/*:fx(粒子/血池)、combat(射擊/傷害/爆炸)、flow(回合/出怪/商店/死亡)、input(輸入)、post(後處理)
export class Game {
  constructor(canvas) {
    this.canvas = canvas;
    this.ui = new UI();
    this.state = 'menu'; // menu | playing | dead
    this.phase = 'fighting'; // fighting | collecting | break | shop
    this.time = 0;
    this.shopUIOpen = false;
    this.input = { fireHeld: false, firePressed: false };
    this.look = { x: 0, y: 0 };
    this.net = null; // 連線層(多人模式時由 src/net 設定)

    // ---- 渲染器 ----
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;
    this.renderer = renderer;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x050606);
    this.scene.fog = new THREE.FogExp2(0x0a0d0c, 0.022);
    this.camera = new THREE.PerspectiveCamera(75, 1, 0.05, 120);
    this.scene.add(this.camera);

    // 手持武器獨立一層,避免穿牆
    this.weaponScene = new THREE.Scene();
    this.weaponCamera = new THREE.PerspectiveCamera(52, 1, 0.01, 5);
    this.weaponScene.add(new THREE.HemisphereLight(0xc4d0cc, 0x3a342d, 2.4));
    const key = new THREE.DirectionalLight(0xfff0dc, 2.6);
    key.position.set(-1.5, 2.5, 1.2);
    this.weaponScene.add(key);
    this.weaponLight = new THREE.PointLight(0xffa850, 0, 3, 2);
    this.weaponScene.add(this.weaponLight);

    // ---- 世界 ----
    this.world = new World();
    this.hospital = buildHospital(this.world, this.world.layout, this.scene);
    this.scene.add(this.hospital.group);
    this.world.buildNav();

    this.player = new Player(this.camera, this.world);
    this.players = [this.player]; // 多人時會加入遠端玩家(殭屍追最近的)
    this.weapons = new WeaponSystem(this.weaponScene);
    this.weapons.onFire = (def, id, speed) => this.fire(def, id, speed);
    this.coins = new Coins(this.scene);
    this.coins.onGain = (n) => {
      this.player.coins += n;
      this.ui.setCoins(this.player.coins);
      this.ui.coinGain(n);
    };
    this.zombies = [];
    this.queue = [];
    this.hazards = new Hazards(this.scene);
    this.zctx = { player: this.player, players: this.players, world: this.world, zombies: this.zombies, hazards: this.hazards, game: this };
    this.shop = null;

    // 槍口閃光燈(照亮環境)
    this.muzzleLight = new THREE.PointLight(0xffa850, 0, 14, 2);
    this.scene.add(this.muzzleLight);

    this.ray = new THREE.Raycaster();
    this.makeParticles();
    setupPost(this);

    window.addEventListener('resize', () => this.resize());
    this.resize();

    this.resetRun();
    this.setMood('menu');
    this.ui.setHP(this.player.hp, this.player.maxHp);
    this.updateAmmoHud();
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.weaponCamera.aspect = w / h;
    this.weaponCamera.updateProjectionMatrix();
    this.post.uniforms.aspect.value = w / h;
  }

  // 導航場的目標:所有活著且未倒地的玩家
  flowTargets() {
    return this.players.filter((p) => p.alive !== false && !p.downed).map((p) => p.pos);
  }

  // ---------- 主更新 ----------
  update(dt) {
    this.time += dt;
    this.hospital.update(this.time, dt, this.player);
    this.post.uniforms.time.value = this.time % 100;
    this.updateParticles(dt);
    this.updateCombat(dt); // 武器:開鏡視野、準心/狙擊鏡、手榴彈、彈殼與彈孔等特效(src/game/combat.js)

    if (this.state !== 'playing') {
      // 選單/死亡:鏡頭保持,只更新場景動畫;順便預先建好殭屍模型
      this.coins.update(dt, this.player);
      prewarm();
      return;
    }

    const paused = this.paused || this.shopUIOpen;
    if (paused) return;

    const p = this.player;
    p.update(dt, true);
    const targets = this.flowTargets();
    if (targets.length) this.world.updateFlow(targets);
    sfx.listener(p.pos.x, p.pos.y + 1.65, p.pos.z, p.yaw);
    sfx.setHealth(p.hp / p.maxHp);

    if (this.phase !== 'fighting') prewarm(); // 回合間的空檔繼續預建殭屍模型
    const w = this.weapons;
    w.update(dt, this.input, p.speedNorm, p.sprinting, this.look);
    this.updateAmmoHud();

    // 殭屍生成
    if (this.phase === 'fighting') {
      const alive = this.zombies.filter((z) => z.alive).length;
      this.spawnTimer -= dt;
      if (this.toSpawn > 0 && alive < this.maxAlive && this.spawnTimer <= 0) {
        this.spawnZombie();
        this.spawnTimer = Math.max(0.6, 1.8 - this.round * 0.08);
      }
    }

    // 殭屍更新(傷害套用到牠攻擊的那位玩家)
    for (let i = this.zombies.length - 1; i >= 0; i--) {
      const z = this.zombies[i];
      const dmg = z.update(dt, this.zctx);
      if (dmg > 0) {
        this.damagePlayer(z.target || p, dmg, z.pos);
        if (this.state !== 'playing') return;
      }
      if (!z.alive) {
        z.corpse -= dt;
        if (z.corpse <= 0) { z.dispose(); this.zombies.splice(i, 1); }
      }
    }

    const hz = this.hazards.update(dt, p, this.world);
    if (hz > 0) {
      this.damagePlayer(p, hz, null);
      if (this.state !== 'playing') return;
    }

    // 配樂氣氛:最近的殭屍越近越緊張;巨屍在場時切換 boss 配樂
    let near = 99, boss = false;
    for (const z of this.zombies) if (z.alive) { near = Math.min(near, z.dist); boss ||= z.type === 'brute'; }
    sfx.setTension(Math.max(0, Math.min(1, 1 - (near - 1.5) / 12)));
    if (this.phase === 'fighting') this.setMood(boss ? 'boss' : 'fight');

    this.coins.update(dt, p);
    this.ui.setZombies(this.phase === 'fighting' ? this.zombiesLeft() : 0);

    // 回合狀態
    if (this.phase === 'fighting' && this.toSpawn === 0 && !this.zombies.some((z) => z.alive)) this.endRound();
    if (this.phase === 'break') {
      this.breakTimer -= dt;
      this.ui.prompt(`下一回合 ${Math.ceil(this.breakTimer)} 秒後開始(按 N 立即開始)`);
      if (this.breakTimer <= 0) this.nextRound();
    }
    if (this.phase === 'shop' && this.shop) {
      this.shop.update(dt, this.time);
      this.ui.prompt(this.shop.near(p) ? '按 E 開啟商店 · 按 N 開始下一回合' : '前往補給站購買武器 · 按 N 開始下一回合');
    }
    if (this.phase === 'collecting') this.ui.prompt(null);

    // 低血量心跳暗角
    this.post.uniforms.hurt.value = p.hp < 35 ? (1 - p.hp / 35) * 0.7 + Math.sin(this.time * 6) * 0.1 : Math.max(0, 1 - (this.time - p.lastHurt) * 2) * 0.5;
  }

  render() {
    this.composer.render();
  }
}

Object.assign(Game.prototype, fxMethods, combatMethods, flowMethods, inputMethods);
