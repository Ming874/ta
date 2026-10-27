// 靈異系統入口:game.horror(驚嚇導演、耳語、幻影、靈異事件、寒氣)。全部是本機效果:多人時每位玩家聽到/看到的都不一樣(刻意的)。
import { Director } from './director.js';
import { settings } from '../ui/settings.js';

export function installHorror(game) {
  const subs = {};
  const H = {
    game, settings,
    director: null,
    on(ev, fn) { (subs[ev] ||= new Set()).add(fn); return () => subs[ev].delete(fn); },
    emit(ev, d) { const s = subs[ev]; if (s) for (const fn of s) { try { fn(d); } catch (e) { console.warn('[horror]', ev, e); } } },
    update(dt) {
      if (game.state !== 'playing') { H._st = game.state; return; }
      if (H._st !== 'playing') { H._st = 'playing'; H.director.reset(); }
      if (game.paused && !game.net) return;
      H.director.update(dt, game);
    },
  };
  H.director = new Director(H);
  game.horror = H;
  return H;
}
