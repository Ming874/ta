// 劇情的說話與排程(開場、高潮、結局共用)。
//   line(game, who, text, o) → 秒數:一句台詞(小鈴/金水伯/廣播/電話走互動系統的 speak;阿嬤走靈異系統的耳語)
//   seq(game, lines, o) → Promise:依序播 [who, text, secs?, o?],每句之間留 gap 秒;stop() 中止
//   wait(game, secs) → Promise:遊戲時間(暫停時不走)
// who:'xl' 小美(收音機)| 'ks' 金水伯(對講機)| 'pa' 醫院廣播 | 'ho' 王醫師(電話)| 'ama' 阿嬤(鬼;只在招魂燈熄時)| 'n' 旁白(沒有聲音的字)
//
// 聲音的鎖(CLARITY_PLAN §7.4):一次只有一個人說話。所有會說話的東西都經過 game.story.voice:
//   voice.busy() / voice.claim(秒, 優先, 誰) / voice.until
//   劇情的 seq 與對講機/提示(deduce.talk)會排隊等;隨機的鬼(沒有 force 的耳語)忙的時候直接放棄;
//   裝置(錄音帶、電話、廣播)開始講時也佔住鎖。阿嬤的一句前後各留空白。
import { ix as ixs } from '../audio.js';

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
export function voiceLock(game) {
  const S = (game.story ||= {});
  if (S.voice) return S.voice;
  const now = () => game.time || 0;
  const V = {
    until: 0, prio: 0, who: null, quietUntil: 0,
    busy(o = {}) { const t = now(); return t < V.until || (!!o.quiet && t < Math.max(V.until + 4, V.quietUntil)); }, // quiet:阿嬤前後都要空
    // 佔住 secs 秒;pad = 之後再空幾秒(阿嬤)
    claim(secs, prio = 5, who = null, pad = 0) {
      const t = now();
      V.until = Math.max(V.until, t + Math.max(0.3, secs) + 0.25);
      V.quietUntil = Math.max(V.quietUntil, V.until + pad);
      V.prio = prio; V.who = who;
    },
    reset() { V.until = V.quietUntil = 0; V.prio = 0; V.who = null; },
  };
  S.voice = V;
  game.interact?.on?.('reset', () => V.reset());
  return V;
}
// 等到沒有人說話(最多 maxWait 秒);阿嬤要前面也安靜(quiet)
export async function free(game, o = {}) {
  const V = voiceLock(game);
  const t0 = game.time || 0;
  while (V.busy(o) && (game.time || 0) - t0 < (o.maxWait ?? 20)) await wait(game, 0.25);
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
    try { h?.whisper?.({ id: o.id || null, text, ghost: 'zheng', ear: o.ear || 'both' }, { priority: 9, force: true, subtitle: !o.sub, lockOk: true }); } catch { /* 靈異系統關掉了 */ }
    return secs;
  }
  if (!W) return secs;
  const api = game.interact?.map?.api;
  if (o.sub || !api) { // 自己畫字幕:只放聲音
    try { ixs.phoneVoice?.(text, { voice: W.voice, filter: W.filter, pos: o.pos || null, gain: o.gain }); } catch { /* 還沒有聲音 */ }
    return secs;
  }
  try { api.speak({ who: W.tag, parts: [text], voice: W.voice }, { filter: W.filter, noHorror: who !== 'pa', pos: o.pos || null, lockOk: true }); } catch { /* 略 */ }
  return secs;
}

// 依序播;回傳 Promise(完成或中止都 resolve),帶 stop()
export function seq(game, lines, o = {}) {
  let stopped = false;
  const p = (async () => {
    for (const L of lines) {
      if (stopped || (o.alive && !o.alive())) return false;
      if (typeof L === 'function') { await L(); continue; }
      if (typeof L === 'number') { await wait(game, L); continue; }
      const [who, text, secs, lo] = L;
      const ps = String(text).split('\n'); // 一句一行字幕(CLARITY_PLAN §5:一句不超過 18 字,長的拆成兩句依序播)
      for (let i = 0; i < ps.length; i++) {
        if (stopped) return false;
        if (!o.noWait && who !== 'n') await free(game, { quiet: who === 'ama', maxWait: o.maxWait }); // 一次一個人說話:前一句(誰的都一樣)說完才輪到這句
        if (stopped) return false;
        const d = line(game, who, ps[i], { ...o, ...(lo || {}), secs: ps.length > 1 ? undefined : secs });
        await wait(game, d + (i < ps.length - 1 ? 0.35 : lo?.gap ?? o.gap ?? 0.5));
      }
    }
    return true;
  })();
  p.stop = () => { stopped = true; };
  return p;
}
