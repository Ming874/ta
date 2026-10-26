import './scope.css';

// 畫面正中央的武器 HUD:動態準心(依散布張開)、命中標記(一般/爆頭/擊殺)、巴雷特全螢幕狙擊鏡(米位線、暗角、色差、呼吸晃動與屏息)
const el = (tag, cls, parent) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (parent) parent.appendChild(e);
  return e;
};
const SKULL = '<svg class="skull" viewBox="0 0 24 24"><path fill="#ff3326" d="M12 2C6.9 2 3 5.6 3 10.3c0 2.7 1.3 4.9 3.3 6.3V20c0 .6.4 1 1 1h1.5v-2h1.4v2h3.6v-2h1.4v2h1.5c.6 0 1-.4 1-1v-3.4c2-1.4 3.3-3.6 3.3-6.3C21 5.6 17.1 2 12 2zm-3.6 12.2c-1.3 0-2.2-1-2.2-2.3s1-2.3 2.2-2.3 2.2 1 2.2 2.3-.9 2.3-2.2 2.3zm3.6 2.4l-1.3-2.3h2.6L12 16.6zm3.6-2.4c-1.3 0-2.2-1-2.2-2.3s1-2.3 2.2-2.3 2.2 1 2.2 2.3-.9 2.3-2.2 2.3z"/></svg>';

export class CenterHud {
  constructor() {
    const old = document.getElementById('crosshair'); // 舊準心由這裡接手
    if (old) old.style.display = 'none';
    // ---- 狙擊鏡(放在遊戲畫布之後、HUD 之前:血條/彈藥仍顯示在鏡外黑邊上) ----
    const s = (this.scope = el('div'));
    s.id = 'wx-scope';
    this.lens = el('div', 'lens', s);
    this.shade = el('div', 'shade', this.lens);
    this.cv = el('canvas', '', this.lens);
    el('div', 'glare', this.lens);
    this.info = el('div', 'info', s);
    this.info.innerHTML = '<span class="z">6×</span> · 按住 Shift 屏息<div class="breath"><i></i></div>';
    this.breathBar = this.info.querySelector('.breath');
    this.breathFill = this.info.querySelector('.breath i');
    this.blink = el('div', 'blink', s);
    const game = document.getElementById('game');
    if (game && game.parentNode) game.after(s); else document.body.prepend(s);
    // ---- 準心 ----
    const r = (this.ret = el('div'));
    r.id = 'wx-reticle';
    this.parts = {};
    for (const k of ['t', 'b', 'l', 'r', 'd', 'ring']) this.parts[k] = el('i', k, r);
    // ---- 命中標記 ----
    const h = (this.hit = el('div'));
    h.id = 'wx-hit';
    for (let i = 0; i < 4; i++) el('i', '', h);
    h.insertAdjacentHTML('beforeend', SKULL);
    document.body.append(r, h);

    this.size = 0;
    this.scopedOn = false;
    this.lastGap = -1;
    this.lastOp = -1;
    this.kind = '';
    // 呼吸
    this.t = Math.random() * 10;
    this.stam = 1; // 屏息體力 0..1(滿 = 3 秒)
    this.tired = 0; // 喘氣剩餘秒數
    this.hold = 0;
    this.jit = 0;
    this.sway = { x: 0, y: 0 };
    this.ox = 0; this.oy = 0;
    window.addEventListener('resize', () => this._layout());
    this._layout();
  }

  _layout() {
    const W = window.innerWidth, H = window.innerHeight;
    const D = Math.round(Math.min(W, H) * 0.94);
    if (D === this.size) return;
    this.size = D;
    Object.assign(this.lens.style, { width: `${D}px`, height: `${D}px`, marginLeft: `${-D / 2}px`, marginTop: `${-D / 2}px` });
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.cv.width = this.cv.height = Math.round(D * dpr);
    this._drawReticle(this.cv.getContext('2d'), D * dpr, dpr);
  }

  // 米位線十字(Mil-Dot):外側粗柱、中央細線、每側 4 個米位點、下方測距刻度、中央紅色照明點
  _drawReticle(x, S, dpr) {
    const R = S / 2, c = R;
    x.clearRect(0, 0, S, S);
    x.fillStyle = 'rgba(4,6,5,0.95)';
    const post = 4.2 * dpr, thin = 1.1 * dpr, inner = R * 0.36;
    x.fillRect(0, c - post / 2, c - inner, post);
    x.fillRect(c + inner, c - post / 2, c - inner, post);
    x.fillRect(c - post / 2, c + inner, post, c - inner);
    x.fillRect(c - post / 2, 0, post, c - inner);
    x.fillRect(c - inner, c - thin / 2, inner * 2, thin);
    x.fillRect(c - thin / 2, c - inner, thin, inner * 2);
    const mil = inner / 5;
    for (let i = 1; i <= 4; i++) {
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        x.beginPath();
        x.ellipse(c + dx * mil * i, c + dy * mil * i, (dy ? 2.2 : 1.6) * dpr, (dx ? 2.2 : 1.6) * dpr, 0, 0, Math.PI * 2);
        x.fill();
      }
    }
    for (let i = 1; i <= 9; i++) { // 測距刻度(下方)
      const w = (i % 2 ? 6 : 10) * dpr, y = c + mil * 0.5 * i;
      if (i % 2 === 0) x.fillRect(c - w / 2, y - thin / 2, w, thin);
    }
    x.font = `${10 * dpr}px sans-serif`;
    x.fillStyle = 'rgba(4,6,5,0.8)';
    for (const n of [2, 4]) x.fillText(String(n * 100), c + 8 * dpr, c + mil * n + 4 * dpr);
    const g = x.createRadialGradient(c, c, 0, c, c, 4 * dpr);
    g.addColorStop(0, 'rgba(255,60,40,1)');
    g.addColorStop(0.45, 'rgba(255,40,20,0.85)');
    g.addColorStop(1, 'rgba(255,30,10,0)');
    x.fillStyle = g;
    x.beginPath(); x.arc(c, c, 4 * dpr, 0, Math.PI * 2); x.fill();
  }

  // 命中標記:kind 'hit' | 'head' | 'kill';headKill 爆頭擊殺多一個骷髏
  marker(kind, headKill = false) {
    const h = this.hit;
    h.className = kind === 'kill' ? (headKill ? 'kill head' : 'kill') : kind === 'head' ? 'head' : '';
    if (this._anim) this._anim.cancel();
    const dur = kind === 'kill' ? 520 : kind === 'head' ? 300 : 200;
    this._anim = h.animate([
      { opacity: 1, transform: `scale(${kind === 'kill' ? 1.7 : 1.35})` },
      { opacity: 1, transform: 'scale(1)', offset: 0.28 },
      { opacity: 0, transform: 'scale(1)' },
    ], { duration: dur, easing: 'ease-out' });
  }

  // 開槍時鏡內跳動
  kick(a = 1) { this.jit = Math.min(1.5, this.jit + a); }

  // 每幀:回傳狙擊鏡呼吸晃動(弧度 {x: 水平, y: 垂直})
  // o = { show, scoped, ads, gapPx, shotgun, holdBreath, moving, busy, zoom }
  update(dt, o) {
    // ---- 呼吸 ----
    const want = o.scoped && o.holdBreath && this.stam > 0 && this.tired <= 0;
    if (want) {
      this.stam -= dt / 3;
      if (this.stam <= 0) { this.stam = 0; this.tired = 3; }
    } else this.stam = Math.min(1, this.stam + dt / (this.tired > 0 ? 5 : 2.2));
    if (this.tired > 0) this.tired -= dt;
    this.hold += ((want ? 1 : 0) - this.hold) * Math.min(1, dt * 5);
    this.t += dt * (this.tired > 0 ? 1.7 : 1);
    this.jit *= Math.exp(-dt * 4);
    const A = 0.0042 * (1 - 0.93 * this.hold) * (o.moving ? 2.6 : 1) * (this.tired > 0 ? 1.9 : 1);
    const t = this.t;
    const sx = (Math.sin(t * 0.83) + 0.45 * Math.sin(t * 2.07 + 1.3)) * A + Math.sin(t * 23) * this.jit * 0.0012;
    const sy = (0.62 * Math.sin(t * 1.66) + 0.5 * Math.sin(t * 1.13 + 2.1)) * A + Math.cos(t * 19) * this.jit * 0.0015;
    const on = o.scoped ? 1 : 0;
    this.sway.x += (sx * on - this.sway.x) * Math.min(1, dt * 8);
    this.sway.y += (sy * on - this.sway.y) * Math.min(1, dt * 8);

    // ---- 狙擊鏡 ----
    if (o.show && o.scoped !== this.scopedOn) {
      this.scopedOn = o.scoped;
      this.scope.classList.toggle('on', o.scoped);
      if (o.scoped) this.blink.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 160, easing: 'ease-out' });
    }
    if (!o.show && this.scopedOn) { this.scopedOn = false; this.scope.classList.remove('on'); }
    if (this.scopedOn) {
      // 鏡筒陰影隨晃動/後座偏移(眼距視差)
      const px = this.size * 0.5;
      const tx = -this.sway.x * px * 9 - this.jit * 6, ty = this.sway.y * px * 9 + this.jit * 10;
      this.ox += (tx - this.ox) * Math.min(1, dt * 10);
      this.oy += (ty - this.oy) * Math.min(1, dt * 10);
      this.shade.style.transform = `translate(${this.ox.toFixed(1)}px,${this.oy.toFixed(1)}px)`;
      this.lens.style.transform = `translate(${(this.jit * 3).toFixed(1)}px,${(this.jit * 7).toFixed(1)}px)`;
      this.breathFill.style.width = `${(this.stam * 100).toFixed(0)}%`;
      this.breathBar.classList.toggle('tired', this.tired > 0);
    }

    // ---- 準心 ----
    const op = !o.show || o.scoped ? 0 : Math.max(0, 1 - o.ads * 1.8) * (o.busy ? 0.35 : 1);
    if (Math.abs(op - this.lastOp) > 0.01) { this.lastOp = op; this.ret.style.opacity = op.toFixed(2); }
    const kind = o.shotgun ? 'shotgun' : '';
    if (kind !== this.kind) { this.kind = kind; this.ret.className = kind; }
    const gap = Math.max(3, Math.min(120, o.gapPx));
    if (op > 0 && Math.abs(gap - this.lastGap) > 0.25) {
      this.lastGap = gap;
      const P = this.parts;
      P.t.style.transform = `translateY(${-gap.toFixed(1)}px)`;
      P.b.style.transform = `translateY(${gap.toFixed(1)}px)`;
      P.l.style.transform = `translateX(${-gap.toFixed(1)}px)`;
      P.r.style.transform = `translateX(${gap.toFixed(1)}px)`;
      const d = gap * 2;
      Object.assign(P.ring.style, { width: `${d.toFixed(1)}px`, height: `${d.toFixed(1)}px`, left: `${-gap.toFixed(1)}px`, top: `${-gap.toFixed(1)}px` });
    }
    return this.sway;
  }

  hide() {
    this.scopedOn = false;
    this.scope.classList.remove('on');
    this.ret.style.opacity = '0';
    this.lastOp = 0;
  }
}
