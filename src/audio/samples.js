// 樣本庫:public/audio/**.mp3(CC0 / CC-BY,署名見 public/credits/audio.md)。
// AudioContext 建立後依類別分批背景載入:fetch → decodeAudioData(非同步、在背景執行緒解碼,不卡主執行緒),
// 同時最多 3 個請求;某類別第一次被用到時立即插隊載入。同一事件多個變體隨機挑選(不連續重複)+ 輕微音高/音量隨機。
// 缺檔或載入失敗時 play() 回傳 null,呼叫端退回合成版本。
import { A, emit, playBuf, rand } from './core.js';
import { BANK, CATS } from './bank.js';

export { BANK };
const BASE = `${import.meta.env?.BASE_URL ?? '/'}audio/`;
const SB = { buf: new Map(), fail: new Set(), cat: {}, last: {}, ok: 0, bad: 0, bytes: 0, secs: 0, chs: 0, ms: 0, q: [], active: 0, started: false };

function fileList(cat) {
  const out = new Set();
  for (const k in BANK) if (BANK[k].cat === cat) for (const f of BANK[k].f) out.add(f);
  return [...out];
}

function pump() {
  while (SB.active < 3 && SB.q.length) {
    const job = SB.q.shift();
    SB.active++;
    const t0 = performance.now();
    fetch(BASE + job.f)
      .then((r) => { if (!r.ok) throw new Error(r.status); return r.arrayBuffer(); })
      .then((ab) => { SB.bytes += ab.byteLength; return decode(ab); })
      .then((b) => { SB.buf.set(job.f, b); SB.ok++; SB.secs += b.duration; SB.chs += b.duration * b.numberOfChannels; })
      .catch(() => { SB.fail.add(job.f); SB.bad++; })
      .finally(() => { SB.ms += performance.now() - t0; SB.active--; job.done(); pump(); });
  }
}

function decode(ab) {
  const ctx = A.ctx;
  return new Promise((res, rej) => {
    const p = ctx.decodeAudioData(ab, res, rej); // 舊版 Safari 只支援 callback
    if (p && p.then) p.then(res, rej);
  });
}

// 載入某類別(回傳 Promise,全部完成時 resolve;重複呼叫共用同一個)
export function loadCat(cat, front = false) {
  if (SB.cat[cat]) return SB.cat[cat];
  if (!A.ctx) return Promise.resolve();
  const files = fileList(cat).filter((f) => !SB.buf.has(f) && !SB.fail.has(f));
  SB.cat[cat] = Promise.all(files.map((f) => new Promise((done) => { SB.q[front ? 'unshift' : 'push']({ f, done }); })));
  pump();
  return SB.cat[cat];
}

// 啟動時依優先順序排入所有類別(戰鬥要用的先載,配樂用串流不在這裡)
export function startLoading() {
  if (SB.started || !A.ctx) return;
  SB.started = true;
  CATS.forEach((c, i) => setTimeout(() => loadCat(c), i * 400));
}

export const ready = (cats = CATS) => Promise.all(cats.map((c) => loadCat(c)));

// 隨機取一個已載入的變體(不連續重複);沒有就觸發該類別載入並回傳 null
export function buf(key) {
  const B = BANK[key];
  if (!B) return null;
  const have = B.f.filter((f) => SB.buf.has(f));
  if (!have.length) { if (A.ctx && !SB.cat[B.cat]) loadCat(B.cat, true); return null; }
  let f = have[(Math.random() * have.length) | 0];
  if (have.length > 1 && f === SB.last[key]) f = have[(have.indexOf(f) + 1 + ((Math.random() * (have.length - 1)) | 0)) % have.length];
  SB.last[key] = f;
  return SB.buf.get(f);
}
export const has = (key) => !!BANK[key] && BANK[key].f.some((f) => SB.buf.has(f));

// 播放:o.h 傳入既有的發聲 handle 就疊在同一個聲道條上(錄音 + 合成分層);否則自己 emit(o 同 emit 參數)。
// o.g 增益、o.p 音高隨機(半音)、o.semi 固定移調、o.at 延遲、o.off/len 截取片段、o.fi/fo 淡入淡出
export function play(key, o = {}) {
  if (!A.ctx) return null;
  const b = buf(key);
  if (!b) return null;
  const B = BANK[key];
  const rate = Math.pow(2, ((rand(-1, 1) * (o.p ?? B.p ?? 0.6)) + (o.semi ?? 0)) / 12);
  const len = o.len ?? (b.duration - (o.off ?? 0)) / rate;
  const h = o.h || emit({ ...o, gain: o.gain ?? 1, dur: o.dur ?? len + 0.05 });
  if (!h) return null;
  const g = (B.g ?? 1) * (o.g ?? 1) * Math.pow(10, (rand(-1, 1) * (B.v ?? 1.5)) / 20);
  playBuf(h.in, h.t + (o.at ?? 0), b, { rate, g, off: o.off, len: o.len, fi: o.fi, fo: o.fo ?? (o.len ? 0.03 : 0) });
  return h;
}

export function stats() {
  const files = Object.values(BANK).reduce((s, B) => s + B.f.length, 0);
  return { files, loaded: SB.ok, failed: SB.bad, failedFiles: [...SB.fail].slice(0, 10), mb: +(SB.bytes / 1048576).toFixed(2), bufferSec: +SB.secs.toFixed(1), pcmMB: +((SB.chs * (A.ctx ? A.ctx.sampleRate : 48000) * 4) / 1048576).toFixed(1), loadMs: Math.round(SB.ms), pending: SB.q.length + SB.active };
}
