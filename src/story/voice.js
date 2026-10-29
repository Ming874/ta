// 劇情的說話與排程(開場、高潮、結局共用)。
//   line(game, who, text, o) → 秒數:一句台詞(小美/金水伯/廣播/電話走互動系統的 speak;阿嬤走靈異系統的耳語)
//   seq(game, lines, o) → Promise:依序播 [who, text, secs?, o?],每句之間留 gap 秒;stop() 中止
//   wait(game, secs) → Promise:遊戲時間(暫停時不走)
// who:'xl' 小美(收音機)| 'ks' 金水伯(對講機)| 'pa' 醫院廣播 | 'ho' 王醫師(電話)| 'ama' 阿嬤(鬼;只在招魂燈熄時)| 'n' 旁白(沒有聲音的字)
//
// 聲音的鎖(CLARITY_PLAN §7.4):一次只有一個人說話。所有會說話的東西都經過 game.story.voice:
//   voice.busy() / voice.claim(秒, 優先, 誰) / voice.until
//   劇情的 seq 與對講機/提示(deduce.talk)會排隊等;隨機的鬼(沒有 force 的耳語)忙的時候直接放棄;
//   裝置(錄音帶、電話、廣播)開始講時也佔住鎖。阿嬤的一句前後各留空白。
import { ix as ixs } from '../audio.js';
import { captions } from '../ui/captions.js';

export const WHO = {
  xl: { tag: '收音機 · 小美', voice: 'woman', filter: 'radio' },
  ks: { tag: '對講機 · 金水伯', voice: 'old', filter: 'radio' },
  pa: { tag: '醫院廣播', voice: 'woman', filter: 'pa' },
  ho: { tag: '電話 · 王醫師', voice: 'man', filter: 'phone' },
};
const nick = () => { try { const n = localStorage.getItem('hz.nick'); return n && n.trim() ? n.trim().slice(0, 12) : '阿孫'; } catch { return '阿孫'; } };
export const fillNick = (t) => String(t).replace(/\{暱稱\}/g, nick());
// 估計秒數(和合成語音差不多:每字 0.26 秒 + 0.9)
export const secsOf = (t) => 0.7 + [...String(t).replace(/[，。、……？！「」\s]/g, '')].length * 0.19; // 約每秒 5 字(字幕好讀,不拖)

// ---------- 聲音的鎖 ----------
// 一段對話(seq、對講機/提示的 talk)排隊:先到先講,一段講完才輪到下一段(不會兩段對話一句一句交錯)。
// 單句(line)與裝置、鬼也佔住 until;排隊的人等 until 過了才開始。
export function voiceLock(game) {
  const S = (game.story ||= {});
  if (S.voice) return S.voice;
  const now = () => game.time || 0;
  const V = {
    until: 0, prio: 0, who: null, quietUntil: 0, q: [], headT: 0,
    get owner() { return V.q[0] || null; },
    // 有人在說話,或有一段對話在講/在排隊(token = 自己那一段)
    busy(o = {}) {
      const t = now();
      V.prune(t);
      if (V.q.length && V.q[0] !== o.token) return true;
      return t < V.until || (!!o.quiet && t < Math.max(V.until + 4, V.quietUntil)); // quiet:阿嬤前後都要空
    },
    join(token) { if (!V.q.includes(token)) V.q.push(token); if (V.q[0] === token) V.headT = now(); },
    // 插到最前面(玩家接起的鬼來電,短):等正在講的那一句講完就輪到它,排隊中的對話等它講完再接著講
    front(token) { if (V.q.includes(token)) return; token.front = true; let i = 0; while (i < V.q.length && V.q[i].front) i++; V.q.splice(i, 0, token); if (i === 0) V.headT = now(); }, // 裝置之間照先來後到
    combat: () => captions.combat(), // 戰鬥中(15 m 內有活屍、被追):不是劇情的話先不講
    leave(token) { const i = V.q.indexOf(token); if (i >= 0) V.q.splice(i, 1); if (i === 0) V.headT = now(); },
    prune(t) { if (V.q.length && t - V.headT > 60) { V.q.shift(); V.headT = t; } }, // 保險:卡住的對話 60 秒後放掉
    // 佔住 secs 秒;pad = 之後再空幾秒(阿嬤)
    claim(secs, prio = 5, who = null, pad = 0) {
      const t = now();
      V.until = Math.max(V.until, t + Math.max(0.3, secs) + 0.25);
      V.quietUntil = Math.max(V.quietUntil, V.until + pad);
      V.prio = prio; V.who = who;
    },
    reset() { V.until = V.quietUntil = 0; V.prio = 0; V.who = null; V.q.length = 0; },
  };
  S.voice = V;
  captions.bind(game); // 唯一的字幕區(src/ui/captions.js)
  game.interact?.on?.('reset', () => V.reset());
  return V;
}
// 排到自己、而且沒有人在說話(最多 maxWait 秒);阿嬤要前面也安靜(quiet)
export async function free(game, o = {}) {
  const V = voiceLock(game);
  const t0 = game.time || 0;
  while (V.busy(o) && (game.time || 0) - t0 < (o.maxWait ?? 60)) await wait(game, 0.25);
}

export function wait(game, secs) {
  return new Promise((res) => { const X = game.interact; if (!X?.after) { setTimeout(res, secs * 1000); return; } X.after(secs, res); });
}

// 一句;回傳預估秒數。o.sub(fn(who, text, secs))= 自己畫字幕(結局用);o.quiet = 只出字不出聲
export function line(game, who, text, o = {}) {
  text = fillNick(text);
  if (game.story?.ending?.active && !o.sub && !o.ending) return 0; // 結局裡只有結局自己的聲音
  const secs = o.secs || secsOf(text);
  const W = WHO[who];
  if (o.sub) o.sub(who, text, secs);
  if (who === 'n' || o.quiet) return secs;
  voiceLock(game).claim(secs, o.prio ?? 9, who, who === 'ama' ? 5 : 0); // 佔住鎖(別人等;阿嬤之後空 5 秒)
  if (who === 'ama') {
    const h = game.horror;
    try { h?.whisper?.({ id: o.id || null, text, ghost: 'zheng', ear: o.ear || 'both' }, { priority: 9, force: true, subtitle: !o.sub, lockOk: true, critical: true }); } catch { /* 靈異系統關掉了 */ }
    return secs;
  }
  if (!W) return secs;
  const api = game.interact?.map?.api;
  if (o.sub || !api) { // 自己畫字幕:只放聲音
    try { ixs.phoneVoice?.(text, { voice: W.voice, filter: W.filter, pos: o.pos || null, gain: o.gain }); } catch { /* 還沒有聲音 */ }
    return secs;
  }
  try { api.speak({ who: W.tag, parts: [text], voice: W.voice }, { filter: W.filter, noHorror: who !== 'pa', pos: o.pos || null, lockOk: true, critical: true }); } catch { /* 略 */ }
  return secs;
}

// 依序播;回傳 Promise(完成或中止都 resolve),帶 stop()
export function seq(game, lines, o = {}) {
  let stopped = false;
  const V = voiceLock(game), token = {}; // 一段對話排一次隊,講完才換下一段
  const speaks = lines.some((L) => Array.isArray(L) && L[0] !== 'n');
  if (speaks && !o.noWait) V.join(token);
  const p = (async () => {
    try {
    if (speaks && !o.noWait) await free(game, { token, maxWait: o.maxWait ?? 150 }); // 排到我們、而且前一個人說完(劇情不放棄;卡住的 60 秒會被放掉)
    for (const L of lines) {
      if (stopped || (o.alive && !o.alive())) return false;
      if (typeof L === 'function') { await L(); continue; }
      if (typeof L === 'number') { await wait(game, L); continue; }
      const [who, text, secs, lo] = L;
      const ps = String(text).split('\n'); // 一句一行字幕(CLARITY_PLAN §5:一句不超過 18 字,長的拆成兩句依序播)
      for (let i = 0; i < ps.length; i++) {
        if (stopped) return false;
        if (!o.noWait && !lo?.noWait && who !== 'n') await free(game, { quiet: who === 'ama', maxWait: 45, token }); // 自己這一段裡:等上一句(或插進來的裝置/鬼)說完
        if (stopped) return false;
        const d = line(game, who, ps[i], { ...o, ...(lo || {}), secs: ps.length > 1 ? undefined : secs });
        await wait(game, d + (i < ps.length - 1 ? 0.35 : lo?.gap ?? o.gap ?? 0.5));
      }
    }
    return true;
    } finally { V.leave(token); }
  })();
  p.stop = () => { stopped = true; };
  return p;
}
