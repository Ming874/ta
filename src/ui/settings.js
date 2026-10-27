import * as audio from '../audio.js';

const sfx = audio.sfx;

// 玩家設定:存在 localStorage,套用到遊戲(靈敏度、音量、畫質、FOV)。
// 畫質優先交給效能模組 game.quality(setPreset/get/set/on,可能不存在);不存在時直接調整 renderer。
const KEY = 'shh.settings.v1';
export const DEFAULTS = {
  sens: 1, // 滑鼠靈敏度倍率
  invertY: false,
  master: 0.9, music: 0.7, sfx: 0.9, // 音量 0..1
  preset: 'high', // low | medium | high | ultra
  shadows: true,
  resScale: 1, // 解析度比例 0.5..1
  fogLights: 'high', // 霧與燈光品質 low | medium | high
  fov: 75,
  hurtFx: true, // 受傷畫面效果(暈影/方向指示)
};
export const PRESETS = {
  low: { shadows: false, resScale: 0.6, fogLights: 'low' },
  medium: { shadows: true, resScale: 0.8, fogLights: 'medium' },
  high: { shadows: true, resScale: 1, fogLights: 'high' },
  ultra: { shadows: true, resScale: 1, fogLights: 'high' },
};

function load() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) || '{}');
    return { ...DEFAULTS, ...(s && typeof s === 'object' ? s : {}) };
  } catch { return { ...DEFAULTS }; }
}

const S = load();
const subs = new Set();
let game = null;

export const settings = {
  get: (k) => S[k],
  all: () => ({ ...S }),
  set(k, v) {
    if (S[k] === v) return;
    S[k] = v;
    if (k === 'preset' && PRESETS[v]) Object.assign(S, PRESETS[v]);
    try { localStorage.setItem(KEY, JSON.stringify(S)); } catch { /* 隱私模式等 */ }
    if (game) apply(game, k);
    for (const f of subs) f(k, v);
  },
  reset() {
    Object.assign(S, DEFAULTS);
    try { localStorage.removeItem(KEY); } catch { /* 略過 */ }
    if (game) apply(game);
    for (const f of subs) f(null);
  },
  on(fn) { subs.add(fn); return () => subs.delete(fn); },
  // 由遊戲在建立後呼叫一次;之後每次 set 都會自動套用
  attach(g) { game = g; apply(g); },
  apply: () => game && apply(game),
};

// 音量:有 sfx.setVolume 就用;否則直接調整混音匯流排(記住原本的預設增益)
function applyVolume() {
  if (typeof sfx.setVolume === 'function') {
    sfx.setVolume('master', S.master);
    sfx.setVolume('music', S.music);
    sfx.setVolume('sfx', S.sfx);
    return;
  }
  const A = audio._internal?.A; // 音效模組若移除 _internal 也不會出錯
  if (!A?.ctx) return; // AudioContext 尚未建立(使用者互動後才有),開始遊戲時會再套用一次
  const set = (node, k) => {
    if (!node?.gain) return;
    node._def ??= node.gain.value;
    node.gain.setTargetAtTime(node._def * k, A.ctx.currentTime, 0.05);
  };
  set(A.master, S.master / 0.9);
  set(A.bus?.music, S.music);
  set(A.bus?.amb, S.music);
  set(A.bus?.sfx, S.sfx);
  set(A.bus?.voice, S.sfx);
  set(A.bus?.ui, S.sfx);
}

function applyQuality(g) {
  const q = g.quality;
  if (q) { // 效能模組接手
    q.setPreset?.(S.preset);
    q.set?.('shadows', S.shadows);
    q.set?.('resScale', S.resScale);
    q.set?.('fogLights', S.fogLights);
    return;
  }
  const r = g.renderer;
  if (!r) return;
  if (r.shadowMap.enabled !== S.shadows) {
    r.shadowMap.enabled = S.shadows;
    if (g.player?.flashlight) g.player.flashlight.castShadow = S.shadows;
  }
  const pr = Math.min(window.devicePixelRatio || 1, 1.5) * S.resScale;
  if (Math.abs(r.getPixelRatio() - pr) > 1e-3) {
    r.setPixelRatio(pr);
    g.composer?.setPixelRatio?.(pr);
    g.resize?.();
  }
  g.hospital?.setQuality?.(S.fogLights);
}

function applyLook(g) {
  const p = g.player;
  if (!p) return;
  if (!p._lookBase) { // 包一層:靈敏度與反轉 Y(不動 player.sensMul,那是開鏡用的)
    p._lookBase = p.look.bind(p);
    p.look = (dx, dy) => p._lookBase(dx * S.sens, dy * S.sens * (S.invertY ? -1 : 1));
  }
  g.baseFov = S.fov; // 武器開鏡請以 game.baseFov 為基準
  if (g.camera && !(g.weapons?.ads > 0.01)) {
    g.camera.fov = S.fov;
    g.camera.updateProjectionMatrix();
  }
}

function apply(g, k = null) {
  if (!k || k === 'sens' || k === 'invertY' || k === 'fov') applyLook(g);
  if (!k || k === 'master' || k === 'music' || k === 'sfx') applyVolume();
  if (!k || ['preset', 'shadows', 'resScale', 'fogLights'].includes(k)) applyQuality(g);
}
