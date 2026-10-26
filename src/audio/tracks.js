// 錄音配樂:用 <audio> 串流播放(不整首解碼進記憶體)→ MediaElementSource → 配樂匯流排(受配樂音量與閃避控制)。
// 兩台「唱盤」交叉淡入淡出;依配樂狀態(menu/fight/boss/break/shop/dead)挑曲目,非循環曲目快結束時自動接下一首。
// 某首載入失敗就跳過;全部失敗或尚未開始時,程式配樂(music.js)單獨撐場。
import { A, gain, clamp, pick } from './core.js';
import { TRACKS } from './bank.js';

const BASE = `${import.meta.env?.BASE_URL ?? '/'}audio/`;
const X = { mood: null, decks: [], cur: -1, failed: new Set(), playing: null, want: null, tries: 0, ctx: null, wantT: 0 };

function makeDeck() {
  const el = new Audio();
  el.preload = 'auto';
  const src = A.ctx.createMediaElementSource(el);
  const g = gain(0, A.bus.music);
  src.connect(g);
  const d = { el, g, track: null, fading: 0 };
  el.addEventListener('error', () => { if (d.track) { X.failed.add(d.track.f); if (X.decks[X.cur] === d) { X.playing = null; pickNext(true); } } });
  el.addEventListener('timeupdate', () => {
    if (X.decks[X.cur] !== d || !d.track || d.track.loop) return;
    if (el.duration && el.duration - el.currentTime < (d.track.xf ?? 4)) pickNext(false);
  });
  el.addEventListener('ended', () => { if (X.decks[X.cur] === d && d.track && !d.track.loop) pickNext(true); });
  return d;
}

function ensureDecks() {
  if (!A.ctx || typeof Audio === 'undefined' || typeof A.ctx.createMediaElementSource !== 'function') return false;
  if (X.ctx !== A.ctx) { X.ctx = A.ctx; X.decks = [makeDeck(), makeDeck()]; X.cur = -1; X.playing = null; }
  return true;
}

function fadeOut(d, sec) {
  const n = A.ctx.currentTime;
  d.g.gain.cancelScheduledValues(n);
  d.g.gain.setValueAtTime(d.g.gain.value, n);
  d.g.gain.linearRampToValueAtTime(0, n + sec);
  const el = d.el, tok = (d.fading = Math.random());
  setTimeout(() => { if (d.fading === tok) { el.pause(); d.track = null; } }, sec * 1000 + 100);
}

function playTrack(tr, sec = 3) {
  if (!ensureDecks()) return;
  const old = X.decks[X.cur];
  const nx = X.decks[(X.cur + 1) % 2];
  if (old && old.track) fadeOut(old, sec);
  nx.fading = 0;
  nx.track = tr;
  nx.el.loop = !!tr.loop;
  nx.el.src = BASE + tr.f;
  try { nx.el.currentTime = tr.at || 0; } catch { /* metadata 未載入 */ }
  const n = A.ctx.currentTime;
  nx.g.gain.cancelScheduledValues(n);
  nx.g.gain.setValueAtTime(0, n);
  nx.g.gain.linearRampToValueAtTime(tr.g ?? 0.6, n + sec);
  const p = nx.el.play();
  if (p && p.catch) p.catch(() => { /* 自動播放被擋:等下一次互動 */ X.playing = null; });
  X.cur = (X.cur + 1) % 2;
  X.playing = tr;
}

function listFor(mood) { return (TRACKS[mood] || []).filter((t) => !X.failed.has(t.f)); }

function pickNext(now) {
  const list = listFor(X.mood);
  if (!list.length) { const d = X.decks[X.cur]; if (d && d.track) fadeOut(d, 3); X.playing = null; return; }
  if (!now && X.want === X.playing) return;
  const cand = list.length > 1 ? list.filter((t) => t !== X.playing) : list;
  const tr = pick(cand);
  X.want = tr;
  playTrack(tr, now ? 2 : tr.xf ?? 4);
}

// 配樂狀態改變:同一組曲目就不切
export function setTrackMood(mood) {
  X.mood = mood;
  if (!A.ctx) return;
  const list = listFor(mood);
  if (X.playing && list.includes(X.playing)) return;
  if (!list.length) { const d = X.decks[X.cur]; if (d && d.track) fadeOut(d, mood === 'dead' ? 1.5 : 3); X.playing = null; return; }
  const tr = pick(list);
  X.want = tr;
  playTrack(tr, mood === 'boss' || mood === 'dead' ? 1.5 : 3.5);
}

// 目前錄音配樂的存在感(0..1),程式配樂據此退到背景
export function trackLevel() {
  const d = X.decks[X.cur];
  return d && d.track && !d.el.paused ? 1 : 0;
}

export const trackState = () => ({ mood: X.mood, playing: X.playing ? X.playing.f : null, failed: [...X.failed], decks: X.decks.map((d) => (d.track ? `${d.track.f}@${d.el.currentTime.toFixed(1)}${d.el.paused ? '(p)' : ''} g=${d.g.gain.value.toFixed(2)}` : '-')) });
