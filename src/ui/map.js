import './map.css';
import { ICON } from './icons.js';
import { parseLayout } from '../map/levels.js';
import { sfx } from '../audio.js';

// 全螢幕地圖:依 layout 畫出目前樓層的平面圖(牆、門、樓梯、區域名稱、補給站與商店圖示、玩家位置與朝向)。
// 每層平面圖畫一次後快取在離屏 canvas;開啟時每幀只重畫玩家標記那一層。
const PX = 16; // 每格像素
const COL = {
  bg: '#090b0b', floor: '#3a3f3c', out: '#2a302c', grass: '#253222', water: '#1d3843', wall: '#77736a', wallHi: '#9c978a',
  window: '#5f8796', rail: '#8a7650', fence: '#55574f', obstacle: '#4d3d33', elevator: '#1e2020', open: '#121515', stair: '#4a4f47',
};
const hex = (n) => `#${n.toString(16).padStart(6, '0')}`;
function mix(a, b, t) { // '#rrggbb' 混色
  const p = (s, i) => parseInt(s.slice(1 + i * 2, 3 + i * 2), 16);
  return `rgb(${[0, 1, 2].map((i) => Math.round(p(a, i) * (1 - t) + p(b, i) * t)).join(',')})`;
}

function drawIcon(x, svg, cx, cy, size, color) { // 用 Path2D 畫 icons.js 的簡單路徑
  const img = new Image();
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg.replace('<svg ', `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" style="color:${color}" `).replace(/currentColor/g, color))}`;
  return new Promise((res) => { img.onload = () => { x.drawImage(img, cx - size / 2, cy - size / 2, size, size); res(); }; img.onerror = res; });
}

export class MapUI {
  constructor(ui) {
    this.ui = ui;
    this.isOpen = false;
    this.cache = new Map();
    const root = (this.root = document.createElement('div'));
    root.id = 'mapui';
    root.innerHTML = `
      <div class="mp-head"><div class="mp-title"></div><div class="mp-floors"></div></div>
      <div class="mp-stage"><canvas class="base"></canvas><canvas class="over"></canvas></div>
      <div class="mp-foot">
        <span><i style="background:#ffb347"></i>補給站</span><span><i style="background:#ffc35a;border-radius:50%"></i>彈藥補給</span>
        <span><i style="background:#7dffae;border-radius:50%"></i>醫療補給</span><span><i style="background:${COL.stair}"></i>樓梯</span>
        <span><i style="background:${COL.window}"></i>窗</span><span><i style="background:#7fe08f;clip-path:polygon(50% 0,100% 100%,0 100%)"></i>你</span>
        <span class="sp"></span><span><kbd>PgUp</kbd><kbd>PgDn</kbd>切換樓層</span><span><kbd>M</kbd>關閉</span>
      </div>`;
    document.body.appendChild(root);
    this.title = root.querySelector('.mp-title');
    this.floorsEl = root.querySelector('.mp-floors');
    this.stage = root.querySelector('.mp-stage');
    this.base = root.querySelector('canvas.base');
    this.over = root.querySelector('canvas.over');
    window.addEventListener('resize', () => { if (this.isOpen) this._fit(); });
  }

  // 資料來源:新 World 的 layout;舊單層地圖用 solid 格子;都沒有就用 levels.js
  _src(game) {
    const w = game.world;
    if (w.layout) return { L: w.layout };
    if (w.solid && w.w) return { legacy: w };
    this._parsed ||= parseLayout();
    return { L: this._parsed };
  }

  open(game) {
    this.game = game;
    const S = this._src(game);
    this.S = S;
    const p = game.player;
    this.me = S.L ? (game.world.levelAt ? game.world.levelAt(p.pos.y + 0.2) : S.L.levelOfY(p.pos.y + 0.2)) : 0;
    this.li = this.me;
    this.isOpen = true;
    this.root.classList.add('on');
    this._show();
    this._fit();
    this.update(game);
    sfx.uiClick();
  }

  close() {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.root.classList.remove('on');
  }

  floor(d) {
    if (!this.S?.L) return;
    const n = this.S.L.levels.length;
    const li = Math.max(0, Math.min(n - 1, this.li + d));
    if (li === this.li) return;
    this.li = li;
    this._show();
    this.update(this.game);
  }

  _dims() {
    if (this.S.L) return { w: this.S.L.W, h: this.S.L.H };
    return { w: this.S.legacy.w, h: this.S.legacy.h };
  }

  _fit() {
    const { w, h } = this._dims();
    const maxW = Math.min(1180, window.innerWidth * 0.94), maxH = window.innerHeight - 130;
    const k = Math.min(maxW / w, maxH / h);
    this.stage.style.width = `${Math.floor(w * k)}px`;
    this.stage.style.height = `${Math.floor(h * k)}px`;
    for (const h2 of this.root.querySelectorAll('.mp-head, .mp-foot')) h2.style.width = `${Math.floor(w * k)}px`;
  }

  _show() {
    const { w, h } = this._dims();
    for (const c of [this.base, this.over]) if (c.width !== w * PX) { c.width = w * PX; c.height = h * PX; }
    const L = this.S.L;
    if (L) {
      const lv = L.levels[this.li];
      this.title.innerHTML = `${lv.id}<small>${lv.name}</small>`;
      this.floorsEl.innerHTML = L.levels.slice().reverse().map((l) => `<span class="${l.index === this.li ? 'on' : ''}${l.index === this.me ? ' me' : ''}">${l.id}</span>`).join('');
    } else { this.title.innerHTML = '1F<small>一樓</small>'; this.floorsEl.innerHTML = ''; }
    const key = L ? `L${this.li}` : 'legacy';
    let c = this.cache.get(key);
    if (!c) { c = this._render(); this.cache.set(key, c); }
    const x = this.base.getContext('2d');
    x.clearRect(0, 0, this.base.width, this.base.height);
    x.drawImage(c, 0, 0);
    // 圖示(非同步載入 SVG,畫在快取上一次就好)
    if (!c._icons) {
      c._icons = this._icons(c).then(() => { if (this.isOpen && this.cache.get(key) === c) { x.clearRect(0, 0, this.base.width, this.base.height); x.drawImage(c, 0, 0); } });
    }
  }

  // 平面圖(一次)
  _render() {
    const { w, h } = this._dims();
    const c = document.createElement('canvas');
    c.width = w * PX; c.height = h * PX;
    const x = c.getContext('2d');
    x.fillStyle = COL.bg; x.fillRect(0, 0, c.width, c.height);
    // 細格線(藍圖感)
    x.strokeStyle = 'rgba(255,255,255,.025)'; x.lineWidth = 1;
    for (let i = 0; i <= w; i++) { x.beginPath(); x.moveTo(i * PX + 0.5, 0); x.lineTo(i * PX + 0.5, c.height); x.stroke(); }
    for (let j = 0; j <= h; j++) { x.beginPath(); x.moveTo(0, j * PX + 0.5); x.lineTo(c.width, j * PX + 0.5); x.stroke(); }
    if (this.S.legacy) {
      const W = this.S.legacy;
      for (let r = 0; r < h; r++) for (let q = 0; q < w; q++) { x.fillStyle = W.isSolidCell(q, r) ? COL.wall : COL.floor; x.fillRect(q * PX, r * PX, PX, PX); }
      return c;
    }
    const L = this.S.L, li = this.li;
    const tintOf = (z) => (z && L.moods[z.mood] ? hex(L.moods[z.mood].tint) : null);
    for (let r = 0; r < h; r++) for (let q = 0; q < w; q++) {
      const ch = L.charAt(li, q, r), X = q * PX, Y = r * PX;
      let col = null;
      if (ch === '_') continue;
      const z = L.zoneAt(li, q, r);
      if ('.ZP$ah+'.includes(ch)) col = tintOf(z) ? mix(COL.floor, tintOf(z), 0.16) : COL.floor;
      else if (ch === ',' || ch === 'z') col = COL.out;
      else if (ch === '"') col = COL.grass;
      else if (ch === '~') col = COL.water;
      else if ('^v<>'.includes(ch)) col = COL.stair;
      else if (ch === '#') col = COL.wall;
      else if (ch === 'W') col = COL.window;
      else if (ch === '=') col = COL.rail;
      else if (ch === '|') col = COL.fence;
      else if (ch === 'X') col = COL.obstacle;
      else if (ch === 'E') col = COL.elevator;
      else if (ch === 'o' || ch === '%') col = COL.open;
      x.fillStyle = col || COL.floor;
      x.fillRect(X, Y, PX, PX);
      if (ch === '#') { // 牆面上緣高光,讓牆有厚度
        const open = (dq, dr) => !'#WE'.includes(L.charAt(li, q + dq, r + dr));
        x.fillStyle = COL.wallHi;
        if (open(0, 1)) x.fillRect(X, Y + PX - 2, PX, 2);
        if (open(0, -1)) x.fillRect(X, Y, PX, 2);
        if (open(1, 0)) x.fillRect(X + PX - 2, Y, 2, PX);
        if (open(-1, 0)) x.fillRect(X, Y, 2, PX);
      } else if (ch === 'W') { x.fillStyle = 'rgba(255,255,255,.35)'; x.fillRect(X + 2, Y + PX / 2 - 1, PX - 4, 2); }
      else if (ch === '+') { x.strokeStyle = 'rgba(255,230,190,.55)'; x.lineWidth = 2; x.strokeRect(X + 3, Y + 3, PX - 6, PX - 6); }
      else if (ch === 'o' || ch === '%') { // 挑空/樓梯開口:斜線
        x.strokeStyle = 'rgba(255,255,255,.07)'; x.lineWidth = 1;
        x.beginPath(); x.moveTo(X, Y + PX); x.lineTo(X + PX, Y); x.stroke();
      } else if (ch === 'E') { x.strokeStyle = 'rgba(255,255,255,.2)'; x.beginPath(); x.moveTo(X + 3, Y + 3); x.lineTo(X + PX - 3, Y + PX - 3); x.moveTo(X + PX - 3, Y + 3); x.lineTo(X + 3, Y + PX - 3); x.stroke(); }
      else if ('^v<>'.includes(ch)) { // 樓梯踏階
        x.strokeStyle = 'rgba(0,0,0,.35)'; x.lineWidth = 1;
        for (let k = 3; k < PX; k += 4) {
          x.beginPath();
          if (ch === '^' || ch === 'v') { x.moveTo(X, Y + k + 0.5); x.lineTo(X + PX, Y + k + 0.5); } else { x.moveTo(X + k + 0.5, Y); x.lineTo(X + k + 0.5, Y + PX); }
          x.stroke();
        }
      }
    }
    // 樓梯箭頭(朝上坡)
    x.fillStyle = 'rgba(255,240,210,.85)';
    for (const s of L.stairs) {
      if (s.lower !== li && s.upper !== li) continue;
      const cx = ((s.c0 + s.c1 + 1) / 2) * PX, cy = ((s.r0 + s.r1 + 1) / 2) * PX;
      const a = { '^': -Math.PI / 2, v: Math.PI / 2, '<': Math.PI, '>': 0 }[s.dir] + (s.lower === li ? 0 : Math.PI);
      x.save(); x.translate(cx, cy); x.rotate(a);
      x.beginPath(); x.moveTo(9, 0); x.lineTo(-5, -7); x.lineTo(-5, 7); x.closePath(); x.fill();
      x.restore();
      x.font = '700 10px "Bahnschrift", sans-serif'; x.textAlign = 'center';
      const to = L.levels[s.lower === li ? s.upper : s.lower];
      if (to) x.fillText(`${s.lower === li ? '↑' : '↓'}${to.id}`, cx, cy + 18);
    }
    // 區域名稱(最大的矩形中央;字放不下就縮小,太小就略過)
    x.textAlign = 'center'; x.textBaseline = 'middle';
    for (const z of L.zones) {
      if (z.levelIndex !== li) continue;
      const big = z.rects.reduce((a, b) => ((b[2] - b[0] + 1) * (b[3] - b[1] + 1) > (a[2] - a[0] + 1) * (a[3] - a[1] + 1) ? b : a));
      const rw = (big[2] - big[0] + 1) * PX, rh = (big[3] - big[1] + 1) * PX;
      let size = 14;
      x.font = `700 ${size}px "Microsoft JhengHei", sans-serif`;
      const tw = x.measureText(z.name).width;
      if (tw > rw - 4) size = Math.floor(size * (rw - 4) / tw);
      if (size < 8 || rh < 12) continue;
      x.font = `700 ${size}px "Microsoft JhengHei", sans-serif`;
      const cx = ((big[0] + big[2] + 1) / 2) * PX, cy = ((big[1] + big[3] + 1) / 2) * PX;
      x.lineWidth = 3; x.strokeStyle = 'rgba(0,0,0,.75)'; x.strokeText(z.name, cx, cy);
      x.fillStyle = z.theme === 'shop' ? '#ffd08a' : 'rgba(236,230,214,.88)'; x.fillText(z.name, cx, cy);
    }
    return c;
  }

  async _icons(c) {
    const L = this.S.L;
    if (!L) return;
    const x = c.getContext('2d'), li = this.li, jobs = [];
    const shop = this.game.world.shop || L.shop;
    if (shop && (shop.level ?? 1) === li) {
      const cx = (shop.x / L.CELL) * PX, cy = (shop.z / L.CELL) * PX;
      x.fillStyle = 'rgba(255,179,71,.22)'; x.beginPath(); x.arc(cx, cy, 15, 0, 7); x.fill();
      jobs.push(drawIcon(x, ICON.cart, cx, cy, 20, '#ffb347'));
    }
    for (const s of this.game.world.supplies?.length ? this.game.world.supplies : L.supplies) {
      if ((s.level ?? 0) !== li) continue;
      const cx = (s.x / L.CELL) * PX, cy = (s.z / L.CELL) * PX, col = s.kind === 'health' ? '#7dffae' : '#ffc35a';
      x.fillStyle = 'rgba(0,0,0,.6)'; x.beginPath(); x.arc(cx, cy, 10, 0, 7); x.fill();
      x.strokeStyle = col; x.lineWidth = 2; x.stroke();
      jobs.push(drawIcon(x, s.kind === 'health' ? ICON.cross : ICON.ammo, cx, cy, 13, col));
    }
    await Promise.all(jobs);
  }

  // 每幀(開啟時):只重畫玩家標記
  update(game) {
    if (!this.isOpen) return;
    const x = this.over.getContext('2d');
    x.clearRect(0, 0, this.over.width, this.over.height);
    const C = this.S.L ? this.S.L.CELL : 2;
    for (const pl of game.players) {
      if (pl.alive === false) continue;
      const li = this.S.L ? (game.world.levelAt ? game.world.levelAt(pl.pos.y + 0.2) : this.S.L.levelOfY(pl.pos.y + 0.2)) : 0;
      const here = li === this.li, me = pl === game.player;
      const px = (pl.pos.x / C) * PX, py = (pl.pos.z / C) * PX;
      const t = performance.now() / 1000;
      x.save();
      x.translate(px, py);
      if (me && here) { // 脈動圓圈
        x.strokeStyle = `rgba(127,224,143,${0.5 - (t % 1.2) / 2.4})`; x.lineWidth = 2;
        x.beginPath(); x.arc(0, 0, 8 + (t % 1.2) * 14, 0, 7); x.stroke();
      }
      x.rotate(-pl.yaw);
      x.globalAlpha = here ? 1 : 0.35;
      x.fillStyle = me ? '#7fe08f' : '#8fc8ff';
      x.strokeStyle = '#0a0d0b'; x.lineWidth = 2;
      x.beginPath(); x.moveTo(0, -11); x.lineTo(7.5, 8); x.lineTo(0, 4); x.lineTo(-7.5, 8); x.closePath(); x.fill(); x.stroke();
      x.restore();
      if (me && !here && this.S.L) {
        x.font = '700 13px "Microsoft JhengHei", sans-serif'; x.textAlign = 'center'; x.fillStyle = '#7fe08f';
        x.fillText(`你在 ${this.S.L.levels[li].id}`, px, py - 18);
      }
    }
  }
}
