// 開場與第一夜的節拍(STORY_v2 §4.1 冷開場、§4.7 第一幕;EXPERIENCE_PLAN §3.1)。
// 前 3 分鐘:我是誰(阿孫)、誰在說話(小鈴)、第一條規則(廣播不能信)、第一個問題(207 的燈)、第一次靜默(阿嬤認得你)。
// - 開場劇本從 game.motion 的 'coldopen:end' 開始(沒有 motion 就從開局);第 1 波第一隻延到劇本講完才出(只有房主/單人)。
// - 第一次燈篙熄:小鈴「數到十」(結局回收)→ 金水伯第一段對講機「207 的燈,猶閣光無？」→ 靜默最後:〈望春風〉+ 阿嬤「阿孫……你來矣。」
//   三個聲音之間留白,不疊在一起;阿嬤這一句不管有沒有去過補給站都一定會有。
// - 追逐時小鈴的話每次不一樣(game.story.chaseLine;zombies/chase.js 取用)。
import { seq, wait, line } from './voice.js';
import { sfx, ix as ixs } from '../audio.js';

const OPEN = [
  ['pa', '各位家屬請注意：您的家人已經回來了。'],
  ['pa', '請至一樓大廳會面。', undefined, { gap: 1.6 }],
  () => {},
  ['xl', '……喂？喂喂？這個頻道有人嗎？', 3.0, { gap: 0.9 }],
  ['xl', '你站的那個大廳，就是廣播叫大家去的地方。你看地上那些拖鞋就知道了。', 5.6],
  ['xl', '我是小鈴，AM 1207。……不要過去。', 3.6, { gap: 1.2 }],
  ['xl', '……來了，他們來了。', 2.4],
];
const CHASE = [
  '快跑！往綠燈那邊——金水伯的店！',
  '又是他。……不要回頭看，跑。',
  '左邊、左邊！……綠燈那邊！',
  '……你先不要講話。跑就對了。',
  '數到十。……邊跑邊數。',
];

export function installOpening(game, S) {
  const X = game.interact, H = () => game.horror, D = () => game.deduce;
  const isHost = () => !game.net || !!game.net.isHost;
  const fresh = () => ({ started: false, t0: 0, open: null, quiet: 0, firstBreak: false, ama1: false, ks1: false, chase: 0, wasSilent: false, held: false });
  let run = fresh();
  S.opening = { get run() { return run; } };
  game.story = Object.assign(game.story || {}, {
    chaseLine() { const i = run.chase++; return CHASE[Math.min(i, CHASE.length - 1)]; },
  });

  // 冷開場劇本
  function start() {
    if (run.started || game.state !== 'playing' || game.net?.mode?.pvp || game.net?.pvp) return;
    run.started = true; run.t0 = game.time;
    const Dr = H()?.director;
    if (Dr?.last) Dr.last.chase = Dr.t; // 第一次追逐至少等一分鐘:先認識小鈴,再被她叫你快跑
    run.open = seq(game, [1.2, ...OPEN.map((L) => (typeof L === 'function' ? () => { try { ixs.tuneSweep?.(game.player.pos); sfx.radio?.(true, 0.2); X.after(1.2, () => sfx.radio?.(false)); } catch { /* 略 */ } } : L))], { alive: () => game.state === 'playing' && game.round <= 1 });
  }
  let mBound = null; // game.motion 在 main.js 裡比較晚裝:第一次 tick 才綁
  const bindMotion = () => { const m = game.motion; if (!m?.on || m === mBound) return; mBound = m; m.on('coldopen:end', () => { if (!run.started) X.after(0.2, start); }); };

  X.on('reset', () => { run.open?.stop?.(); run = fresh(); });
  let acc = 0;
  X.tick((dt) => {
    bindMotion();
    if (game.state !== 'playing') return true;
    acc += dt;
    if (acc < 0.2) return true;
    acc = 0;
    // 開場:有 motion 等它的 coldopen:end(最多 5 秒);沒有就開局 0.5 秒後
    if (!run.started && game.round === 1) {
      if (!run.waitT) run.waitT = game.time;
      if (!game.motion?.on || (!game.motion.busy && game.time - run.waitT > 1.5) || game.time - run.waitT > 6) start();
    }
    // 第 1 波:第一隻等小鈴講完(房主/單人;只延一次)
    if (game.round === 1 && game.phase === 'fighting' && !run.held && isHost()) { run.held = true; game.spawnTimer = Math.max(game.spawnTimer || 0, 17); }
    // 第一次燈篙熄
    const silent = game.phase !== 'fighting';
    if (silent && !run.wasSilent) onSilence();
    run.wasSilent = silent;
    return true;
  });

  function onSilence() {
    run.quiet++;
    if (run.quiet !== 1 || run.firstBreak) return;
    run.firstBreak = true;
    run.open?.stop?.();
    const rest = Number.isFinite(game.restT) && game.restT > 0 ? game.restT : 30;
    seq(game, [
      2.4,
      ['xl', '……還在嗎？好。', 2.0, { gap: 0.8 }],
      ['xl', '我跟你講，怕的時候，數到十。數到十，天就亮了。', 4.4, { gap: 2.4 }],
      () => { run.ks1 = true; S.flag?.('h.ks.first'); },
      ['ks', '喂？少年仔喔？阿伯佇外口的車頂，聖心彼間我毋敢入去。', 4.6],
      ['ks', '物件攏囥佇櫃台矣。……207 的燈，猶閣光無？', 4.4],
    ], { alive: () => game.state === 'playing' });
    // 靜默最後:〈望春風〉,然後她只說一句,之後什麼都不說
    const at = Math.max(16, Math.min(rest + 1.4 - 7, 26));
    X.after(at, () => {
      if (game.state !== 'playing' || run.ama1) return;
      run.ama1 = true;
      try { sfx.folk('ama', game.player.pos); } catch { /* 還沒烘焙好 */ }
      X.after(2.2, () => { line(game, 'ama', '阿孫……你來矣。', { id: 'h.w.come', ear: 'left' }); S.flag?.('h.ama.first'); });
    });
  }
  void wait; void D;
  return run;
}
