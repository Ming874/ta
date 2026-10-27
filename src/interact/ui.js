import './interact.css';
import { withKeys } from '../ui/icons.js';
import { ix as ixs } from '../audio.js';

// 互動系統的介面:按住進度條、字幕(電話/收音機/廣播)、紙條與錄音帶閱讀器、密碼鍵盤/病歷終端、保險絲盒、身上的道具。
// HUD 元件掛在 #hud(沿用 hud.css 的 .hd / .hd-bar / .fill 樣式);全螢幕面板(閱讀器等)掛在 body。
// 面板開著時:單人遊戲暫停世界(不放開滑鼠鎖定);多人世界不停,受傷或移動就自動收起。
// 按鍵在 window 捕獲階段處理(比 flow.js / input.js 早),面板吃掉的按鍵不會切武器、不會走路。
const mk = (cls, html = '', tag = 'div') => { const e = document.createElement(tag); e.className = cls; if (html) e.innerHTML = html; return e; };
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const KIND = { note: '紙條', letter: '信', log: '紀錄', chart: '病歷', photo: '照片', tape: '錄音帶', drawing: '蠟筆畫', poster: '告示', whiteboard: '白板', logbook: '登記簿', polaroid: '拍立得' };
const MOVE = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);

export class IxUI {
  constructor(game) {
    this.game = game;
    this.ix = null;
    const hud = game.ui?.hudEl || document.body;
    this.holdEl = hud.appendChild(mk('hd ix-hold hd-hide', '<span></span><div class="hd-bar"><div class="fill"></div></div>'));
    this.holdTxt = this.holdEl.children[0];
    this.holdFill = this.holdEl.querySelector('.fill');
    this.subEl = hud.appendChild(mk('hd ix-subs'));
    this.invEl = hud.appendChild(mk('hd ix-inv hd-hide'));
    this.subs = [];
    this._hold = { on: null, k: -1 };
    this.modal = null;
    window.addEventListener('keydown', (e) => this.onKey(e), true);
    document.addEventListener('pointerlockchange', () => { if (!document.pointerLockElement && this.modal && !this.modal.keepOnUnlock) this.closeModal(false); });
  }

  // ---------- 按住進度 ----------
  holdBar(label, k) {
    const on = label && k > 0.001 ? label : null;
    if (on !== this._hold.on) { this._hold.on = on; this.holdEl.classList.toggle('hd-hide', !on); if (on) this.holdTxt.textContent = `${on}…`; }
    if (on) { const q = Math.round(k * 200); if (q !== this._hold.k) { this._hold.k = q; this.holdFill.style.transform = `scaleX(${q / 200})`; } }
  }

  // ---------- 身上的道具 ----------
  setInv(list) {
    this.invEl.classList.toggle('hd-hide', !list.length);
    this.invEl.innerHTML = list.map((it) => `<span>${esc(it.name)}${it.n > 1 ? ` <b>×${it.n}</b>` : ''}</span>`).join('');
  }

  // ---------- 字幕 ----------
  // say({ who, text, ms, color, tag }) → handle { close() };同時最多兩行,新的在下
  say(o) {
    const lines = String(o.text || '').split('\n');
    const e = mk(`ix-sub${o.tag ? ' ' + o.tag : ''}`, `${o.who ? `<b style="color:${o.color || '#cfd8d2'}">${esc(o.who)}</b>` : ''}<span>${lines.map(esc).join('<br>')}</span>`);
    this.subEl.appendChild(e);
    while (this.subEl.children.length > 2) this.subEl.firstChild.remove();
    const ms = o.ms || 1200 + String(o.text || '').length * 220;
    const h = { e, t: setTimeout(() => h.close(), ms), close() { clearTimeout(h.t); if (!e.isConnected) return; e.classList.add('out'); setTimeout(() => e.remove(), 400); } };
    this.subs.push(h);
    if (this.subs.length > 6) this.subs.shift();
    return h;
  }
  clearSubs() { for (const h of this.subs) h.close(); this.subs.length = 0; }

  // ---------- 面板共用 ----------
  openModal(m) {
    this.closeModal(false);
    const g = this.game;
    this.modal = m;
    if (this.ix) this.ix.modal = m;
    m.paused = !g.net && g.state === 'playing' && !g.paused;
    if (m.paused) g.paused = true; // 單人:世界暫停(不放開滑鼠鎖定)
    m.hurt = g.player?.lastHurt;
    document.body.appendChild(m.el);
    requestAnimationFrame(() => m.el.classList.add('on'));
    if (g.net) m.watch = setInterval(() => { if (g.player.lastHurt !== m.hurt) this.closeModal(); }, 150); // 多人:受傷就收起
    if (g.input) { g.input.fireHeld = false; g.input.firePressed = false; }
  }
  closeModal(sound = true) {
    const m = this.modal;
    if (!m) return;
    this.modal = null;
    if (this.ix) this.ix.modal = null;
    clearInterval(m.watch);
    m.onClose?.(sound);
    m.el.classList.remove('on');
    setTimeout(() => m.el.remove(), 220);
    const g = this.game;
    if (m.paused && g.paused && !document.getElementById('pause')?.classList.contains('on')) g.paused = false; // 是我們暫停的(不是 Esc 叫出的暫停選單)才恢復
  }
  onKey(e) {
    const m = this.modal;
    if (!m) return;
    if (e.code === 'Escape') { this.closeModal(); return; } // 放開滑鼠鎖定 → 暫停選單照常出現
    if (this.game.net && MOVE.has(e.code) && !m.keys?.has?.(e.code)) { this.closeModal(); return; } // 多人:一移動就收起(世界沒停)
    e.stopImmediatePropagation();
    e.preventDefault();
    if (e.repeat && e.code === 'KeyE') return;
    if (m.onKey?.(e) === true) return;
    if (e.code === 'KeyE' || e.code === 'Tab' || (!this.game.net && MOVE.has(e.code) && !m.keys?.has?.(e.code))) this.closeModal();
  }

  // ---------- 紙條 / 錄音帶 ----------
  // note:{ id, kind, title, author, date, body, lines }。tape 時 opts.player = 正在播的 { idx } 會即時標示目前那一行
  reader(note, opts = {}) {
    const kind = note.kind || 'note', tape = kind === 'tape';
    const hand = /note|letter|drawing|log|whiteboard|logbook/.test(kind) && kind !== 'chart';
    const el = mk(`ix-modal ix-reader ${tape ? 'tape' : 'paper'}${hand ? ' hand' : ''} k-${kind}`);
    const body = tape && note.lines
      ? `<ol class="tr">${note.lines.map(([who, text]) => `<li><b>${esc(who)}</b>${esc(text)}</li>`).join('')}</ol>`
      : `<div class="tx">${esc(note.body).replace(/\n/g, '<br>')}</div>`;
    el.innerHTML = `<div class="sheet"><div class="kd">${esc(KIND[kind] || '文件')}${note.where ? ` · ${esc(note.where)}` : ''}</div>
      <h2>${esc(note.title)}</h2>${note.author || note.date ? `<div class="meta">${esc([note.author, note.date].filter(Boolean).join(' · '))}</div>` : ''}${body}</div>
      <div class="ft">${withKeys(tape ? '[E] 收起(錄音帶繼續播) · [Esc] 暫停選單' : '[E] 收起 · [Esc] 暫停選單')}${this.game.net ? ' · 移動或受傷會自動收起' : ''}</div>`;
    const m = { el, kind: 'reader', note, onClose: (s) => { if (s) ixs.paperClose(); opts.onClose?.(); } };
    if (tape) m.mark = (i) => { const li = el.querySelectorAll('.tr li'); li.forEach((x, j) => x.classList.toggle('on', j === i)); li[i]?.scrollIntoView?.({ block: 'nearest' }); };
    this.openModal(m);
    ixs.paper();
    return m;
  }

  // ---------- 密碼鍵盤 / 病歷終端 ----------
  // o:{ title, len(位數), sub, terminal:true(輸入後顯示回應而不是開鎖), check(code) → { ok, text } }
  keypad(o) {
    const len = o.len || 4;
    const el = mk(`ix-modal ix-keypad${o.terminal ? ' term' : ''}`);
    el.innerHTML = `<div class="pad"><div class="kt">${esc(o.title)}</div>${o.sub ? `<div class="ks">${esc(o.sub)}</div>` : ''}
      <div class="disp">${'<i></i>'.repeat(len)}</div><div class="out"></div>
      <div class="keys">${[1, 2, 3, 4, 5, 6, 7, 8, 9, '⌫', 0, '↵'].map((k) => `<span>${k}</span>`).join('')}</div>
      <div class="ft">${withKeys('[0]~[9] 輸入 · [Enter] 確認 · [⌫] 刪除 · [E] 離開')}</div></div>`;
    const cells = [...el.querySelectorAll('.disp i')], out = el.querySelector('.out');
    let code = '', lock = false;
    const show = () => cells.forEach((c, i) => { c.textContent = code[i] ?? ''; c.classList.toggle('on', i < code.length); });
    const flash = (k) => { const s = [...el.querySelectorAll('.keys span')].find((x) => x.textContent === String(k)); if (s) { s.classList.add('hit'); setTimeout(() => s.classList.remove('hit'), 120); } };
    const submit = () => {
      if (lock || !code.length) return;
      const r = o.check(code) || {};
      out.innerHTML = esc(r.text || '').replace(/\n/g, '<br>');
      el.classList.toggle('ok', !!r.ok); el.classList.toggle('bad', !r.ok && !o.terminal);
      if (r.ok && !o.terminal) { lock = true; setTimeout(() => this.closeModal(false), 900); return; }
      code = ''; setTimeout(show, o.terminal ? 0 : 450);
    };
    const m = {
      el, kind: 'keypad', keys: new Set(),
      onKey: (e) => {
        const d = /^(?:Digit|Numpad)(\d)$/.exec(e.code);
        if (d) { if (code.length < len) { code += d[1]; ixs.dtmf(d[1]); flash(d[1]); show(); if (code.length === len && !o.terminal) setTimeout(submit, 160); } return true; }
        if (e.code === 'Backspace') { code = code.slice(0, -1); flash('⌫'); show(); return true; }
        if (e.code === 'Enter' || e.code === 'NumpadEnter') { flash('↵'); submit(); return true; }
        return false;
      },
      onClose: o.onClose,
    };
    show();
    this.openModal(m);
    return m;
  }

  // ---------- 保險絲盒 / 配電 ----------
  // o:{ title, sub(), rows() → [{ label, on, can }], toggle(i) }
  panel(o) {
    const el = mk('ix-modal ix-fuse');
    const draw = () => {
      el.innerHTML = `<div class="pad"><div class="kt">${esc(o.title)}</div><div class="ks">${esc(o.sub?.() || '')}</div>
        <ul>${o.rows().map((r, i) => `<li class="${r.on ? 'on' : ''}${r.can === false ? ' no' : ''}"><kbd class="kc">${i + 1}</kbd><span>${esc(r.label)}</span><em>${r.on ? '供電中' : r.can === false ? '無法供電' : '斷電'}</em></li>`).join('')}</ul>
        <div class="ft">${withKeys(`[1]~[${o.rows().length}] 切換迴路 · [E] 關上`)}</div></div>`;
    };
    const m = {
      el, kind: 'panel', keys: new Set(), redraw: draw,
      onKey: (e) => { const d = /^(?:Digit|Numpad)(\d)$/.exec(e.code); if (d) { const i = +d[1] - 1; if (i >= 0 && i < o.rows().length) { o.toggle(i); draw(); } return true; } return false; },
      onClose: o.onClose,
    };
    draw();
    this.openModal(m);
    return m;
  }

  update() {}
}
