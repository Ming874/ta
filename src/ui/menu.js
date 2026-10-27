import './menu.css';
import { settings } from './settings.js';
import { sfx } from '../audio.js';

// 主選單(標題畫面)、暫停選單、死亡結算、設定/操作說明/製作與授權面板。
// 沿用 index.html 的 #menu / #pause / #dead 容器與 #startBtn / #resumeBtn / #restartBtn(input.js 會綁定),內容改由這裡建立。
// 多人模式的按鈕由連線模組插入 #menuModes。
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const HEART = '<svg viewBox="0 0 32 32" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.6" d="M16 27.5S4.5 20 4.5 12.3C4.5 8.6 7.3 6 10.6 6c2.3 0 4.3 1.3 5.4 3.2C17.1 7.3 19.1 6 21.4 6c3.3 0 6.1 2.6 6.1 6.3C27.5 20 16 27.5 16 27.5z"/><path fill="currentColor" d="M15 1.5h2v4h3v2h-3v5h-2v-5h-3v-2h3z"/><path fill="none" stroke="currentColor" stroke-width="1.2" opacity=".7" d="M11 13.5c1.5 2.5 3 3.5 5 3.5s3.5-1 5-3.5"/></svg>';
const pct = (v) => `${Math.round(v * 100)}%`;
const SETTINGS = [
  ['sec', '操作'],
  ['range', 'sens', '滑鼠靈敏度', 0.2, 3, 0.05, (v) => `${v.toFixed(2)}×`],
  ['toggle', 'invertY', '反轉 Y 軸'],
  ['range', 'fov', '視野 FOV', 60, 100, 1, (v) => `${v}°`, '開鏡時會依武器縮放'],
  ['sec', '音量'],
  ['range', 'master', '主音量', 0, 1, 0.01, pct],
  ['range', 'music', '音樂與環境', 0, 1, 0.01, pct],
  ['range', 'sfx', '音效', 0, 1, 0.01, pct],
  ['sec', '畫質'],
  ['seg', 'preset', '畫質預設', [['low', '低'], ['medium', '中'], ['high', '高'], ['ultra', '極致']]],
  ['toggle', 'shadows', '陰影', '手電筒與燈光陰影'],
  ['range', 'resScale', '解析度比例', 0.5, 1, 0.05, pct, '降低可大幅提升效能'],
  ['seg', 'fogLights', '霧與燈光品質', [['low', '低'], ['medium', '中'], ['high', '高']]],
  ['toggle', 'hurtFx', '受傷畫面效果', '受傷暈影與方向指示'],
];
const KEYS = [
  ['W A S D', '移動'], ['Shift', '奔跑'], ['滑鼠左鍵', '射擊'], ['滑鼠右鍵', '開鏡(手槍/AK/M4A1/巴雷特)'],
  ['R', '換彈'], ['1 – 6 / 滾輪', '切換武器'], ['G', '投擲手榴彈'], ['V', '近戰小刀'],
  ['H', '使用醫療包'], ['F', '手電筒'], ['E', '互動:補給站 / 補給櫃'], ['N', '休息時間立即開始下一回合'],
  ['M', '全螢幕地圖'], ['PgUp / PgDn', '地圖切換樓層'], ['Esc', '暫停'],
];
const TIPS = [
  '每回合結束後有 <b>30 秒休息</b>,1F 便利商店改成的<b>補給站</b>會拉起捲門:買槍、改裝、防彈背心、手榴彈、醫療包與彈藥。',
  '<b>爆頭</b>造成雙倍傷害並多拿 50% 金幣;<b>近戰擊殺</b>金幣加倍。連續快速擊殺會累積連殺。',
  '殭屍有機率掉落<b>彈匣、醫療包</b>,偶爾掉<b>手榴彈</b>;彈藥或生命不足時掉落率會提高,走過去就會自動撿起。',
  '各樓層的<b>彈藥補給櫃與醫療櫃</b>每回合每人可用一次(按 E)。按 <b>M</b> 打開地圖找它們。',
  '<b>膿腫者</b>死亡會爆炸並留下毒氣;<b>巨屍</b>咆哮後會衝鋒,引牠撞牆再打頭。',
  '聲音是你最好的朋友:戴上耳機,注意腳步、低吼與遠方的動靜。',
];

export class Menu {
  constructor(ui) {
    this.ui = ui;
    this.panelOpen = null;
    document.title = '聖心醫院 · 殭屍生存';
    this._main();
    this._pause();
    this._dead();
    this._panel();
    // 面板開啟時 Esc 只關面板
    window.addEventListener('keydown', (e) => {
      if (this.panelOpen && e.code === 'Escape') { e.stopPropagation(); e.preventDefault(); this.closePanel(); }
    }, true);
    // 按鈕音效(委派)
    document.addEventListener('mouseover', (e) => { if (e.target.closest?.('.mn-btn, .mp-seg button, .mp-ft button, .mp-hd .x')) sfx.uiHover(); });
  }

  attach(game) { this.game = game; }

  _main() {
    const m = $('menu');
    m.classList.add('mn');
    m.innerHTML = `
      <div class="mn-wrap">
        <div class="mn-over">${HEART}SACRED HEART HOSPITAL</div>
        <h1 class="mn-title"><span>聖</span><span>心</span><span>醫</span><span>院</span></h1>
        <div class="mn-sub">午夜之後,這裡<b>不再收治活人</b>。</div>
        <div class="mn-rule"></div>
        <div class="mn-btns">
          <button class="mn-btn primary" id="startBtn">開始遊戲<small>單人生存 · 撐過一波波屍潮</small></button>
          <div id="menuModes"></div>
          <button class="mn-btn" data-p="settings">設定</button>
          <button class="mn-btn" data-p="help">操作說明</button>
          <button class="mn-btn" data-p="credits">製作與授權</button>
        </div>
      </div>
      <div class="mn-foot">建議戴上耳機並全螢幕遊玩 · <b>WASD</b> 移動 · <b>滑鼠</b> 瞄準射擊 · <b>E</b> 互動 · <b>M</b> 地圖<br />聖心醫院 · 一款網頁 3D 殭屍生存射擊遊戲</div>`;
    m.addEventListener('click', (e) => {
      const b = e.target.closest('[data-p]');
      if (b) { sfx.uiClick(); this.openPanel(b.dataset.p); }
    });
    $('startBtn').addEventListener('click', () => sfx.uiClick());
  }

  _pause() {
    const p = $('pause');
    p.classList.add('mn-box');
    p.innerHTML = `
      <div class="mn-card">
        <h1>暫停</h1><div class="mn-hint">點擊空白處或「繼續遊戲」返回</div>
        <div class="mn-btns">
          <button class="mn-btn primary" id="resumeBtn">繼續遊戲</button>
          <button class="mn-btn" data-p="settings">設定</button>
          <button class="mn-btn" data-p="help">操作說明</button>
          <button class="mn-btn" data-act="quit">回到主選單</button>
        </div>
      </div>`;
    // 卡片內的點擊不要冒泡到 #pause(那會直接繼續遊戲),「繼續遊戲」除外
    p.querySelector('.mn-card').addEventListener('click', (e) => {
      if (e.target.closest('#resumeBtn')) return;
      e.stopPropagation();
      const b = e.target.closest('[data-p]');
      if (b) { sfx.uiClick(); this.openPanel(b.dataset.p); }
      if (e.target.closest('[data-act="quit"]')) { sfx.uiClick(); this.game?.quitToMenu(); }
    });
  }

  _dead() {
    const d = $('dead');
    d.classList.add('mn-box');
    d.innerHTML = `
      <div class="mn-card mn-dead">
        <h1>你死了</h1>
        <div id="deadinfo"></div>
        <div class="mn-btns">
          <button class="mn-btn primary" id="restartBtn">再試一次</button>
          <button class="mn-btn" data-act="quit">回到主選單</button>
        </div>
      </div>`;
    d.querySelector('[data-act="quit"]').addEventListener('click', () => { sfx.uiClick(); this.game?.quitToMenu(); });
  }

  showDeath(s) {
    const mmss = `${Math.floor(s.time / 60)}:${String(Math.floor(s.time % 60)).padStart(2, '0')}`;
    const hp = s.kills ? Math.round((s.headshots / s.kills) * 100) : 0;
    const names = { walker: '行屍', runner: '狂奔者', crawler: '爬行者', bloater: '膿腫者', brute: '巨屍' };
    const types = Object.entries(s.byType || {}).map(([k, n]) => `<span>${names[k] || k}<b>${n}</b></span>`).join('');
    $('deadinfo').innerHTML = `
      <div class="mn-round">你撐到了第<b>${s.round}</b>回合</div>
      <div class="mn-stats">
        <div><b>${s.kills}</b><small>擊殺</small></div>
        <div><b>${s.headshots}<em>${hp}%</em></b><small>爆頭</small></div>
        <div><b>${Math.round(s.accuracy * 100)}%</b><small>命中率</small></div>
        <div><b>${mmss}</b><small>存活時間</small></div>
        <div><b>${s.bestStreak}</b><small>最高連殺</small></div>
        <div><b>${s.earned}</b><small>累積金幣</small></div>
      </div>
      ${types ? `<div class="mn-types">${types}</div>` : ''}`;
    this.ui.overlay('dead', true);
  }

  onPause(on) { if (!on && this.panelOpen) this.closePanel(); }

  // ---------- 面板 ----------
  _panel() {
    const el = (this.panelEl = document.createElement('div'));
    el.id = 'mnpanel';
    el.innerHTML = '<div class="mp-card"><div class="mp-hd"><h2></h2><button class="x">返回 Esc</button></div><div class="mp-bd"></div><div class="mp-ft"></div></div>';
    document.body.appendChild(el);
    this.pTitle = el.querySelector('h2');
    this.pBody = el.querySelector('.mp-bd');
    this.pFoot = el.querySelector('.mp-ft');
    el.querySelector('.x').addEventListener('click', () => this.closePanel());
    el.addEventListener('mousedown', (e) => { if (e.target === el) this.closePanel(); });
    el.addEventListener('click', (e) => e.stopPropagation());
    settings.on(() => { if (this.panelOpen === 'settings') this._syncSettings(); });
  }

  openPanel(kind) {
    this.panelOpen = kind;
    this.panelEl.classList.add('on');
    if (kind === 'settings') this._renderSettings();
    else if (kind === 'help') this._renderHelp();
    else this._renderCredits();
  }

  closePanel() {
    if (!this.panelOpen) return;
    this.panelOpen = null;
    this.panelEl.classList.remove('on');
    sfx.uiClick();
  }

  _renderSettings() {
    this.pTitle.textContent = '設定';
    const q = this.game?.quality;
    this.pBody.innerHTML = SETTINGS.map((r) => {
      if (r[0] === 'sec') return `<div class="mp-sec">${r[1]}</div>`;
      const [type, key, label] = r;
      const note = type === 'range' ? r[7] : type === 'toggle' ? r[3] : '';
      const lab = `<label>${label}${note ? `<small>${note}</small>` : ''}</label>`;
      if (type === 'range') return `<div class="mp-row" data-k="${key}">${lab}<input type="range" min="${r[3]}" max="${r[4]}" step="${r[5]}" /><output></output></div>`;
      if (type === 'toggle') return `<div class="mp-row" data-k="${key}">${lab}<button class="mp-tog" aria-label="${label}"></button><output></output></div>`;
      return `<div class="mp-row" data-k="${key}">${lab}<div class="mp-seg">${r[3].map(([v, t]) => `<button data-v="${v}">${t}</button>`).join('')}</div><output></output></div>`;
    }).join('') + `<div class="mp-note">設定會自動儲存在這台電腦的瀏覽器。${q ? '畫質預設由效能模組套用。' : ''}</div>`;
    this.pFoot.innerHTML = '<button data-act="reset">恢復預設</button><button data-act="done">完成</button>';
    this.pFoot.querySelector('[data-act="reset"]').onclick = () => { settings.reset(); sfx.uiClick(); };
    this.pFoot.querySelector('[data-act="done"]').onclick = () => this.closePanel();
    for (const row of this.pBody.querySelectorAll('.mp-row')) {
      const k = row.dataset.k, def = SETTINGS.find((r) => r[1] === k);
      const input = row.querySelector('input'), tog = row.querySelector('.mp-tog'), seg = row.querySelector('.mp-seg');
      if (input) input.addEventListener('input', () => settings.set(k, def[5] >= 1 ? Math.round(+input.value) : +input.value));
      if (tog) tog.addEventListener('click', () => { settings.set(k, !settings.get(k)); sfx.uiClick(); });
      if (seg) seg.addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) { settings.set(k, b.dataset.v); sfx.uiClick(); } });
    }
    this._syncSettings();
  }

  _syncSettings() {
    for (const row of this.pBody.querySelectorAll('.mp-row')) {
      const k = row.dataset.k, v = settings.get(k), def = SETTINGS.find((r) => r[1] === k);
      const input = row.querySelector('input'), tog = row.querySelector('.mp-tog'), seg = row.querySelector('.mp-seg'), out = row.querySelector('output');
      if (input) { if (+input.value !== v) input.value = v; out.textContent = def[6](v); }
      if (tog) { tog.classList.toggle('on', !!v); out.textContent = v ? '開' : '關'; }
      if (seg) { for (const b of seg.children) b.classList.toggle('on', b.dataset.v === v); out.textContent = ''; }
    }
  }

  _renderHelp() {
    this.pTitle.textContent = '操作說明';
    this.pBody.innerHTML = `<div class="mp-sec">按鍵</div><div class="mp-keys">${KEYS.map(([k, t]) => `<div><kbd>${esc(k)}</kbd><span>${esc(t)}</span></div>`).join('')}</div>
      <div class="mp-sec">求生守則</div><ul class="mp-tips">${TIPS.map((t) => `<li>${t}</li>`).join('')}</ul>`;
    this.pFoot.innerHTML = '<span></span><button data-act="done">知道了</button>';
    this.pFoot.querySelector('[data-act="done"]').onclick = () => this.closePanel();
  }

  _renderCredits() {
    this.pTitle.textContent = '製作與授權';
    this.pBody.innerHTML = `<div class="mp-cred">
      <h4>遊戲</h4><p>《聖心醫院》— 網頁 3D 殭屍生存射擊。程式、關卡、介面、程式生成的貼圖與音效合成。</p>
      <h4>引擎與工具</h4><p>three.js(MIT License)· Vite(MIT License)</p>
      <h4>3D 模型(CC0 1.0 公眾領域,Poly Haven)</h4>
      <p>收銀機 Joe Seabuhr · 捲門貼圖 MP · 電視 Gabriel Radić、Benny Weimer · 木層架 Gabriel Radić · 鐵架 Luca B · 時鐘 PierreB3D · 以及場景使用的其他 Poly Haven 模型作者</p>
      <h4>音效、配樂與材質</h4><p>依各素材授權(CC0 / CC-BY)標註於遊戲資料夾的 credits/ 目錄。</p>
      <pre class="mp-raw">正在讀取授權清單…</pre></div>`;
    this.pFoot.innerHTML = '<span></span><button data-act="done">關閉</button>';
    this.pFoot.querySelector('[data-act="done"]').onclick = () => this.closePanel();
    // 讀取 public/credits 下的署名檔(主線程合併後的 CREDITS.md 優先);失敗或拿到 HTML 就略過
    const pre = this.pBody.querySelector('.mp-raw');
    const base = import.meta.env?.BASE_URL || '/';
    const tryFetch = async (names) => {
      for (const n of names) {
        try {
          const r = await fetch(`${base}credits/${n}`);
          const t = r.ok ? await r.text() : '';
          if (t && !/^\s*</.test(t)) return t;
        } catch { /* 略過 */ }
      }
      return '';
    };
    tryFetch(['CREDITS.md', 'gameplay.md']).then((t) => { if (pre.isConnected) { if (t) pre.textContent = t; else pre.remove(); } });
  }
}
