import * as THREE from 'three';
import './shop.css';
import { ICON } from './icons.js';
import { WEAPONS } from '../weapons/weapon.js';
import { createDisplayGun } from '../weapons/models.js';
import { pickupModel } from '../pickups.js';
import { buildVest, statOf, baseStats, moddedStats, MOD_DEFS, roman, weaponName } from '../shop.js';
import { sfx } from '../audio.js';

// 補給站商店介面:分頁(武器/改裝/裝備/補給)、左側清單、右側 3D 預覽 + 數值條 + 購買。
// 3D 預覽用獨立的小 WebGLRenderer,只在商店開啟時運作,關閉時釋放。
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const STAT_ROWS = [['damage', '傷害'], ['rate', '射速'], ['accuracy', '精準'], ['range', '射程'], ['mobility', '機動']];
const KIND_ICON = { weapon: 'ammo', mod: 'gear', vest_light: 'vest', vest_heavy: 'vest', grenade: 'grenade', medkit: 'medkit', ammo_all: 'ammo', ammo_cur: 'ammo' };
const fmt = (v, d = 0) => (Math.round(v * 10 ** d) / 10 ** d).toFixed(d);

// ---------- 3D 預覽 ----------
class Preview {
  constructor(host) {
    this.host = host;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(28, 1, 0.01, 50);
    this.camera.position.set(0, 0.42, 3.6);
    this.camera.lookAt(0, 0, 0);
    this.scene.add(new THREE.HemisphereLight(0xfff2e2, 0x2a2420, 1.25));
    const key = new THREE.DirectionalLight(0xfff0dc, 2.8);
    key.position.set(2.2, 3, 2.6);
    const rim = new THREE.DirectionalLight(0xffb070, 2.2);
    rim.position.set(-3, 1.4, -2.5);
    const fill = new THREE.DirectionalLight(0x9fb8d0, 0.8);
    fill.position.set(-2, -0.5, 2);
    this.scene.add(key, rim, fill);
    // 地面陰影圓盤
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const x = c.getContext('2d'), g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
    g.addColorStop(0, 'rgba(0,0,0,.55)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    x.fillStyle = g; x.fillRect(0, 0, 128, 128);
    this.shadow = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 1.2), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false }));
    this.shadow.rotation.x = -Math.PI / 2;
    this.scene.add(this.shadow);
    this.pivot = new THREE.Group();
    this.scene.add(this.pivot);
    this.rotY = -1.2;
    this.tilt = 0.12;
    this.auto = 1;
    this.key = '';
    this.own = []; // 需要釋放的資源(背心的材質/貼圖)
    host.addEventListener('pointerdown', (e) => {
      this.drag = { x: e.clientX, y: e.clientY };
      this.auto = 0;
      host.setPointerCapture?.(e.pointerId);
    });
    host.addEventListener('pointermove', (e) => {
      if (!this.drag) return;
      this.rotY += (e.clientX - this.drag.x) * 0.012;
      this.tilt = Math.max(-0.5, Math.min(0.7, this.tilt + (e.clientY - this.drag.y) * 0.006));
      this.drag = { x: e.clientX, y: e.clientY };
    });
    const up = () => { this.drag = null; clearTimeout(this.autoT); this.autoT = setTimeout(() => { this.auto = 1; }, 2500); };
    host.addEventListener('pointerup', up);
    host.addEventListener('pointercancel', up);
  }

  start() {
    if (this.renderer) return;
    // 每次開啟都換新的 canvas(釋放後舊 canvas 的 context 已遺失)
    this.canvas?.remove();
    this.canvas = document.createElement('canvas');
    this.host.prepend(this.canvas);
    try {
      this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: true, powerPreference: 'low-power' });
    } catch { this.renderer = null; return; }
    const r = this.renderer;
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.05;
    r.setClearColor(0x000000, 0);
    this.resize();
    this._onResize = () => this.resize();
    window.addEventListener('resize', this._onResize);
    let last = performance.now();
    const loop = (now) => {
      if (!this.renderer) return;
      this.raf = requestAnimationFrame(loop);
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      if (this.auto) this.rotY += dt * 0.45;
      this.pivot.rotation.set(this.tilt, this.rotY, 0, 'XYZ');
      this.renderer.render(this.scene, this.camera);
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop() {
    cancelAnimationFrame(this.raf);
    if (this._onResize) window.removeEventListener('resize', this._onResize);
    if (this.renderer) {
      this.renderer.dispose();
      this.renderer.forceContextLoss();
      this.renderer = null;
    }
    this.canvas?.remove();
    this.canvas = null;
    this.clear();
    this.key = '';
  }

  resize() {
    if (!this.renderer) return;
    const w = Math.max(10, this.host.clientWidth), h = Math.max(10, this.host.clientHeight);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  clear() {
    this.pivot.clear();
    for (const o of this.own) o.dispose?.();
    this.own.length = 0;
  }

  // 依商品顯示模型
  show(pv) {
    const key = pv ? `${pv.type}:${pv.id || ''}` : '';
    if (key === this.key) return;
    this.key = key;
    this.clear();
    if (!pv) return;
    this.rotY = pv.type === 'gun' ? 0.32 : pv.type.startsWith('vest') ? 0.45 : 0.62; // 每個商品從好看的角度開始轉
    this.tilt = pv.type === 'gun' ? 0.1 : 0.22;
    this.auto = 1;
    let obj = null;
    if (pv.type === 'gun') {
      try { obj = createDisplayGun(pv.id); } catch { obj = null; }
      if (obj) { const w = new THREE.Group(); obj.rotation.y = Math.PI / 2; w.add(obj); obj = w; }
    } else if (pv.type === 'vest_light' || pv.type === 'vest_heavy') {
      obj = buildVest(pv.type === 'vest_heavy');
      obj.traverse((o) => { if (o.isMesh) { this.own.push(o.geometry); if (!this.own.includes(o.material)) this.own.push(o.material, o.material.map); } });
    } else if (pv.type === 'grenade') {
      obj = new THREE.Group();
      for (const [x, ry] of [[-0.05, 0.4], [0.05, -0.7]]) { const g = pickupModel('grenade'); g.position.set(x, 0, x * 0.6); g.rotation.set(0, ry, x * 3); obj.add(g); }
    } else if (pv.type === 'medkit') obj = pickupModel('med');
    else if (pv.type === 'ammo' || pv.type === 'bigammo') obj = pickupModel(pv.type);
    if (!obj) { // 尚未有模型:問號板
      obj = new THREE.Mesh(new THREE.BoxGeometry(1, 0.2, 0.05), new THREE.MeshStandardMaterial({ color: 0x3a3c3a, roughness: 0.6 }));
      this.own.push(obj.geometry, obj.material);
    }
    // 置中並縮放到固定大小
    const wrap = new THREE.Group();
    wrap.add(obj);
    const box = new THREE.Box3().setFromObject(wrap);
    const size = box.getSize(new THREE.Vector3()), c = box.getCenter(new THREE.Vector3());
    const s = 1.75 / Math.max(size.x, size.y * 1.6, size.z, 1e-3);
    obj.position.sub(c);
    wrap.scale.setScalar(s);
    this.pivot.add(wrap);
    this.shadow.position.y = -size.y * s * 0.5 - 0.02;
    this.shadow.scale.set(Math.max(0.6, size.x * s * 0.6), 1, 1);
  }
}

// ---------- 商店介面 ----------
export class ShopUI {
  constructor(ui) {
    this.ui = ui;
    this.tabIx = 0;
    this.sel = {};
    this.isOpen = false;
    const root = (this.root = document.createElement('div'));
    root.id = 'shopui';
    root.innerHTML = `
      <div class="sh-panel">
        <div class="sh-head">
          <div class="sh-title"><b>補給站</b><small>SACRED HEART · SUPPLY STATION</small></div>
          <div class="sh-rest"></div>
          <div class="sh-coins">${ICON.coin}<span>0</span></div>
        </div>
        <div class="sh-tabs"></div>
        <div class="sh-body">
          <div class="sh-list"></div>
          <div class="sh-detail">
            <div class="sh-view"><span class="badge"></span><span class="hint">拖曳旋轉</span></div>
            <div class="sh-info"></div>
          </div>
        </div>
        <div class="sh-foot">
          <span><kbd>1</kbd>–<kbd>4</kbd>分頁</span><span><kbd>↑</kbd><kbd>↓</kbd>選擇</span><span><kbd>Enter</kbd>購買</span><span><kbd>E</kbd><kbd>Esc</kbd>離開</span>
          <span class="sp"></span>
          <button class="sh-btn ghost" data-act="close">離開<kbd>E</kbd></button>
          <button class="sh-btn ghost" id="shopNext">開始下一回合<kbd>N</kbd></button>
        </div>
        <div class="sh-toast"></div>
      </div>`;
    document.body.appendChild(root);
    const q = (s) => root.querySelector(s);
    this.panel = q('.sh-panel');
    this.tabsEl = q('.sh-tabs');
    this.listEl = q('.sh-list');
    this.infoEl = q('.sh-info');
    this.restEl = q('.sh-rest');
    this.coinBox = q('.sh-coins');
    this.coinEl = q('.sh-coins span');
    this.badge = q('.sh-view .badge');
    this.toastEl = q('.sh-toast');
    this.preview = new Preview(q('.sh-view'));

    // 滑鼠(事件委派)
    this.tabsEl.addEventListener('click', (e) => { const t = e.target.closest('.sh-tab'); if (t) this.setTab(+t.dataset.i); });
    this.listEl.addEventListener('click', (e) => { const it = e.target.closest('.sh-item'); if (it) this.select(it.dataset.key, true); });
    this.listEl.addEventListener('dblclick', (e) => { const it = e.target.closest('.sh-item'); if (it) { this.select(it.dataset.key); this.buy(); } });
    this.listEl.addEventListener('mouseover', (e) => {
      const it = e.target.closest('.sh-item');
      if (!it || it.dataset.key === this._hoverKey) return;
      this._hoverKey = it.dataset.key;
      const now = performance.now();
      if (now - (this._hoverT || 0) > 70) { this._hoverT = now; sfx.shopHover(); }
    });
    this.infoEl.addEventListener('click', (e) => { if (e.target.closest('[data-act="buy"]')) this.buy(); });
    q('[data-act="close"]').addEventListener('click', () => this.game?.closeShop(true));
    root.addEventListener('mousedown', (e) => { if (e.target === root) this.game?.closeShop(true); }); // 點面板外關閉
  }

  get tabs() { return this._tabs || []; }
  get tab() { return this.tabs[this.tabIx] || { items: [] }; }
  get items() { return this.tab.items.filter((i) => !i.header); }
  get item() { return this.items.find((i) => i.key === this.sel[this.tab.id]) || this.items[0] || null; }

  open(game) {
    this.game = game;
    this.isOpen = true;
    this.root.classList.add('on');
    this.coinShown = game.player.coins;
    this.coinEl.textContent = this.coinShown;
    // 預設分頁:沒有可買的武器時跳到補給
    this.refresh();
    this.preview.start();
    this.preview.show(this.item?.preview);
  }

  close() {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.root.classList.remove('on');
    this.preview.stop();
  }

  coins(n) {
    if (!this.isOpen) return;
    this.coinEl.textContent = n;
    this.coinBox.classList.remove('bump');
    void this.coinBox.offsetWidth; // 重新觸發動畫(只在購買時)
    this.coinBox.classList.add('bump');
  }

  refresh() {
    this._tabs = this.game.shopTabs();
    this.renderTabs();
    this.renderList();
    this.renderInfo();
    const g = this.game;
    this.restEl.innerHTML = g.phase === 'shop' ? `休息剩餘<b>${Math.max(0, Math.ceil(g.restT))}</b>秒 · 購物時暫停` : '';
  }

  renderTabs() {
    this.tabsEl.innerHTML = this.tabs.map((t, i) => {
      const n = t.items.filter((x) => !x.header && x.state === 'buy').length;
      return `<div class="sh-tab${i === this.tabIx ? ' on' : ''}" data-i="${i}"><kbd>${i + 1}</kbd>${esc(t.name)}${n ? `<span class="cnt">${n}</span>` : ''}</div>`;
    }).join('');
  }

  renderList() {
    const t = this.tab, cur = this.item;
    if (!this.items.length) { this.listEl.innerHTML = `<div class="sh-empty">${esc(t.empty || '目前沒有商品')}</div>`; return; }
    this.listEl.innerHTML = t.items.map((it) => {
      if (it.header) return `<div class="sh-group">${esc(it.name)}</div>`;
      const wIcon = (id) => (id === 'revolver' || id === 'pistol' ? 'pistol' : id === 'barrett' ? 'sniper' : 'rifle');
      const icon = ICON[it.kind === 'weapon' ? wIcon(it.id) : it.icon || KIND_ICON[it.kind === 'mod' ? 'mod' : it.id] || 'ammo'];
      let right;
      if (it.state === 'owned') right = '<span class="tag own">已擁有</span>';
      else if (it.state === 'equipped') right = '<span class="tag eq">使用中</span>';
      else if (it.state === 'max') right = `<span class="tag max">${it.kind === 'mod' ? '已滿級' : '已滿'}</span>`;
      else if (it.state === 'na') right = '<span class="tag na">未到貨</span>';
      else right = `<span class="pr">${ICON.coin}${it.price}</span>`;
      const pips = it.kind === 'mod' ? `<span class="sh-pips">${Array.from({ length: it.max }, (_, k) => `<i class="${k < it.level ? 'on' : ''}"></i>`).join('')}</span>` : '';
      const name = it.kind === 'mod' ? `${esc(MOD_DEFS[it.mod].name)}${pips}` : esc(it.name);
      return `<div class="sh-item ${it.state}${cur && it.key === cur.key ? ' sel' : ''}" data-key="${esc(it.key)}"><span class="ic">${icon}</span><span class="nm"><b>${name}</b><small>${esc(it.sub || '')}</small></span>${right}</div>`;
    }).join('');
    this.listEl.querySelector('.sel')?.scrollIntoView({ block: 'nearest' });
  }

  renderInfo() {
    const it = this.item, g = this.game, w = g.weapons, p = g.player;
    if (!it) { this.infoEl.innerHTML = ''; this.preview.show(null); this.badge.textContent = ''; return; }
    this.preview.show(it.preview);
    this.badge.textContent = it.kind === 'weapon' ? 'WEAPON' : it.kind === 'mod' ? 'MODIFICATION' : it.kind === 'gear' ? 'EQUIPMENT' : 'SUPPLY';
    let stats = '', facts = '';
    if (it.kind === 'weapon' || it.kind === 'mod') {
      const id = it.weapon, def = WEAPONS[id];
      const mods = w.mods?.[id] || {};
      const cur = it.kind === 'weapon' && !w.has(id) ? baseStats(id) : moddedStats(id, mods);
      let nxt = cur;
      if (it.kind === 'mod' && it.state !== 'max') nxt = moddedStats(id, { ...mods, [it.mod]: MOD_DEFS[it.mod].mul[it.level + 1] });
      stats = `<div class="sh-stats">${STAT_ROWS.map(([k, label]) => {
        const a = cur[k] ?? 0, b = nxt[k] ?? a, up = b > a + 1e-3;
        return `<span>${label}</span><div class="sh-bar"><i class="nx" style="transform:scaleX(${Math.max(a, b).toFixed(3)})"></i><i class="cur" style="transform:scaleX(${a.toFixed(3)})"></i></div><em class="${up ? 'up' : ''}">${Math.round(b * 100)}</em>`;
      }).join('')}</div>`;
      if (def) {
        const m = (k) => (it.kind === 'mod' && it.mod === k && it.state !== 'max' ? MOD_DEFS[k].mul[it.level + 1] : mods[k] ?? 1);
        const base = (k) => statOf(w, id, k);
        const show = (k) => {
          const now = w.has(id) ? base(k) : def[k];
          const after = def[k] * m(k);
          return { now, after, up: it.kind === 'mod' && it.mod === k && it.state !== 'max' };
        };
        const dm = show('damage'), mg = show('mag'), rl = show('reload'), sp = show('spread');
        const pel = def.pellets ? ` ×${def.pellets}` : '';
        const f = (o, d, unit = '') => (o.up ? `<b>${fmt(o.now, d)}${unit}</b> → <b class="up">${fmt(o.after, d)}${unit}</b>` : `<b>${fmt(o.now, d)}${unit}</b>`);
        facts = `<div class="sh-facts"><span>傷害${f(dm, dm.now % 1 ? 1 : 0)}${pel}</span><span>彈匣${it.mod === 'mag' && mg.up ? `<b>${Math.round(mg.now)}</b> → <b class="up">${Math.round(mg.after)}</b>` : `<b>${Math.round(mg.now)}</b>`}</span><span>換彈${f(rl, 2, 's')}</span><span>射速<b>${def.rpm}</b> RPM</span>${it.mod === 'spread' ? `<span>散布${f(sp, 4)}</span>` : ''}${def.auto ? '<span><b>全自動</b></span>' : ''}</div>`;
      }
    } else if (it.id === 'vest_light' || it.id === 'vest_heavy') {
      const armor = it.id === 'vest_heavy' ? 100 : 50;
      facts = `<div class="sh-facts"><span>護甲<b>${armor}</b></span><span>吸收<b>60%</b>傷害</span><span>目前護甲<b>${Math.ceil(p.armor || 0)}</b> / ${p.maxArmor || 0}</span></div>`;
    } else if (it.id === 'grenade') facts = `<div class="sh-facts"><span>持有<b>${p.grenades || 0}</b> / 6</span><span>投擲鍵<b>G</b></span><span>爆炸半徑<b>約 6m</b></span></div>`;
    else if (it.id === 'medkit') facts = `<div class="sh-facts"><span>持有<b>${p.medkits || 0}</b> / 3</span><span>使用鍵<b>H</b></span><span>回復<b>50</b> / 2 秒</span></div>`;
    else if (it.kind === 'supply') {
      const ids = it.id === 'ammo_cur' ? [w.current] : Object.keys(w.inv).filter((id) => WEAPONS[id]);
      facts = `<div class="sh-facts">${ids.map((id) => `<span>${esc(weaponName(id))}<b>${w.inv[id].mag}/${w.inv[id].reserve}</b> → <b class="up">${statOf(w, id, 'mag')}/${WEAPONS[id].reserveCap}</b></span>`).join('')}</div>`;
    }
    const st = it.state;
    const label = st === 'owned' ? '裝備' : st === 'equipped' ? '使用中' : st === 'max' ? (it.kind === 'mod' ? '已滿級' : '已滿') : st === 'na' ? '未到貨' : '購買';
    const disabled = st === 'equipped' || st === 'max' || st === 'na';
    const price = st === 'owned' || st === 'equipped' || st === 'na' || (st === 'max' && it.kind === 'mod') ? '' : `<div class="sh-price${st === 'poor' ? ' poor' : ''}">${ICON.coin}${it.price}</div>`;
    const title = it.kind === 'mod' ? `${esc(MOD_DEFS[it.mod].name)} ${it.state === 'max' ? roman(it.max) : roman(it.level + 1)}<small>${esc(weaponName(it.weapon))} · 等級 ${it.level}/${it.max}</small>` : `${esc(it.name)}${it.sub ? `<small>${esc(it.sub)}</small>` : ''}`;
    this.infoEl.innerHTML = `<h3>${title}</h3><div class="sh-buy">${price}<button class="sh-btn" data-act="buy" ${disabled ? 'disabled' : ''}>${label}<kbd>Enter</kbd></button></div>
      <div class="sh-desc">${esc(it.desc || '')}</div>${stats}${facts}`;
  }

  setTab(i) {
    const n = this.tabs.length;
    i = ((i % n) + n) % n;
    if (i === this.tabIx) return;
    this.tabIx = i;
    sfx.shopTab();
    this.renderTabs();
    this.renderList();
    this.renderInfo();
  }

  select(key, sound = false) {
    if (this.sel[this.tab.id] === key) return;
    this.sel[this.tab.id] = key;
    if (sound) sfx.uiClick();
    for (const el of this.listEl.querySelectorAll('.sh-item')) el.classList.toggle('sel', el.dataset.key === key);
    this.listEl.querySelector('.sel')?.scrollIntoView({ block: 'nearest' });
    this.renderInfo();
  }

  move(d) {
    const list = this.items;
    if (!list.length) return;
    const i = Math.max(0, list.findIndex((x) => x.key === this.item?.key));
    this.select(list[(i + d + list.length) % list.length].key);
    sfx.shopHover();
  }

  buy() {
    const it = this.item;
    if (!it || !this.game) return;
    const key = it.key;
    const r = this.game.buy(it);
    const oldCoins = this.coinShown;
    this.refresh();
    if (r.ok) {
      this.coinShown = this.game.player.coins;
      if (!r.equip) this.coins(this.coinShown);
      this.toast(r.equip ? r.msg : `${r.msg} · −${r.price}`, 'ok');
      const el = this.listEl.querySelector(`[data-key="${CSS.escape(key)}"]`);
      el?.classList.add('ok-flash');
      if (!r.equip && oldCoins !== this.coinShown) this._float(`−${r.price}`);
      const btn = this.infoEl.querySelector('.sh-btn');
      btn?.animate([{ filter: 'brightness(1.8)' }, { filter: 'none' }], { duration: 400 });
    } else {
      this.toast(r.msg || '無法購買', r.reason === 'max' ? 'max' : 'bad');
      this.infoEl.querySelector('.sh-price')?.classList.add('shake');
      this.panel.animate([{ transform: 'translateX(0)' }, { transform: 'translateX(-4px)' }, { transform: 'translateX(4px)' }, { transform: 'none' }], { duration: 220 });
    }
  }

  _float(text) {
    const pr = this.coinBox.getBoundingClientRect(), pp = this.panel.getBoundingClientRect();
    const f = document.createElement('div');
    f.className = 'sh-float';
    f.textContent = text;
    f.style.left = `${pr.left - pp.left + 20}px`;
    f.style.top = `${pr.bottom - pp.top + 2}px`;
    this.panel.appendChild(f);
    f.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateY(26px)' }], { duration: 900, easing: 'ease-in' }).onfinish = () => f.remove();
  }

  toast(text, kind = 'ok') {
    const t = this.toastEl;
    t.textContent = text;
    t.className = `sh-toast ${kind}`;
    t.getAnimations().forEach((a) => a.cancel());
    t.animate([{ opacity: 0, transform: 'translate(-50%, -6px)' }, { opacity: 1, transform: 'translate(-50%, 0)', offset: 0.12 }, { opacity: 1, offset: 0.8 }, { opacity: 0 }], { duration: 1800, easing: 'ease-out' });
  }

  // 由遊戲的按鍵處理轉來(商店開啟時所有按鍵都到這裡)
  onKey(e) {
    const g = this.game;
    const c = e.code;
    const dig = /^Digit([1-4])$/.exec(c) || /^Numpad([1-4])$/.exec(c);
    if (dig) { this.setTab(+dig[1] - 1); return; }
    switch (c) {
      case 'ArrowUp': case 'KeyW': e.preventDefault(); this.move(-1); break;
      case 'ArrowDown': case 'KeyS': e.preventDefault(); this.move(1); break;
      case 'ArrowLeft': case 'KeyA': case 'KeyQ': this.setTab(this.tabIx - 1); break;
      case 'ArrowRight': case 'KeyD': case 'Tab': e.preventDefault(); this.setTab(this.tabIx + 1); break;
      case 'Enter': case 'NumpadEnter': case 'Space': e.preventDefault(); this.buy(); break;
      case 'KeyE': g.closeShop(true); break;
      case 'Escape': g.closeShop(false); g.paused = true; g.ui.overlay('pause', true); break;
      case 'KeyN': g.nextRound(); break;
      default:
    }
  }
}
