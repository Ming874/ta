import * as THREE from 'three';
import { OCC } from './wet.js';

// 雨的遮蔽高度圖(俯視深度烘焙):
//  從地圖正上方用正交相機把「不透明」的場景畫成深度(RGBA 打包),非同步讀回 CPU 解碼成每格的「雨停高度」,
//  再上傳成 R32F 貼圖給所有雨/濕地著色器共用(OCC.uOcc)。每格 12.5cm:屋頂、雨棚、遮陽篷、車頂、長椅都擋得住雨,
//  車底與屋簷下是乾的,濺水落在道具頂面。
//  - 烘焙前(或失敗時)用地圖格子的雨停高度(2m 一格,weather.js buildMasks)當備援
//  - 下載的模型晚一點才進場景 → 資源佇列有進度時節流重烘(只多一次俯視繪製 + 非同步讀回,不卡主執行緒)
//  - CPU 副本:heightAt / exposed(音效的室內外程度、屋簷滴水位置)

const N = 1024; // 貼圖邊長(texel)
export class RainOcclusion {
  constructor(game, L, masks) {
    this.game = game;
    this.L = L;
    this.masks = masks;
    const w = L.W * L.CELL, h = L.H * L.CELL;
    this.S = Math.max(w, h) + 8; // 覆蓋範圍(公尺,正方形)
    this.cx = w / 2; this.cz = h / 2;
    this.x0 = this.cx - this.S / 2; this.z1 = this.cz + this.S / 2;
    const top = L.levels[L.levels.length - 1];
    this.Y0 = top.y + L.LEVEL_H + 16; // 相機高度
    this.near = 0.1;
    this.far = this.Y0 - (L.levels[0].y - 4);
    this.N = N;
    this.cpu = null; // Float32Array(N*N):列 0 = z1(北緣在上,與 GL 讀回順序一致)
    this.tex = null;
    this.bakes = 0;
    this.busy = false;
    this.lastBake = -1e9;
    this.lastDone = -1;
    this.onBake = null; // 烘焙完成的回呼(屋簷滴水重新取點)
    // 備援:格子遮罩
    OCC.uOcc.value = masks.rainTex;
    OCC.uOccXf.value.copy(masks.xf);
    OCC.uOccOn.value = 1;
    this.mat = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, side: THREE.DoubleSide });
    this.cam = new THREE.OrthographicCamera(-this.S / 2, this.S / 2, this.S / 2, -this.S / 2, this.near, this.far);
    this.cam.up.set(0, 0, -1); // 影像上方 = 北(-z),右方 = +x
    this.cam.position.set(this.cx, this.Y0, this.cz);
    this.cam.lookAt(this.cx, 0, this.cz);
    this.cam.updateMatrixWorld(true);
    this.cam.layers.enableAll();
    this.rt = new THREE.WebGLRenderTarget(N, N, { type: THREE.UnsignedByteType, format: THREE.RGBAFormat, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: true, generateMipmaps: false });
    this.buf = new Uint8Array(N * N * 4);
  }

  // 不參與遮雨:半透明/鏤空(玻璃、樹葉、貼花、光暈)、自訂著色器(天空、霧片、光柱)、蒙皮(殭屍)、點線精靈
  static skip(o) {
    if (o.isPoints || o.isLine || o.isSprite || o.isSkinnedMesh) return true;
    if (!o.isMesh) return false;
    const ms = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of ms) if (!m || m.transparent || m.alphaTest > 0 || m.isShaderMaterial || m.isRawShaderMaterial || m.visible === false || m.colorWrite === false) return true;
    return false;
  }

  bake(hide = []) {
    const g = this.game, r = g.renderer, scene = g.scene, H = g.hospital;
    if (!r || !scene || this.busy) return false;
    const t0 = performance.now();
    const forced = [], hid = [];
    // 依玩家位置隱藏的樓層/道具/距離剔除區塊全部打開
    for (const list of [H?.levelGroups, H?.propGroups, H?.chunks]) if (list) for (const o of list) if (!o.visible) { o.visible = true; forced.push(o); }
    for (const o of hide) if (o && o.visible) { o.visible = false; hid.push(o); }
    if (g.camera && g.camera.visible) { g.camera.visible = false; hid.push(g.camera); }
    scene.traverseVisible((o) => { if (RainOcclusion.skip(o)) { o.visible = false; hid.push(o); } });
    const prevRT = r.getRenderTarget(), prevOv = scene.overrideMaterial, prevBg = scene.background, prevFog = scene.fog;
    const sm = r.shadowMap, prevAU = sm.autoUpdate, prevNU = sm.needsUpdate;
    const cc = r.getClearColor(new THREE.Color()), ca = r.getClearAlpha(), prevAC = r.autoClear;
    const prevSort = r.sortObjects;
    try {
      sm.autoUpdate = false; sm.needsUpdate = false; // 不要順便重畫陰影圖
      scene.overrideMaterial = this.mat;
      scene.background = null; scene.fog = null;
      r.sortObjects = false;
      r.setRenderTarget(this.rt);
      r.setClearColor(0xffffff, 1);
      r.autoClear = true;
      r.clear(true, true, false);
      r.render(scene, this.cam);
    } finally {
      r.setRenderTarget(prevRT);
      scene.overrideMaterial = prevOv; scene.background = prevBg; scene.fog = prevFog;
      sm.autoUpdate = prevAU; sm.needsUpdate = prevNU;
      r.setClearColor(cc, ca); r.autoClear = prevAC; r.sortObjects = prevSort;
      for (const o of hid) o.visible = true;
      for (const o of forced) o.visible = false;
    }
    this.renderMs = performance.now() - t0;
    this.busy = true;
    const done = (ok) => { this.busy = false; if (ok) { this.decode(); this.bakes++; this.onBake?.(this); } };
    try {
      if (r.readRenderTargetPixelsAsync) r.readRenderTargetPixelsAsync(this.rt, 0, 0, N, N, this.buf).then(() => done(true), (e) => { console.warn('[weather] 遮雨圖讀回失敗', e); done(false); });
      else { r.readRenderTargetPixels(this.rt, 0, 0, N, N, this.buf); done(true); }
    } catch (e) { console.warn('[weather] 遮雨圖讀回失敗', e); done(false); }
    return true;
  }

  // RGBA8 打包深度(three packDepthToRGBA)→ 世界高度;沒畫到東西的地方用格子遮罩的高度
  decode() {
    const t0 = performance.now();
    const b = this.buf, n = N * N, out = this.cpu || (this.cpu = new Float32Array(n));
    const span = this.far - this.near, k = 1 / 16777216, cell = this.S / N;
    const L = this.L, m = this.masks, MW = m.W;
    const top = L.levels.length - 1, topY = L.levels[top].y;
    for (let j = 0; j < N; j++) {
      const z = this.z1 - (j + 0.5) * cell; // GL 讀回:列 0 在底部 → 對應 uv.v = 0 → z = z1
      const r = Math.floor(z / L.CELL);
      for (let i = 0; i < N; i++) {
        const q = (j * N + i) * 4;
        const d = (b[q] * 65536 + b[q + 1] * 256 + b[q + 2] + b[q + 3] / 255) * k;
        const x = this.x0 + (i + 0.5) * cell, c = Math.floor(x / L.CELL);
        let y;
        if (d > 0.9999) y = m.rain[(Math.min(m.H - 1, Math.max(0, r + 1))) * MW + Math.min(MW - 1, Math.max(0, c + 1))];
        else y = this.Y0 - (this.near + d * span);
        // 頂層挑空('o',建築內)= 玻璃天窗:雨停在屋頂面
        if (c >= 0 && r >= 0 && c < L.W && r < L.H && L.charAt(top, c, r) === 'o' && L.inBuilding(c, r)) y = Math.max(y, topY + 0.05);
        out[j * N + i] = y;
      }
    }
    if (!this.tex) {
      this.tex = new THREE.DataTexture(out, N, N, THREE.RedFormat, THREE.FloatType);
      this.tex.minFilter = this.tex.magFilter = THREE.NearestFilter;
      this.tex.generateMipmaps = false;
    }
    this.tex.needsUpdate = true;
    // uv = ( (x - x0) / S, (z1 - z) / S )
    OCC.uOcc.value = this.tex;
    OCC.uOccXf.value.set(1 / this.S, -1 / this.S, -this.x0 / this.S, this.z1 / this.S);
    OCC.uOccOn.value = 1;
    this.decodeMs = performance.now() - t0;
  }

  // 世界座標 (x,z) 的雨停高度(CPU;烘焙前用格子遮罩)
  heightAt(x, z) {
    if (this.cpu) {
      const i = Math.floor(((x - this.x0) / this.S) * N), j = Math.floor(((this.z1 - z) / this.S) * N);
      if (i >= 0 && j >= 0 && i < N && j < N) return this.cpu[j * N + i];
    }
    const m = this.masks, c = Math.floor(x / this.L.CELL) + 1, r = Math.floor(z / this.L.CELL) + 1;
    return m.rain[Math.min(m.H - 1, Math.max(0, r)) * m.W + Math.min(m.W - 1, Math.max(0, c))];
  }
  exposed(x, y, z) { return y + 0.05 >= this.heightAt(x, z); }

  // 屋簷/雨棚/車頂邊緣的滴水點:相鄰 texel 高度落差 0.5~5m(大樓屋頂邊緣落差更大,少量保留當排水口)
  edges(max = 600, seed = 1) {
    const cpu = this.cpu;
    if (!cpu) return [];
    const cell = this.S / N, st = 2, out = [], taken = new Set();
    let s = seed >>> 0;
    const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
    const cand = [];
    for (let j = st; j < N - st; j += st) for (let i = st; i < N - st; i += st) {
      const y = cpu[j * N + i];
      if (y < -20) continue;
      for (const [di, dj] of [[st, 0], [-st, 0], [0, st], [0, -st]]) {
        const yn = cpu[(j + dj) * N + i + di];
        const dh = y - yn;
        if (dh < 0.5 || yn < -20) continue;
        // 邊緣再往外一格也要是低處(排除細欄杆)
        const yn2 = cpu[(j + dj * 2) * N + i + di * 2];
        if (y - yn2 < 0.4) continue;
        const w = dh < 5 ? 1 : 0.06;
        cand.push(i, j, di, dj, y, yn, w);
        break;
      }
    }
    // 依權重抽樣,0.35m 內不重複
    const nC = cand.length / 7;
    for (let tries = 0; tries < nC * 3 && out.length < max; tries++) {
      const k = Math.floor(rnd() * nC) * 7;
      if (rnd() > cand[k + 6]) continue;
      const i = cand[k], j = cand[k + 1], di = cand[k + 2], dj = cand[k + 3];
      const x = this.x0 + (i + 0.5 + di * 0.3) * cell, z = this.z1 - (j + 0.5 + dj * 0.3) * cell;
      const key = Math.floor(x / 0.35) + ',' + Math.floor(z / 0.35);
      if (taken.has(key)) continue;
      taken.add(key);
      out.push({ x, z, y: cand[k + 4], land: cand[k + 5] });
    }
    return out;
  }

  // 資源佇列(下載的模型)有新進度時節流重烘;都載完後再烘最後一次
  maybeRebake(t, assets, hide) {
    if (this.busy) return;
    const p = assets ? assets.progress : null;
    const done = p ? p.done + p.failed : 0;
    const idle = assets ? assets.idle : true;
    if (done !== this.lastDone && t - this.lastBake > (idle ? 1.5 : 8)) {
      this.lastDone = done;
      this.lastBake = t;
      this.bake(hide);
    }
  }

  dispose() {
    this.rt.dispose();
    this.mat.dispose();
    this.tex?.dispose();
    this.cpu = null;
  }
}
