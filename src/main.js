import { Game } from './game.js';
import { initNet } from './net/lobby.js';

const game = new Game(document.getElementById('game'));
game.bindInput();
initNet(game); // [net] 主選單的多人連線入口(src/net/lobby.js)
window.__game = game; // 除錯用:在瀏覽器 console 操作 __game

let last = performance.now();
function loop(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  game.update(dt);
  game.render();
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
