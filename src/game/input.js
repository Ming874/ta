import { ORDER } from '../weapons/weapon.js';
import { resume as resumeAudio } from '../audio.js';

// 鍵盤/滑鼠/指標鎖定與選單按鈕。以 mixin 方式掛到 Game 上
// 右鍵:按住開鏡;G:手榴彈;V:小刀;1~6:切換武器;滾輪:循環武器;巴雷特開鏡時 Shift 改為屏息;C:蹲下(player.js)
export const inputMethods = {
  bindInput() {
    const canvas = this.canvas;
    const inp = this.input;
    inp.aimHeld = false;
    inp.shift = false;
    const playing = () => this.state === 'playing' && !this.paused && !this.shopUIOpen;
    document.addEventListener('pointerlockchange', () => {
      const locked = document.pointerLockElement === canvas;
      if (!locked && this.state === 'playing' && !this.shopUIOpen && !this.bookOpen) { // [story] 推理本開著:放開滑鼠是故意的
        this.paused = true;
        this.ui.overlay('pause', true);
      }
      if (!locked) { inp.fireHeld = false; inp.aimHeld = false; }
      if (locked) {
        this.paused = false;
        this.ui.overlay('pause', false);
        this.ui.overlay('menu', false);
      }
    });
    document.addEventListener('mousemove', (e) => {
      if (document.pointerLockElement !== canvas || this.state !== 'playing') return;
      this.player.look(e.movementX, e.movementY);
      this.look.x += e.movementX;
      this.look.y += e.movementY;
    });
    document.addEventListener('mousedown', (e) => {
      if (document.pointerLockElement !== canvas) return;
      if (e.button === 0) { inp.fireHeld = true; inp.firePressed = true; }
      else if (e.button === 2) inp.aimHeld = true;
    });
    document.addEventListener('mouseup', (e) => {
      if (e.button === 0) inp.fireHeld = false;
      else if (e.button === 2) inp.aimHeld = false;
    });
    document.addEventListener('contextmenu', (e) => { if (this.state === 'playing') e.preventDefault(); });
    document.addEventListener('wheel', (e) => {
      if (playing() && !this.weapons.busy) this.weapons.cycle(e.deltaY > 0 ? 1 : -1);
    });
    document.addEventListener('keydown', (e) => {
      if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') inp.shift = true;
      this.player.keys[e.code] = true;
      if (this.state !== 'playing') return;
      // E(商店/補給櫃)、N、H、M 與商店介面內的按鍵由 flow.js 的 onGameplayKey(捕獲階段)處理
      if (e.code === 'Escape' && this.shopUIOpen) this.closeShop(false), this.ui.overlay('pause', true), (this.paused = true);
      if (this.paused || this.shopUIOpen) {
        if (e.code === 'KeyN' && this.phase === 'shop') this.nextRound();
        return;
      }
      if (e.repeat) return;
      if (e.code === 'KeyR') this.weapons.startReload();
      if (e.code === 'KeyF') this.player.toggleFlashlight();
      if (e.code === 'KeyG') this.throwGrenade();
      if (e.code === 'KeyV') this.melee();
      if (e.code === 'KeyN' && (this.phase === 'shop' || this.phase === 'break')) this.nextRound();
      const m = /^Digit([1-9])$/.exec(e.code);
      if (m) {
        const id = ORDER[Number(m[1]) - 1];
        if (id && this.weapons.has(id) && !this.weapons.busy) this.weapons.switchTo(id);
      }
    });
    document.addEventListener('keyup', (e) => {
      if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') inp.shift = false;
      this.player.keys[e.code] = false;
    });
    window.addEventListener('blur', () => { this.player.keys = {}; inp.fireHeld = false; inp.aimHeld = false; inp.shift = false; });

    const lock = () => { resumeAudio(); canvas.requestPointerLock(); };
    const startSingle = () => {
      document.getElementById('menu').classList.remove('on');
      this.ui.showHud(true);
      this.begin();
      lock();
    };
    // 主選單「單人生存」:有開局演出(ui.menu.beforeStart,例如隨機抽地圖)就先跑完再開始
    document.getElementById('startBtn').onclick = () => {
      const hooks = this.ui.menu?.beforeStart || [];
      if (!hooks.length) { startSingle(); return; }
      hooks.reduce((p, f) => p.then(() => f()), Promise.resolve()).catch((e) => console.warn('[menu] beforeStart', e)).then(startSingle);
    };
    document.getElementById('resumeBtn').onclick = lock;
    document.getElementById('pause').onclick = lock;
    document.getElementById('restartBtn').onclick = () => {
      this.ui.overlay('dead', false);
      this.begin();
      lock();
    };
    document.getElementById('shopNext').onclick = () => this.nextRound();
  },
};
