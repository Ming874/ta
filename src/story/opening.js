// 開場與第一夜的節拍(STORY_v2 §4.1 冷開場、§4.7 第一幕;EXPERIENCE_PLAN §3.1)。
// 前 3 分鐘:我是誰(阿孫)、誰在說話(小美)、第一條規則(廣播不能信)、第一個問題(207 的燈)、第一次靜默(阿嬤認得你)。
// - 開場劇本從 game.motion 的 'coldopen:end' 開始(沒有 motion 就從開局);第 1 波第一隻延到劇本講完才出(只有房主/單人)。
// - 第一次招魂燈熄:小美「數到十」(結局回收)→ 金水伯第一段對講機「207 的燈,猶閣光無？」→ 靜默最後:〈望春風〉+ 阿嬤「阿孫……你來矣。」
//   三個聲音之間留白,不疊在一起;阿嬤這一句不管有沒有去過補給站都一定會有。
// - 追逐時小美的話每次不一樣(game.story.chaseLine;zombies/chase.js 取用)。
import { seq, wait, line } from './voice.js';
import { sfx, ix as ixs } from '../audio.js';

const OPEN = [
  ['pa', '各位家屬請注意：您的家人已經回來了。'],
  ['pa', '請到一樓大廳會面。', undefined, { gap: 0.8 }],
  () => {},
  ['xl', '……喂？喂喂？這個頻道有人嗎？', 3.0, { gap: 0.9 }],
  ['xl', '你站的大廳，就是廣播叫大家去的地方。\n看地上那些拖鞋就知道了。', 5.6],
  ['xl', '我叫陳美玲，大家都叫我小美。\nAM 1207，〈霧港夜話〉。\n……不要相信廣播。', 3.6, { gap: 0.8 }],
  ['xl', '往一樓的便利商店走。\n金水伯在那裡放了槍和藥。', 4.6, { gap: 0.8 }],
  'spawn', // 第一隻活屍:等小美說到招魂燈亮了才出來(CLARITY_PLAN §7.3)
  ['xl', '……屋頂的招魂燈亮了。\n他們被叫過來了。打頭！', 2.4],
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
  const fresh = () => ({ started: false, t0: 0, open: null, quiet: 0, firstBreak: false, ama1: false, ks1: false, chase: 0, wasSilent: false, held: false, released: false });
  let run = fresh();
  S.opening = { get run() { return run; } };
  game.story = Object.assign(game.story || {}, {
    chaseLine() { const i = run.chase++; return CHASE[Math.min(i, CHASE.length - 1)]; },
  });

  // 冷開場劇本
  function start() {
    if (run.started || game.state !== 'playing' || game.net?.mode?.pvp || game.net?.pvp) return;
    run.started = true; run.t0 = game.time;
    try { H()?.reveal?.('zheng'); } catch { /* 略 */ } // 阿嬤從第一句起字幕就是「阿嬤」(懸念是發生了什麼事,不是她是誰)
    const Dr = H()?.director;
    if (Dr?.last) Dr.last.chase = Dr.t; // 第一次追逐至少等一分鐘:先認識小美,再被她叫你快跑
    run.open = seq(game, [1.2, ...OPEN.map((L) => (L === 'spawn' ? () => release() : typeof L === 'function' ? () => { try { ixs.tuneSweep?.(game.player.pos); sfx.radio?.(true, 0.2); X.after(1.2, () => sfx.radio?.(false)); } catch { /* 略 */ } } : L))], { alive: () => game.state === 'playing' && game.round <= 1 });
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
    // 第 1 波:第一隻等小美講完(房主/單人;只延一次)
    if (game.round === 1 && game.phase === 'fighting' && !run.held && isHost()) { run.held = true; game.spawnTimer = Math.max(game.spawnTimer || 0, 90); }
    if (run.held && !run.released && (game.round > 1 || game.time - (run.t0 || run.waitT || game.time) > 75)) release(); // 保險:開場被打斷也不要卡住
    // 第一次招魂燈熄
    const silent = game.phase !== 'fighting';
    if (silent && !run.wasSilent) onSilence();
    run.wasSilent = silent;
    return true;
  });

  function release() { // 第一波開始出怪
    if (run.released) return;
    run.released = true;
    if (isHost() && game.round === 1 && game.phase === 'fighting') game.spawnTimer = Math.min(game.spawnTimer || 0, 2.2);
  }
  function onSilence() {
    run.quiet++;
    // 第 4 次靜默:如果還沒有任何「關於你是誰」的小時刻(球、鏡子、床母…),阿嬤自己說一句(依附要在高潮之前就建立)
    if (run.quiet === 4 && !run.small) {
      run.small = true;
      const h = H(), seen = (h?.seenLog || []).some((e) => e.tag === 'self') || D()?.has?.('hc.32');
      if (!seen) X.after(17, () => { if (game.phase !== 'fighting' && game.state === 'playing' && !game.story?.busy?.()) seq(game, [['ama', '阿孫小時候，最愛在護理站等阿嬤下班。', undefined, { ear: 'left' }]]); });
    }
    // 第二次靜默:把「她只在招魂燈熄的時候說話」這條規則說出來(CLARITY_PLAN §1.1)
    if (run.quiet === 2) X.after(3, () => { if (game.phase !== 'fighting' && !game.story?.busy?.()) seq(game, [['xl', '……上次燈熄的時候，有人在叫你。', 3.2], ['xl', '她好像只在招魂燈熄的時候說話。', 3.4]]); });
    if (run.quiet !== 1 || run.firstBreak) return;
    run.firstBreak = true;
    run.open?.stop?.();
    try { H()?.director?.hold?.(34); } catch { /* 略 */ } // 第一次靜默是寫好的:這 30 秒不放隨機的鬼(阿嬤那一句要留白)
    const rest = Number.isFinite(game.restT) && game.restT > 0 ? game.restT : 30;
    seq(game, [
      2.4,
      ['xl', '……招魂燈熄了。還在嗎？好。\n現在是休息時間。', 2.0, { gap: 0.8 }],
      ['xl', '我跟你講，怕的時候，數到十。數到十，天就亮了。', 4.4, { gap: 2.4 }],
      () => { run.ks1 = true; S.flag?.('h.ks.first'); },
      ['ks', '喂？少年仔，我金水伯啦。\n阿伯在外面車上，不敢進去。', 4.6],
      ['ks', '東西都放在櫃台了，休息時來拿。\n……207 的燈，還亮著嗎？', 4.4],
    ], { alive: () => game.state === 'playing' });
    // 靜默最後:〈望春風〉,然後她只說一句,之後什麼都不說
    const at = Math.max(16, Math.min(rest + 1.4 - 7, 26));
    X.after(at, () => {
      if (game.state !== 'playing' || run.ama1) return;
      run.ama1 = true;
      try { sfx.folk('ama', game.player.pos); } catch { /* 還沒烘焙好 */ }
      X.after(2.2, () => { seq(game, [['ama', '阿孫……你來了。', undefined, { id: 'h.w.come', ear: 'left' }], () => S.moments?.m2?.()]); S.flag?.('h.ama.first'); }); // M2:接著一顆球滾過來
    });
  }
  void wait; void D;
  return run;
}
