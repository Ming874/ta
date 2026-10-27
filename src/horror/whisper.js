import { LINES, LINE_BY_ID, GHOSTS } from './lines.js';
import { ghost, _internal } from '../audio.js';
import { syllabify } from '../audio/ghost.js';

// 耳邊低語:從文字表挑一句(每局不重複)、播放雙耳合成語音、同步顯示靈異字幕。
// say(lineId | text, { ear, subtitle, filter, priority, pos, mode, g }) → handle | null
const A = _internal.A;
const TAG = { phone: '電話', radio: '收音機' };
// 玩家暱稱(大廳設定的;沒有就用「接單員」)
const nick = () => { try { const n = localStorage.getItem('hz.nick'); return n && n.trim() ? n.trim().slice(0, 12) : '接單員'; } catch { return '接單員'; } };
export class Whispers {
  constructor(h) {
    this.h = h;
    this.used = new Set();
    this.cur = null; // { prio, end(秒,performance 時鐘) }
    this.count = 0;
    this.log = [];
  }
  reset() { this.used.clear(); this.cur = null; this.h.subs.clear(); }
  get busy() { return !!this.cur && performance.now() / 1000 < this.cur.end; }
  // 依觸發條件挑一句:c = { zone(區域物件或 id)、round、phase、prop、cue、ear、hint }
  pick(trig, c = {}) {
    const zid = typeof c.zone === 'string' ? c.zone : c.zone?.id, zth = typeof c.zone === 'object' ? c.zone?.theme : null;
    const rest = c.phase === 'shop' || c.phase === 'break' || c.phase === 'collecting';
    const out = [];
    for (const l of LINES) {
      if (l.trig !== trig || this.used.has(l.id)) continue;
      if (l.zone && !(l.zone.includes(zid) || (zth && l.zone.includes(zth)))) continue;
      if (l.prop && !(Array.isArray(l.prop) ? l.prop.includes(c.prop) : l.prop === c.prop)) continue;
      if (l.cue && c.cue && l.cue !== c.cue) continue;
      if (l.cue && !c.cue && trig === 'cue') continue;
      if (l.prog && ((c.round ?? 1) < l.prog[0] || (l.prog[1] != null && c.round > l.prog[1]))) continue;
      if (l.phase === 'rest' && !rest) continue;
      if (l.phase === 'fight' && rest) continue;
      if (c.ear && l.ear && l.ear !== c.ear) continue;
      if (c.hint && l.hint !== c.hint) continue;
      out.push(l);
    }
    if (!out.length) return null;
    // 同一區有好幾句:先講沒有 prog 限制的(開場句),之後才輪到後面的
    out.sort((a, b) => (a.prog?.[0] ?? 0) - (b.prog?.[0] ?? 0));
    const first = out.filter((l) => (l.prog?.[0] ?? 0) === (out[0].prog?.[0] ?? 0));
    return first[(Math.random() * first.length) | 0];
  }
  // 播放。line:LINES 的 id、line 物件,或直接的文字
  say(line, o = {}) {
    const L0 = typeof line === 'string' ? LINE_BY_ID[line] || { id: null, text: line } : line;
    if (!L0 || !L0.text) return null;
    const L = L0.text.includes('{暱稱}') ? { ...L0, text: L0.text.replace(/\{暱稱\}/g, nick()) } : L0;
    const prio = o.priority ?? 5, t = performance.now() / 1000;
    if (this.busy && this.cur.prio >= prio && !o.force) return null;
    if (this.busy) { this.cur.kill?.(); this.h.subs.clear(); }
    const filter = o.filter ?? L.filter ?? null;
    let ear = o.ear ?? L.ear ?? 'auto';
    if (filter === 'phone' && (ear === 'auto' || ear === 'both')) ear = 'right'; // 聽筒貼在右耳
    if (ear === 'auto') ear = o.pos ? 'world' : ['left', 'right', 'left', 'right', 'behind'][(Math.random() * 5) | 0];
    const mode = o.mode ?? L.mode ?? 'syllabic';
    const g = o.g ?? 0.55;
    let hnd = null;
    if (ear === 'both') {
      hnd = ghost.whisper({ text: L.text, ear: 'left', filter, mode, g: g * 0.85, prio: 7, pitch: 1.12 });
      ghost.whisper({ text: L.text, ear: 'right', filter, mode, g: g * 0.8, prio: 7, delay: 0.13, pitch: 1.04 });
    } else hnd = ghost.whisper({ text: L.text, ear: ear === 'world' ? 'near' : ear, filter, mode, g, prio: 7, pos: ear === 'world' ? o.pos : null });
    const sy = hnd ? null : syllabify(L.text, mode === 'murmur' ? 4.2 : 3.3);
    const dur = hnd ? hnd.dur : 0.55 + sy.dur + 0.9;
    this.cur = { prio, end: t + dur, kill: hnd?.kill, id: L.id };
    if (L.id) this.used.add(L.id);
    // 字幕標籤:電話/收音機 → 來源;鬼 → 「？？？」,認出之後才顯示名字(STORY.md §11.1)
    const tag = filter ? TAG[filter] : o.tag ?? (L.ghost && this.h.known.has(L.ghost) && GHOSTS[L.ghost]?.name ? GHOSTS[L.ghost].name : '？？？');
    this.count++;
    this.log.push(`${L.id || 'text'}@${ear}${filter ? '/' + filter : ''}`);
    if (this.log.length > 30) this.log.shift();
    if (o.subtitle !== false) {
      const clock = hnd && A.ctx ? () => A.ctx.currentTime : undefined;
      this.h.subs.show({ text: L.text, ear: ear === 'world' ? 'both' : ear, filter, times: hnd ? hnd.times : timesByIndex(sy, 0.55), t0: hnd ? hnd.t0 : undefined, clock, hold: 1.8, tag });
    }
    this.h.emit('whisper', { id: L.id, text: L.text, ear, filter, ghost: L.ghost || null, hint: L.hint || null });
    return { id: L.id, ear, end: t + dur, line: L };
  }
}
function timesByIndex(sy, lead) { const a = []; for (const s of sy.list) a[s.i] = s.t + lead; return a; }
