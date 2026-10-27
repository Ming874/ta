import * as THREE from 'three';

// ===== 畫質管理 → game.quality =====
// 預設檔 low / medium / high / ultra(首次自動依 GPU 挑選,之後記在 localStorage)。
//   game.quality.setPreset('high')          切換預設檔(清掉個別覆寫)
//   game.quality.set('bloom', false)        個別覆寫一個值
//   game.quality.get('lights')              讀值(光源池數量建議、粒子上限…)
//   const off = game.quality.on('change', (keys, q) => { if (keys.has('lights')) … })   回傳取消訂閱函式
//   game.quality.presets → [{ id, label }];game.quality.preset → 目前預設檔;game.quality.stats → 幀時間統計
// 由這裡直接套用:陰影開關/類型/解析度倍率、Bloom、MSAA、貼圖異向過濾、動態解析度(pixelRatio 0.6~1.5)。
// 其他系統自行讀取的建議值:lights(光源池 PointLight 數)、shadowLights(可投影的光源數)、particles(粒子上限)、
//   fog('low'|'medium'|'high' 霧/體積光品質)、decals(貼花密度 0..1)、drawDistance(公尺)。

export const PRESETS = {
  low: { label: '低', shadows: false, shadowType: 'basic', shadowScale: 0.5, shadowLights: 0, bloom: false, msaa: 0, pixelMin: 0.6, pixelMax: 0.85, lights: 4, particles: 100, fog: 'low', decals: 0.4, anisotropy: 2, drawDistance: 70 },
  medium: { label: '中', shadows: true, shadowType: 'pcf', shadowScale: 0.5, shadowLights: 1, bloom: true, msaa: 2, pixelMin: 0.6, pixelMax: 1.0, lights: 6, particles: 160, fog: 'medium', decals: 0.7, anisotropy: 4, drawDistance: 90 },
  high: { label: '高', shadows: true, shadowType: 'pcf', shadowScale: 1, shadowLights: 2, bloom: true, msaa: 4, pixelMin: 0.7, pixelMax: 1.25, lights: 8, particles: 240, fog: 'high', decals: 1, anisotropy: 8, drawDistance: 120 },
  ultra: { label: '極致', shadows: true, shadowType: 'pcf', shadowScale: 2, shadowLights: 4, bloom: true, msaa: 4, pixelMin: 0.85, pixelMax: 1.5, lights: 12, particles: 400, fog: 'high', decals: 1, anisotropy: 16, drawDistance: 150 },
};
const COMMON = { dynamicRes: true, targetFps: 60 };
const KEY = 'hz.quality.v1';
const SHADOW_TYPES = { basic: THREE.BasicShadowMap, pcf: THREE.PCFShadowMap, vsm: THREE.VSMShadowMap };
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const now = () => performance.now();

function load() { try { return JSON.parse(localStorage.getItem(KEY)) || null; } catch { return null; } }
function save(d) { try { localStorage.setItem(KEY, JSON.stringify(d)); } catch { /* 隱私模式 */ } }

// 依 GPU 字串粗估(只挑 low/medium/high;ultra 讓玩家自己開)
export function detectPreset(gl) {
  let s = '';
  try {
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    s = String(gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER) || '').toLowerCase();
  } catch { /* 拿不到就用其他線索 */ }
  const nav = navigator, mobile = /android|iphone|ipad|mobile/i.test(nav.userAgent || '');
  if (/swiftshader|llvmpipe|software|basic render|microsoft basic/.test(s)) return { preset: 'low', gpu: s };
  if (mobile) return { preset: 'low', gpu: s };
  if (/rtx|gtx 1[06-9]|gtx 16|radeon rx|rx [5-9]\d{2,3}|arc a[57]|apple m[1-9] (pro|max|ultra)|apple m[2-9]/.test(s)) return { preset: 'high', gpu: s };
  if (/intel|uhd|iris|mali|adreno|apple gpu|vega [3-8]\b|radeon\(tm\) graphics|mx\d{3}/.test(s)) return { preset: 'medium', gpu: s };
  if (/nvidia|geforce|radeon|amd/.test(s)) return { preset: 'high', gpu: s };
  return { preset: (nav.hardwareConcurrency || 4) >= 8 && (nav.deviceMemory || 8) >= 8 ? 'high' : 'medium', gpu: s };
}

// GPU 計時:EXT_disjoint_timer_query_webgl2(沒有時 gpuMs = null)
class GpuTimer {
  constructor(gl) {
    this.gl = gl;
    this.ext = gl.getExtension && gl.getExtension('EXT_disjoint_timer_query_webgl2');
    this.free = [];
    this.wait = [];
    this.active = null;
    this.ms = null;
  }
  begin() {
    if (!this.ext || this.active) return;
    const q = this.free.pop() || this.gl.createQuery();
    this.gl.beginQuery(this.ext.TIME_ELAPSED_EXT, q);
    this.active = q;
  }
  end() {
    if (!this.active) return;
    this.gl.endQuery(this.ext.TIME_ELAPSED_EXT);
    this.wait.push(this.active);
    this.active = null;
    this.poll();
  }
  poll() {
    const gl = this.gl;
    const disjoint = gl.getParameter(this.ext.GPU_DISJOINT_EXT);
    while (this.wait.length) {
      const q = this.wait[0];
      if (!gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) break;
      const ns = gl.getQueryParameter(q, gl.QUERY_RESULT);
      this.free.push(this.wait.shift());
      if (!disjoint && ns > 0) this.ms = ns / 1e6;
    }
    while (this.wait.length > 8) this.free.push(this.wait.shift()); // GPU 落後太多就丟掉舊的
  }
}

// 固定長度的幀時間統計
class Ring {
  constructor(n = 240) { this.a = new Float32Array(n); this.n = 0; this.i = 0; }
  push(v) { this.a[this.i] = v; this.i = (this.i + 1) % this.a.length; if (this.n < this.a.length) this.n++; }
  last(k = 1) { return this.a[(this.i - k + this.a.length * 2) % this.a.length]; }
  avg(k = this.n) { k = Math.min(k, this.n); let s = 0; for (let j = 1; j <= k; j++) s += this.last(j); return k ? s / k : 0; }
  max(k = this.n) { k = Math.min(k, this.n); let m = 0; for (let j = 1; j <= k; j++) m = Math.max(m, this.last(j)); return m; }
  pct(p, k = this.n) {
    k = Math.min(k, this.n);
    if (!k) return 0;
    const t = []; for (let j = 1; j <= k; j++) t.push(this.last(j));
    t.sort((x, y) => x - y);
    return t[Math.min(k - 1, Math.floor(p * k))];
  }
}

export class Quality {
  constructor(game) {
    this.game = game;
    const gl = game.renderer.getContext();
    this.gpu = new GpuTimer(gl);
    this.detected = detectPreset(gl);
    const saved = load();
    this.preset = saved && PRESETS[saved.preset] ? saved.preset : this.detected.preset;
    this.over = (saved && saved.over) || {};
    this.listeners = new Set();
    this.frame = new Ring(240); // rAF 間隔
    this.cpu = new Ring(240); // update + render 的 JS 時間
    this.gpuMs = new Ring(240);
    this.dpr = window.devicePixelRatio || 1;
    this.scale = this.startScale();
    this.lastChange = now();
    this.upBlock = 4000; // 往上試探的冷卻(超載後加倍,最多 30 秒)
    this.overT = 0;
    this.applied = {};
    this.apply(true);
    window.addEventListener('resize', () => { this.dpr = window.devicePixelRatio || 1; this.setScale(Math.min(this.scale, this.maxScale()), true); });
  }

  get presets() { return Object.entries(PRESETS).map(([id, p]) => ({ id, label: p.label })); }
  get(key) { return key in this.over ? this.over[key] : key in PRESETS[this.preset] ? PRESETS[this.preset][key] : COMMON[key]; }
  get pixelRatio() { return this.scale; }
  on(ev, fn) { if (ev === 'change') { this.listeners.add(fn); return () => this.listeners.delete(fn); } return () => {}; }
  off(ev, fn) { this.listeners.delete(fn); }

  setPreset(name) {
    if (!PRESETS[name]) return false;
    const before = this.snapshot();
    this.preset = name;
    this.over = {};
    this.scale = this.startScale();
    this.commit(before);
    return true;
  }
  set(key, value) {
    const before = this.snapshot();
    if (value === undefined || value === null) delete this.over[key];
    else this.over[key] = value;
    this.commit(before);
  }
  snapshot() { const o = {}; for (const k of Object.keys({ ...PRESETS.high, ...COMMON })) o[k] = this.get(k); return o; }
  commit(before) {
    save({ preset: this.preset, over: this.over });
    const after = this.snapshot(), keys = new Set();
    for (const k in after) if (after[k] !== before[k]) keys.add(k);
    this.apply(false, keys);
    if (keys.size) for (const fn of this.listeners) { try { fn(keys, this); } catch (e) { console.error(e); } }
  }

  minScale() { return this.get('pixelMin'); }
  maxScale() { return Math.max(this.minScale(), Math.min(this.get('pixelMax'), Math.max(1, this.dpr) * (this.preset === 'ultra' ? 1.5 : 1))); }
  startScale() { return clamp(Math.min(this.dpr, this.get('pixelMax')), this.get('pixelMin'), this.maxScale()); }

  setScale(s, force = false) {
    s = clamp(Math.round(s * 20) / 20, this.minScale(), this.maxScale());
    if (!force && Math.abs(s - this.scale) < 0.01) return;
    this.scale = s;
    const g = this.game;
    g.renderer.setPixelRatio(s);
    if (g.composer) g.composer.setPixelRatio(s);
    this.lastChange = now();
  }

  // 套用到渲染器/後處理/場景;first = 第一次(在第一幀前,不用重編 shader)
  /** 所有投影光源下一幀重畫陰影圖(含 autoUpdate=false 的靜態陰影) */
  refreshShadows() {
    this.game.scene?.traverse((o) => { if (o.isLight && o.shadow && o.castShadow) o.shadow.needsUpdate = true; });
  }

  apply(first = false, keys = null) {
    const g = this.game, r = g.renderer, has = (k) => first || !keys || keys.has(k);
    if (has('shadows') || has('shadowType')) {
      const en = !!this.get('shadows'), type = SHADOW_TYPES[this.get('shadowType')] ?? THREE.PCFShadowMap;
      if (r.shadowMap.enabled !== en || r.shadowMap.type !== type) {
        r.shadowMap.enabled = en;
        r.shadowMap.type = type;
        r.shadowMap.needsUpdate = true;
        if (!first) this.recompile();
        this.refreshShadows(); // 靜態陰影(月光 autoUpdate=false)也要用新類型重畫,否則陰影圖格式和 shader 的 sampler 對不上
      }
    }
    if (has('shadowScale')) {
      const k = this.get('shadowScale');
      g.scene.traverse((o) => {
        if (!o.isLight || !o.shadow || !o.castShadow) return;
        const base = o.userData.baseShadowSize ?? (o.userData.baseShadowSize = o.shadow.mapSize.x);
        const s = clamp(Math.round(base * k), 128, 4096);
        if (o.shadow.mapSize.x !== s) {
          o.shadow.mapSize.set(s, s);
          if (o.shadow.map) { o.shadow.map.dispose(); o.shadow.map = null; }
          // 陰影圖丟掉後要標記重畫:autoUpdate=false 的靜態陰影(月光)不會自己重建,shader 會綁到格式不符的空貼圖,
          // 所有受光物體繪製失敗(GL_INVALID_OPERATION,畫面只剩自發光的燈具)
          o.shadow.needsUpdate = true;
        }
      });
    }
    if (has('bloom') && g.bloom) g.bloom.enabled = !!this.get('bloom');
    if (has('msaa') && g.composer) {
      const n = this.get('msaa');
      for (const rt of [g.composer.renderTarget1, g.composer.renderTarget2]) if (rt && rt.samples !== n) { rt.samples = n; rt.dispose(); }
    }
    if (has('anisotropy')) {
      const a = Math.min(this.get('anisotropy'), r.capabilities.getMaxAnisotropy());
      const seen = new Set();
      g.scene.traverse((o) => {
        for (const m of [].concat(o.material || [])) {
          for (const k of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'bumpMap', 'aoMap', 'emissiveMap', 'alphaMap']) {
            const t = m[k];
            if (!t || seen.has(t) || t.anisotropy === a || t.isRenderTargetTexture) continue;
            seen.add(t);
            t.anisotropy = a;
            if (t.image) t.needsUpdate = true;
          }
        }
      });
    }
    if (first || has('pixelMin') || has('pixelMax') || has('dynamicRes')) this.setScale(this.get('dynamicRes') ? this.scale : this.startScale(), true);
  }

  // 陰影開關變了:所有材質要重編(設定頁切換時會頓一下,屬正常)
  recompile() {
    this.game.scene.traverse((o) => { for (const m of [].concat(o.material || [])) m.needsUpdate = true; });
  }

  // ---- 每幀:由主迴圈呼叫 ----
  beginGpu() { this.gpu.begin(); }
  endGpu() { this.gpu.end(); }
  // frameMs = rAF 間隔,cpuMs = 本幀 update + render 的 JS 時間
  sample(frameMs, cpuMs) {
    this.frame.push(frameMs);
    this.cpu.push(cpuMs);
    if (this.gpu.ms != null) this.gpuMs.push(this.gpu.ms);
    if (this.get('dynamicRes')) this.control();
  }

  // 動態解析度:有 GPU 計時就看 GPU 時間;沒有就看幀間隔(並排除 CPU 瓶頸)。下修快、上修慢,並有冷卻避免抖動
  control() {
    const t = now(), budget = 1000 / this.get('targetFps');
    if (this.frame.n < 30 || t - this.lastChange < 700) return;
    const hasGpu = this.gpu.ms != null && this.gpuMs.n >= 20;
    const cpu = this.cpu.avg(30);
    const load = hasGpu ? this.gpuMs.avg(30) : this.frame.avg(30);
    const cpuBound = !hasGpu && cpu > budget * 0.8;
    const over = hasGpu ? load > budget * 0.92 : load > budget * 1.18 && !cpuBound;
    if (over) {
      if (!this.overT) this.overT = t;
      if (t - this.overT > 350 && this.scale > this.minScale()) {
        const f = clamp(Math.sqrt((budget * (hasGpu ? 0.8 : 0.95)) / load), 0.72, 0.95);
        this.setScale(this.scale * f);
        this.upBlock = Math.min(30000, this.upBlock * 2);
        this.overT = 0;
      }
      return;
    }
    this.overT = 0;
    if (this.scale >= this.maxScale() || t - this.lastChange < this.upBlock) return;
    const next = Math.min(this.maxScale(), this.scale + 0.05);
    const ok = hasGpu ? load * (next / this.scale) ** 2 < budget * 0.75 : this.frame.max(60) < budget * 1.3 && this.frame.avg(60) < budget * 1.06;
    if (ok) {
      this.setScale(next);
      this.upBlock = Math.max(4000, this.upBlock * 0.75);
    }
  }

  get stats() {
    const f = this.frame;
    const avg = f.avg(120) || 16.7;
    return {
      fps: 1000 / avg, frameMs: avg, frameP99: f.pct(0.99, 240), frameMax: f.max(240),
      cpuMs: this.cpu.avg(60), gpuMs: this.gpu.ext ? (this.gpuMs.n ? this.gpuMs.avg(60) : null) : null, gpuTimer: !!this.gpu.ext,
      pixelRatio: this.scale, width: this.game.renderer.domElement.width, height: this.game.renderer.domElement.height,
      preset: this.preset, dynamicRes: !!this.get('dynamicRes'),
    };
  }
}
