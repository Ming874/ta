// 音效與配樂:WebAudio 即時合成 + 錄音樣本(public/audio/,CC0 / CC-BY)。樣本缺少或載入失敗時一律退回合成版本。
// 架構:audio/core(混音、分區殘響、可重用的 3D 聲道條、遮蔽、發聲上限)、audio/samples + bank(樣本庫)、audio/foley(槍枝與動作擬音)、
//       audio/steps(9 種地面的腳步)、audio/voices(殭屍語音)、audio/ambience(區域環境音、定位循環音)、audio/scares(驚嚇音)、
//       audio/ui(介面/商店/拾取/多人)、audio/music(程式配樂)、audio/tracks(錄音配樂串流)
import { A, ensure, setListener, attach, setVolume, muffle, tick, poolInfo } from './audio/core.js';
import { foley } from './audio/foley.js';
import { voices } from './audio/voices.js';
import { startMusic, setMood, autoMood, setTension, setHealth, addPain } from './audio/music.js';
import { step, remoteStep, zStep } from './audio/steps.js';
import { ui } from './audio/ui.js';
import { scare } from './audio/scares.js';
import { setZone, loopStart, loopStop, startAmbience, ambState } from './audio/ambience.js';
import * as AMB from './audio/ambience.js';
import { trackState } from './audio/tracks.js';
import * as SM from './audio/samples.js';

// AudioContext 只能在使用者互動後建立/恢復;第一次互動(點擊、按鍵)就自動啟動,選單也聽得到配樂與環境音
let booted = false;
function boot() {
  if (booted || !A.ctx) return;
  booted = true;
  SM.startLoading();
  startAmbience();
  startMusic();
}
export function resume() {
  const c = ensure();
  if (!c) return;
  if (c.state === 'suspended') c.resume().then(boot, () => {});
  else boot();
}
if (typeof document !== 'undefined') {
  const unlock = () => { resume(); if (A.ctx && A.ctx.state === 'running') for (const e of ['pointerdown', 'keydown', 'touchstart']) document.removeEventListener(e, unlock, true); };
  for (const e of ['pointerdown', 'keydown', 'touchstart']) document.addEventListener(e, unlock, true);
}

// 包一層:沒有 context 時直接略過,任何合成錯誤也不往外丟
const safe = (fn) => (...args) => {
  if (!A.ctx) return;
  try { fn(...args); } catch (e) { if (import.meta.env?.DEV) console.warn('[audio]', e); }
};
const always = (fn) => (...args) => { try { return fn(...args); } catch (e) { if (import.meta.env?.DEV) console.warn('[audio]', e); } };

export const sfx = {
  // ---- 武器 ----
  shot: safe((id) => foley.shot(id)),
  dry: safe(() => foley.dry()),
  reload: safe((id, dur, shells) => foley.reload(id, dur, shells)), // dur:實際換彈秒數(可選,讓聲音對齊改裝後的速度)
  switch: safe(() => foley.switch()),
  adsIn: safe(() => foley.adsIn()),
  adsOut: safe(() => foley.adsOut()),
  grenadeThrow: safe(() => foley.grenadeThrow()),
  grenadeBounce: safe((pos) => foley.grenadeBounce(pos)),
  explosion: safe((pos, size = 1) => foley.explosion(pos, size)),
  knifeSwing: safe(() => foley.knifeSwing()),
  knifeHit: safe((pos, flesh = true) => foley.knifeHit(pos, flesh)),
  lowAmmo: safe(() => ui.lowAmmo()),

  // ---- 玩家 ----
  step: safe((sprint = false, surface) => step(sprint, surface)),
  hurt: safe(() => { foley.hurt(); addPain(0.5); }),
  knock: safe(() => { foley.knock(); addPain(0.7); }),
  armorHit: safe(() => foley.armorHit()),
  armorEquip: safe(() => ui.armorEquip()),
  heal: safe(() => ui.heal()),
  hit: safe(() => foley.hit()),
  headshot: safe(() => foley.headshot()),
  wall: safe((pos, surface) => foley.wall(pos, surface)), // pos/surface 可選:定位 + 依材質的彈著聲

  // ---- 拾取 / 商店 / 介面 ----
  coin: safe((i = 0) => ui.coin(i)),
  buy: safe(() => ui.buy()),
  deny: safe(() => ui.deny()),
  pickupAmmo: safe(() => ui.pickupAmmo()),
  pickupMed: safe(() => ui.pickupMed()),
  pickupDeny: safe(() => ui.pickupDeny()),
  pickupItem: safe(() => ui.pickupItem()),
  shopOpen: safe(() => ui.shopOpen()),
  shopClose: safe(() => ui.shopClose()),
  shopTab: safe(() => ui.shopTab()),
  shopHover: safe(() => ui.shopHover()),
  upgrade: safe(() => ui.upgrade()),
  cashRegister: safe(() => ui.cashRegister()),
  shutter: safe((pos, open = true) => ui.shutter(pos, open)),
  door: safe((pos, kind = 'creak') => ui.door(pos, kind)),
  uiClick: safe(() => ui.uiClick()),
  uiHover: safe(() => ui.uiHover()),
  countdown: safe((n) => ui.countdown(n)),
  roundStart: safe(() => { ui.roundStart(); autoMood('fight'); muffle(0, 0, 0.5); }),
  roundEnd: safe(() => { ui.roundEnd(); autoMood('break'); }),

  // ---- 殭屍語音(3D;位置物件會被即時跟隨) ----
  groan: safe((type, pos) => voices.groan(type, pos)),
  zAttack: safe((type, pos) => voices.attack(type, pos)),
  zPain: safe((type, pos) => voices.pain(type, pos)),
  zDie: safe((type, pos) => voices.die(type, pos)),
  shriek: safe((pos) => voices.shriek(pos)),
  roar: safe((pos) => voices.roar(pos)),
  gurgle: safe((pos) => voices.gurgle(pos)),

  // ---- 殭屍動作(3D) ----
  crawl: safe((pos) => foley.crawl(pos)),
  bite: safe((pos) => foley.bite(pos)),
  zStep: safe((type, pos, surface) => zStep(type, pos, surface)),
  stomp: safe((pos) => foley.stomp(pos)),
  wallImpact: safe((pos) => foley.wallImpact(pos)),
  thud: safe((pos, heavy = false) => foley.thud(pos, heavy)),
  spit: safe((pos) => foley.spit(pos)),
  splash: safe((pos) => foley.splash(pos)),
  sizzle: safe((pos) => foley.sizzle(pos)),
  burst: safe((pos) => foley.burst(pos)),

  // ---- 驚嚇 / 環境(未建立 context 時也可呼叫,狀態會先記下) ----
  scare: safe((kind, pos) => scare(kind, pos)),
  setZone: always((zoneId, mood) => setZone(zoneId, mood)),
  loopStart: always((key, kind, pos) => loopStart(key, kind, pos)),
  loopStop: always((key) => loopStop(key)),

  // ---- 多人 ----
  playerJoin: safe(() => ui.playerJoin()),
  playerLeave: safe(() => ui.playerLeave()),
  chat: safe(() => ui.chat()),
  revive: safe((pos) => ui.revive(pos)), // pos 可選:隊友(定位);不給 = 自己
  downed: safe((pos) => ui.downed(pos)),
  killConfirm: safe(() => ui.killConfirm()),
  remoteShot: safe((id, pos) => foley.shot(id, pos, true)),
  remoteStep: safe((pos, surface) => remoteStep(pos, surface)),

  // ---- 聆聽者 / 配樂 / 設定 ----
  listener: always((x, y, z, yaw) => setListener(x, y, z, yaw)),
  setMood: always((m) => setMood(m)),
  setTension: always((x) => setTension(x)),
  setHealth: always((r) => setHealth(r)), // 玩家血量比例 0..1(低血量時出現心跳)
  ambient: safe(() => boot()),
  setVolume: always((kind, v) => setVolume(kind, v)), // kind:'master' | 'music' | 'sfx',v 0..1(會記在 localStorage)
  getVolume: (kind) => A.vol[kind],
  // 建好 World 後呼叫一次:啟用視線遮蔽、樓層悶音、地面材質(彈殼/彈著/殭屍腳步)、自動區域判斷
  attachWorld: always((world) => { A.world = world || null; }),
};

// 除錯/測試用(OfflineAudioContext 量測)
export const _internal = { A, attach, foley, voices, ui, step, zStep, remoteStep, scare, startMusic, startAmbience, tick, poolInfo, SM, ambState, trackState, AMB };
