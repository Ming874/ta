import './hud.css';
import { WEAPONS } from '../weapons/weapon.js';
import { sfx } from '../audio.js';
import { F } from './protocol.js';

// 多人 HUD:計分板(Tab)、聊天(Enter)、隊友列表與血條、擊殺/事件訊息、倒地/救援提示、對戰倒數與比分、選武器、結算。
const el = (tag, cls, parent, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html !== undefined) e.innerHTML = html; if (parent) parent.appendChild(e); return e; };
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const mmss = (t) => { t = Math.max(0, Math.ceil(t)); return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`; };

export class NetHud {
  constructor(s) {
    this.s = s;
    this.chatOpen = false;
    this.pickerOpen = false;
    this.boardOpen = false;
    this.root = null;
    this._t = 0;
    this._timers = {};
  }

  mount() {
    const s = this.s, g = s.game;
    const root = (this.root = el('div', '', document.body));
    root.id = 'mp-hud';
    this.top = el('div', 'mp-panel', root); this.top.id = 'mp-top';
    this.count = el('div', '', root); this.count.id = 'mp-count';
    this.centerEl = el('div', '', root); this.centerEl.id = 'mp-center';
    this.rev = el('div', 'mp-panel', root, '<div class="t"></div><div class="bar"><i></i></div>'); this.rev.id = 'mp-revive';
    this.down = el('div', '', root, '<div class="big">倒地</div><div class="sub"></div><div class="help"></div>'); this.down.id = 'mp-downed';
    this.spec = el('div', 'mp-panel', root); this.spec.id = 'mp-spec';
    this.resp = el('div', '', root, '<div class="big"></div><div class="sub"></div>'); this.resp.id = 'mp-respawn';
    this.team = el('div', '', root); this.team.id = 'mp-team';
    this.feedEl = el('div', '', root); this.feedEl.id = 'mp-feed';
    this.chat = el('div', '', root, '<div class="log idle"></div><input maxlength="160" placeholder="輸入訊息,Enter 送出 · Esc 取消" />'); this.chat.id = 'mp-chat';
    this.log = this.chat.querySelector('.log');
    this.input = this.chat.querySelector('input');
    this.net = el('div', '', root); this.net.id = 'mp-net';
    this.stat = el('div', 'mp-panel', root); this.stat.id = 'mp-status';
    this.board = el('div', 'mp-panel', root); this.board.id = 'mp-board';
    this.pick = el('div', 'mp-panel', root); this.pick.id = 'mp-picker';
    this.res = el('div', '', document.body); this.res.id = 'mp-results';

    // 聊天輸入:鍵盤事件不往遊戲傳
    this.input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') { const t = this.input.value.trim(); if (t) s.client.send('chat', { text: t }); this.closeChat(); }
      else if (e.key === 'Escape') this.closeChat();
    });
    this.input.addEventListener('keyup', (e) => e.stopPropagation());
    this.input.addEventListener('blur', () => { if (this.chatOpen) this.closeChat(); });
    this.onKeyDown = (e) => {
      if (this.chatOpen) return;
      if (e.code === 'Tab') { e.preventDefault(); this.boardOpen = true; this.renderBoard(); this.board.classList.add('on'); }
      if ((e.code === 'Enter' || e.code === 'NumpadEnter') && (g.state === 'playing' || g.state === 'dead')) { e.preventDefault(); this.openChat(); }
    };
    this.onKeyUp = (e) => { if (e.code === 'Tab') { this.boardOpen = false; this.board.classList.remove('on'); } };
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);

    // 暫停選單:多人時世界不暫停,加上「離開房間」
    const pause = document.getElementById('pause');
    if (pause) {
      const h1 = pause.querySelector('h1'), p = pause.querySelector('p');
      this.pauseSaved = { h1: h1?.textContent, p: p?.innerHTML };
      if (h1) h1.textContent = '選單';
      if (p) p.innerHTML = '點擊畫面回到遊戲<br /><small style="opacity:.7">多人連線中,遊戲不會暫停</small>';
      const b = el('button', 'btn', pause, '離開房間');
      b.id = 'mp-leaveBtn';
      b.style.background = '#3a3a3a';
      b.style.borderColor = '#777';
      b.onclick = (e) => { e.stopPropagation(); s.lobby.leaveRoom(); };
    }
    if (!this.s.pvp) this.team.classList.add('on');
  }

  unmount() {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    for (const k in this._timers) clearTimeout(this._timers[k]);
    this.root?.remove();
    this.res?.remove();
    const pause = document.getElementById('pause');
    if (pause && this.pauseSaved) {
      const h1 = pause.querySelector('h1'), p = pause.querySelector('p');
      if (h1 && this.pauseSaved.h1 !== undefined) h1.textContent = this.pauseSaved.h1;
      if (p && this.pauseSaved.p !== undefined) p.innerHTML = this.pauseSaved.p;
      document.getElementById('mp-leaveBtn')?.remove();
      this.pauseSaved = null;
    }
    this.chatOpen = false;
    this.pickerOpen = false;
  }

  openChat() {
    if (this.chatOpen) return;
    this.chatOpen = true;
    const g = this.s.game;
    g.player.keys = {};
    g.input.fireHeld = false;
    this.chat.classList.add('typing');
    this.input.value = '';
    setTimeout(() => this.input.focus(), 0);
  }
  closeChat() {
    this.chatOpen = false;
    this.chat.classList.remove('typing');
    this.input.blur();
  }
  chatLine(name, text, mine, sys = false) {
    if (!this.log) return;
    const d = el('div', mine ? 'mine' : sys ? 'sys' : '', this.log);
    d.innerHTML = sys ? esc(text) : `<b>${esc(name)}</b>${esc(text)}`;
    while (this.log.children.length > 8) this.log.firstChild.remove();
    setTimeout(() => d.classList.add('old'), 9000);
    if (!mine) sfx.chat?.();
  }

  feed(text, kind = '') {
    const ui = this.s.game.ui;
    if (typeof ui.feed === 'function') { ui.feed(text, kind); return; }
    if (!this.feedEl) return;
    const d = el('div', kind, this.feedEl);
    d.textContent = text;
    while (this.feedEl.children.length > 6) this.feedEl.firstChild.remove();
    setTimeout(() => d.classList.add('fade'), 5000);
    setTimeout(() => d.remove(), 5700);
  }
  center(text, ms = 2000) {
    if (!this.centerEl) return;
    this.centerEl.textContent = text;
    this.centerEl.classList.add('on');
    clearTimeout(this._timers.center);
    this._timers.center = setTimeout(() => this.centerEl.classList.remove('on'), ms);
  }
  status(text, warn = false, ms = 0) {
    if (!this.stat) return;
    this.stat.textContent = text;
    this.stat.classList.toggle('warn', warn);
    this.stat.classList.add('on');
    clearTimeout(this._timers.stat);
    if (ms) this._timers.stat = setTimeout(() => this.stat.classList.remove('on'), ms);
  }
  countdown(n) {
    if (!this.count) return;
    if (n > 0) { if (this.count.textContent !== String(n)) { this.count.textContent = n; sfx.countdown?.(n); } this.count.classList.add('on'); }
    else this.count.classList.remove('on');
  }

  // 救援提示(cand = 附近倒地的隊友)、倒地倒數(downT >= 0)、誰在救我(helper)
  revive(cand, p, downT, helper) {
    if (!this.rev) return;
    if (cand && downT < 0) {
      this.rev.classList.add('on');
      this.rev.querySelector('.t').textContent = p > 0 ? `正在救援 ${cand.name}…` : `按住 E 救起 ${cand.name}`;
      this.rev.querySelector('i').style.width = `${Math.round(p * 100)}%`;
    } else this.rev.classList.remove('on');
    if (downT >= 0) {
      this.down.classList.add('on');
      this.down.querySelector('.sub').textContent = `${Math.ceil(downT)} 秒內需要隊友救援 · 仍可用手槍還擊`;
      this.down.querySelector('.help').textContent = helper ? `${helper.name} 正在救你 ${Math.round(helper.p * 100)}%` : '';
    } else this.down.classList.remove('on');
  }
  spectate(name) {
    if (!this.spec) return;
    if (name) { this.spec.textContent = `觀戰中:${name} · 左鍵切換 · 下一回合開始時復活`; this.spec.classList.add('on'); }
    else this.spec.classList.remove('on');
  }
  respawn(t, killer) {
    if (!this.resp) return;
    if (t < 0) { this.resp.classList.remove('on'); return; }
    this.resp.classList.add('on');
    this.resp.querySelector('.big').textContent = killer ? `被 ${killer} 擊殺` : '你陣亡了';
    this.resp.querySelector('.sub').textContent = `${Math.ceil(t)} 秒後重生`;
  }

  // ---- 選武器(對戰) ----
  picker(list, current, onPick, title) {
    this.pickerOpen = true;
    this.onPick = onPick;
    const stat = (w) => {
      const dmg = Math.min(1, (w.damage * (w.pellets || 1)) / 120), rate = Math.min(1, w.rpm / 800), acc = Math.max(0, 1 - w.spread / 0.03), cap = Math.min(1, w.mag / 40);
      const st = w.stats || { damage: dmg, rate, accuracy: acc };
      const bar = (k, v) => `<span>${k}</span><i><b style="width:${Math.round(Math.max(0.05, Math.min(1, v)) * 100)}%"></b></i>`;
      return bar('傷害', st.damage ?? dmg) + bar('射速', st.rate ?? rate) + bar('精準', st.accuracy ?? acc) + bar('彈匣', cap);
    };
    this.pick.innerHTML = `<div class="h">${esc(title)}</div><div class="row">${list.map((id, i) => {
      const w = WEAPONS[id];
      return `<button data-id="${id}" class="${id === current ? 'sel' : ''}"><div class="k">${i + 1}</div><div class="nm">${esc(w.name)}</div><div class="st">${stat(w)}</div></button>`;
    }).join('')}</div>`;
    for (const b of this.pick.querySelectorAll('button')) b.onclick = (e) => { e.stopPropagation(); this.onPick?.(b.dataset.id); };
    this.pick.classList.add('on');
  }
  pickerSelect(id) { for (const b of this.pick?.querySelectorAll('button') || []) b.classList.toggle('sel', b.dataset.id === id); }
  pickerClose() { this.pickerOpen = false; this.pick?.classList.remove('on'); }

  // ---- 結算 ----
  results({ title, sub, cols, rows, again }) {
    const s = this.s;
    this.res.innerHTML = `<div class="box"><h2>${esc(title)}</h2><div class="sub">${esc(sub)}</div>
      <table><tr>${cols.map((c) => `<th>${esc(c)}</th>`).join('')}</tr>${rows.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</table>
      <div class="btns">${s.isHost ? '<button data-a="again">再來一局</button>' : ''}<button data-a="room">返回房間</button><button class="red" data-a="leave">離開房間</button></div>
      ${s.isHost ? '' : '<div class="wait">等待房主開始下一局…</div>'}</div>`;
    for (const b of this.res.querySelectorAll('button')) {
      b.onclick = () => {
        const a = b.dataset.a;
        if (a === 'again') s.lobby.again();
        else if (a === 'room') s.lobby.backToRoom(true);
        else s.lobby.leaveRoom();
      };
    }
    this.res.classList.add('on');
    this.pickerClose();
  }

  // ---- 每幀 ----
  update(dt) {
    if (!this.root) return;
    this._t -= dt;
    if (this._t > 0) return;
    this._t = 0.15;
    const s = this.s, g = s.game, m = s.mode, c = s.client;
    // 網路狀態
    const bad = c.rtt > 220 || c.status !== 'open';
    this.net.textContent = `${Math.round(c.rtt)}ms · ↓${(c.stats.inBps / 1024).toFixed(1)} ↑${(c.stats.outBps / 1024).toFixed(1)} KB/s${s.isHost ? ' · 房主' : ''}`;
    this.net.classList.toggle('bad', bad);
    if (c.status === 'open' && this.stat.classList.contains('warn')) this.stat.classList.remove('on');
    // 上方:對戰比分 / 合作準備狀態
    if (s.pvp) {
      const rows = m.table();
      const mine = m.scores.get(s.me) || { k: 0, d: 0 };
      const lead = rows[0];
      const t = m.warmup > 0 ? '暖身' : mmss(m.hostTimer());
      this.top.innerHTML = `<span class="me">你 <b>${mine.k}</b> 殺 / ${mine.d} 死</span>${lead && lead[0] !== s.me ? `<span class="lead">領先 ${esc(s.nameOf(lead[0]))} <b>${lead[1]}</b></span>` : lead ? '<span class="lead">你領先</span>' : ''}<span class="dim">目標 ${m.limit}</span><span class="time">${t}</span>`;
      this.top.classList.add('on');
    } else if ((g.phase === 'break' || g.phase === 'shop') && g.state === 'playing') {
      const need = m.needed(), have = [...m.votes].filter((id) => id === s.me || s.remotes.get(id)?.connected).length;
      const t = s.isHost ? m.hostTimer() : s.zs.host.timer;
      this.top.innerHTML = `<span>準備下一回合 <b>${have}/${need}</b></span><span class="dim">${m.voted ? '你已準備(再按 N 取消)' : '按 N 準備'}</span>${t >= 0 ? `<span class="time">${mmss(t)}</span>` : ''}`;
      this.top.classList.add('on');
    } else this.top.classList.remove('on');
    // 隊友列表(合作)
    if (!s.pvp) {
      let html = '';
      for (const rp of s.remotes.values()) {
        const st = !rp.connected ? 'off' : rp.downed ? 'down' : !rp.alive ? 'dead' : '';
        const label = !rp.connected ? '斷線' : rp.downed ? '倒地' : (rp.flags & F.DEAD) || !rp.alive ? '陣亡' : `${Math.round(Math.hypot(rp.pos.x - g.player.pos.x, rp.pos.z - g.player.pos.z))}m`;
        html += `<div class="m mp-panel ${st}"><div class="n"><span>${esc(rp.name)}</span><span>${label}</span></div><div class="hp"><i style="width:${Math.max(0, Math.min(100, rp.hp))}%"></i></div></div>`;
      }
      if (html !== this._teamHtml) { this.team.innerHTML = html; this._teamHtml = html; }
    }
    if (this.boardOpen) this.renderBoard();
  }

  renderBoard() {
    const s = this.s, m = s.mode, c = s.client;
    const ping = (id) => (id === s.me ? Math.round(c.rtt) : s.remotes.get(id)?.rtt ?? 0);
    let head, rows;
    if (s.pvp) {
      head = ['玩家', '擊殺', '陣亡', '延遲'];
      rows = m.table().map(([id, k, d]) => [id, [s.nameOf(id) + (id === s.hostSlot ? ' ★' : ''), k, d, `${ping(id)}ms`]]);
    } else {
      head = ['玩家', '擊殺', '倒地', '救援', '狀態', '延遲'];
      const ids = [s.me, ...s.remotes.keys()];
      rows = ids.map((id) => {
        const t = m.team.get(id) || { kills: 0, downs: 0, revives: 0 };
        const rp = s.remotes.get(id);
        const st = id === s.me ? (s.game.player.downed ? '倒地' : m.dead ? '陣亡' : '存活') : !rp.connected ? '斷線' : rp.downed ? '倒地' : rp.alive ? '存活' : '陣亡';
        return [id, [s.nameOf(id) + (id === s.hostSlot ? ' ★' : ''), t.kills, t.downs, t.revives, st, `${ping(id)}ms`]];
      });
    }
    const title = s.pvp ? `對戰死鬥 · 先到 ${m.limit} 殺` : `合作生存 · 第 ${s.game.round} 回合`;
    this.board.innerHTML = `<h3><span>${esc(title)}</span><small>房間 ${esc(s.room.code)}</small></h3><table><tr>${head.map((h) => `<th>${h}</th>`).join('')}</tr>${rows.map(([id, r]) => `<tr class="${id === s.me ? 'me' : ''}">${r.map((v, i) => `<td class="${i === 4 && !s.pvp ? 'st' : ''}">${esc(v)}</td>`).join('')}</tr>`).join('')}</table>
      <div class="foot">延遲 ${Math.round(c.rtt)}ms ±${Math.round(c.jitter)} · 下載 ${(c.stats.inBps / 1024).toFixed(1)} KB/s · 上傳 ${(c.stats.outBps / 1024).toFixed(1)} KB/s · ★ 房主</div>`;
  }
}
