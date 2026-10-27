import { Hud } from './ui/hud.js';
import { ShopUI } from './ui/shop.js';
import { MapUI } from './ui/map.js';
import { Menu } from './ui/menu.js';
import { settings } from './ui/settings.js';

const $ = (id) => document.getElementById(id);

// 介面總管:HUD(src/ui/hud.js)、商店(src/ui/shop.js)、地圖(src/ui/map.js)、選單與設定(src/ui/menu.js)。
// 保留舊的方法名稱(setHP / setAmmo / banner / prompt / pickup …)給其他模組直接呼叫。
export class UI {
  constructor() {
    this.hudEl = $('hud');
    this.hud = new Hud(this.hudEl);
    this.shop = new ShopUI(this);
    this.map = new MapUI(this);
    this.menu = new Menu(this);
    this.hitTimer = 0;
    this.onHit = null; // 命中統計(flow.js 設定)
    this._lastHurt = null;
    this._lastHp = null;
  }

  attach(game) {
    this.game = game;
    this.menu.attach(game);
  }

  showHud(on) { this.hudEl.classList.toggle('on', on); }

  overlay(id, on) {
    if (id === 'shop') { if (on) { if (this.game) this.game.openShop(); } else this.game?.closeShop(false); return; }
    const el = $(id);
    if (el) el.classList.toggle('on', on);
    if (id === 'pause') this.menu.onPause(on);
  }

  // ---------- HUD(轉給 Hud) ----------
  setHP(hp, max) { this.hud.setHP(hp, max); }
  setArmor(a, max) { this.hud.setArmor(a, max); }
  setAmmo(name, mag, reserve, reloading, cap) { this.hud.setAmmo(name, mag, reserve, reloading, cap); }
  setCoins(n, instant = false) { this.hud.setCoins(n, instant); }
  setScore(n, instant = false) { this.hud.setScore(n, instant); }
  streak(n, mul, gap) { this.hud.streak(n, mul, gap); }
  coinGain(n) { this.hud.coinGain(n); }
  spend(n) { this.hud.spend(n); }
  pickup(text, color, o) { this.hud.pickup(text, color, o); }
  setRound(n) { this.hud.setRound(n); }
  setZombies(n) { this.hud.setZombies(n); }
  setRest(sec) { this.hud.setRest(sec); }
  setRoundText(html) { this.hud.setRoundText(html); }
  banner(text, sub = '', ms = 3500, cls = '') { this.hud.banner(text, sub, ms, cls); }
  prompt(text, dim = false) { this.hud.prompt(text, dim); }
  feed(text, o = {}) { this.hud.feed(text, o); } // 右側訊息列(多人時連線模組也會用)
  killPop(n, tag, kind) { this.hud.killPop(n, tag, kind); }
  healing(k) { this.hud.healing(k); }
  showDeath(summary) { this.menu.showDeath(summary); }
  resetRun() { this.hud.reset(); this._lastHurt = null; this._lastHp = null; }

  hitMarker(head) {
    const el = $('hit');
    if (el) {
      el.className = head ? 'head' : '';
      el.style.opacity = 1;
      clearTimeout(this.hitTimer);
      this.hitTimer = setTimeout(() => { el.style.opacity = 0; }, 120);
    }
    this.onHit?.(head);
  }

  damageFlash() {
    if (!settings.get('hurtFx')) return;
    const el = $('damage');
    if (!el) return;
    el.style.transition = 'none';
    el.style.opacity = 0.9;
    requestAnimationFrame(() => {
      el.style.transition = 'opacity .6s';
      el.style.opacity = 0;
    });
  }

  // 每幀(遊戲進行中、未暫停)
  update(game, dt) {
    const p = game.player;
    this.hud.setHP(p.hp, p.maxHp);
    this.hud.setArmor(p.armor, p.maxArmor);
    this.hud.setStamina(p.stamina);
    this.hud.setInv(p.grenades || 0, p.medkits || 0);
    // 受傷方向:用 lastHurtFrom(讀完就清掉,避免沒有來源的傷害沿用舊方向)
    if (p.lastHurt !== this._lastHurt) {
      const dmg = this._lastHp != null ? this._lastHp - p.hp : 10;
      this._lastHurt = p.lastHurt;
      if (p.lastHurtFrom && settings.get('hurtFx')) this.hud.hurt(p.lastHurtFrom.x, p.lastHurtFrom.z, Math.min(1, Math.max(0.2, dmg / 25)));
      p.lastHurtFrom = null;
    }
    this._lastHp = p.hp;
    this.hud.update(game, dt);
    if (this.map.isOpen) this.map.update(game);
  }
}
