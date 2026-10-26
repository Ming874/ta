// 以 WebAudio 即時合成所有音效與配樂(不需任何音檔)
// 架構:audio/core(混音、殘響、3D)、audio/foley(槍枝與動作擬音)、audio/voices(殭屍語音合成)、audio/music(配樂與環境)
import { A, ensure, setListener, attach } from './audio/core.js';
import { foley } from './audio/foley.js';
import { voices } from './audio/voices.js';
import { startMusic, setMood, autoMood, setTension, setHealth, addPain } from './audio/music.js';

// AudioContext 只在使用者互動後(resume)建立;在那之前所有 sfx.* 都不做事
export function resume() {
  const c = ensure();
  if (c && c.state === 'suspended') c.resume();
}

// 包一層:沒有 context 時直接略過,任何合成錯誤也不往外丟
const safe = (fn) => (...args) => {
  if (!A.ctx) return;
  try { fn(...args); } catch (e) { if (import.meta.env?.DEV) console.warn('[audio]', e); }
};

export const sfx = {
  // ---- 武器 / 玩家 / 介面 ----
  shot: safe((id) => foley.shot(id)),
  dry: safe(() => foley.dry()),
  reload: safe((id) => foley.reload(id)),
  switch: safe(() => foley.switch()),
  step: safe((sprint = false) => foley.step(sprint)),
  hurt: safe(() => { foley.hurt(); addPain(0.5); }),
  knock: safe(() => { foley.knock(); addPain(0.7); }),
  hit: safe(() => foley.hit()),
  headshot: safe(() => foley.headshot()),
  wall: safe(() => foley.wall()),
  coin: safe((i = 0) => foley.coin(i)),
  buy: safe(() => foley.buy()),
  deny: safe(() => foley.deny()),
  roundStart: safe(() => { foley.roundStart(); autoMood('fight'); }),
  roundEnd: safe(() => { foley.roundEnd(); autoMood('break'); }),

  // ---- 殭屍語音(3D) ----
  groan: safe((type, pos) => voices.groan(type, pos)),
  zAttack: safe((type, pos) => voices.attack(type, pos)),
  zPain: safe((type, pos) => voices.pain(type, pos)),
  zDie: safe((type, pos) => voices.die(type, pos)),
  shriek: safe((pos) => voices.shriek(pos)),
  roar: safe((pos) => voices.roar(pos)),
  gurgle: safe((pos) => voices.gurgle(pos)),
  crawl: safe((pos) => foley.crawl(pos)),

  // ---- 殭屍動作(3D) ----
  bite: safe((pos) => foley.bite(pos)),
  zStep: safe((type, pos) => foley.zStep(type, pos)),
  stomp: safe((pos) => foley.stomp(pos)),
  wallImpact: safe((pos) => foley.wallImpact(pos)),
  thud: safe((pos, heavy = false) => foley.thud(pos, heavy)),
  spit: safe((pos) => foley.spit(pos)),
  splash: safe((pos) => foley.splash(pos)),
  sizzle: safe((pos) => foley.sizzle(pos)),
  burst: safe((pos) => foley.burst(pos)),

  // ---- 聆聽者 / 配樂(context 未建立時也可呼叫,狀態會先記下) ----
  listener(x, y, z, yaw) { try { setListener(x, y, z, yaw); } catch { /* 忽略 */ } },
  setMood(mood) { setMood(mood); },
  setTension(x) { setTension(x); },
  setHealth(r) { setHealth(r); }, // 可選:玩家血量比例 0..1(低血量時出現心跳)
  ambient: safe(() => startMusic()),
};

// ---- 新增的音效介面(由音效模組逐步實作;在那之前是安全的空函式,其他系統可直接呼叫) ----
// pos 一律為 {x, y, z} 世界座標;surface 為 'tile'|'concrete'|'metal'|'wood'|'carpet'|'grass'|'gravel'|'asphalt'|'water'
const STUBS = [
  'adsIn', 'adsOut', 'grenadeThrow', 'grenadeBounce' /* (pos) */, 'explosion' /* (pos, size 0..1) */, 'knifeSwing', 'knifeHit' /* (pos, flesh) */,
  'pickupAmmo', 'pickupMed', 'pickupDeny', 'pickupItem', 'armorHit', 'armorEquip', 'heal', 'lowAmmo',
  'shopOpen', 'shopClose', 'shopTab', 'shopHover', 'upgrade', 'cashRegister', 'shutter' /* (pos, open) */,
  'door' /* (pos, kind 'creak'|'slam'|'metal') */, 'scare' /* (kind, pos) */, 'setZone' /* (zoneId, mood) */,
  'loopStart' /* (key, kind, pos) */, 'loopStop' /* (key) */, 'uiClick', 'uiHover', 'countdown' /* (n) */,
  'playerJoin', 'playerLeave', 'chat', 'revive', 'downed', 'killConfirm', 'remoteShot' /* (id, pos) */, 'remoteStep' /* (pos, surface) */,
];
for (const k of STUBS) if (!sfx[k]) sfx[k] = () => {};

// 除錯/測試用(OfflineAudioContext 量測)
export const _internal = { A, attach, foley, voices, startMusic };
