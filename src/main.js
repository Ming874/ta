import * as THREE from 'three';
import { Game } from './game.js';
import { Quality } from './sys/quality.js';
import { Perf } from './sys/perf.js';
import { caps } from './sys/caps.js';
import { idle } from './sys/sched.js';
import { precompile } from './sys/warmup.js';
import { backgroundTicker } from './sys/ticker.js';
import { texStats, texturesReady } from './sys/texworker.js';
import { prewarm, whenWarm, variantStats, getVariant, instantiate } from './zombies/model.js';
import { materials as zombieMaterials } from './zombies/materials.js';
import * as audio from './audio.js';

performance.mark('hz:boot');
installPWA();

const game = new Game(document.getElementById('game'));
game.bindInput();
window.__game = game; // 除錯用:在瀏覽器 console 操作 __game

// ---- 效能基礎建設 ----
game.renderer.info.autoReset = false; // 一幀內多個 pass 的 draw call 合計(主迴圈每幀歸零)
game.quality = new Quality(game); // 畫質預設檔 + 動態解析度(src/sys/quality.js)
game.perf = new Perf(game); // F3 效能面板(src/sys/perf.js)
prewarm(); // 殭屍變體:有 Worker 時立刻全部平行送到 Worker 池建模
performance.mark('hz:game');
window.__perfVariants = variantStats; // 測試用

game.perf.source('殭屍', () => {
  const v = variantStats();
  const alive = game.zombies ? game.zombies.filter((z) => z.alive).length : 0;
  return `${alive} 隻  變體 ${v.ready}/${v.total}(Worker ${v.worker}、同步 ${v.sync}${v.warmMs != null ? `、${v.warmMs}ms` : ''})`;
});
game.perf.source('貼圖', () => `Worker ${texStats.worker}  主執行緒 ${texStats.main}${texStats.pending ? `  畫圖中 ${texStats.pending}` : ''}`);
game.perf.source('物理', () => {
  const p = game.physics;
  if (!p) return null;
  const c = game.perf.custom.physics;
  const ms = c ? c.ms : p.stats?.ms ?? p.ms ?? p.stepMs ?? p.lastStepMs;
  return ms != null ? `${ms.toFixed(2)} ms${p.stats?.bodies != null ? `  剛體 ${p.stats.bodies}` : ''}` : '—';
});

// ---- 主迴圈 ----
let last = performance.now(), raf = 0;
function frame(now) {
  raf = requestAnimationFrame(frame);
  const dtMs = now - last;
  last = now;
  const dt = Math.min(0.05, Math.max(0, dtMs / 1000)); // dt 上限:卡頓或切回分頁時不會一次跳太遠
  game.renderer.info.reset();
  const t0 = performance.now();
  game.update(dt);
  const t1 = performance.now();
  game.quality.beginGpu();
  game.render();
  game.quality.endGpu();
  const t2 = performance.now();
  game.perf.frame(dtMs, t0, t1 - t0, t2 - t1);
  game.quality.sample(dtMs, t2 - t0);
}

// ---- 分頁隱藏:單人暫停(停止渲染、暫停音訊);連線中改由 Worker 計時器在背景繼續模擬(不渲染) ----
const bg = backgroundTicker((dt) => game.update(Math.min(0.05, dt)), 20);
let audioSuspended = false;
document.addEventListener('visibilitychange', () => {
  const ctx = audio._internal?.A?.ctx;
  if (document.hidden) {
    cancelAnimationFrame(raf);
    raf = 0;
    if (game.net) { bg.start(); return; }
    if (game.state === 'playing' && !game.paused && !game.shopUIOpen) { game.paused = true; game.ui.overlay?.('pause', true); }
    if (ctx && ctx.state === 'running') { ctx.suspend(); audioSuspended = true; }
  } else {
    bg.stop();
    if (audioSuspended && ctx) ctx.resume();
    audioSuspended = false;
    last = performance.now();
    if (!raf) raf = requestAnimationFrame(frame);
  }
});

// ---- 啟動:世界 shader 先在背景編好再開始畫(第一幀不會整個卡住),最多等 4 秒 ----
async function boot() {
  const t = performance.now();
  try {
    const all = Promise.all([
      precompile(game, game.scene),
      precompile(game, game.weaponScene, { target: game.weaponScene, camera: game.weaponCamera, shadows: false }),
    ]);
    const res = await Promise.race([all, new Promise((r) => setTimeout(() => r(null), 4000))]);
    if (res) game.perf.time('預編譯', performance.now() - t);
  } catch (e) { console.warn('[warmup]', e); }
  performance.measure('hz:precompile', { start: t });
  last = performance.now();
  if (!raf && !document.hidden) raf = requestAnimationFrame(frame);
  // 殭屍與常見特效材質:變體建好後在閒置時段預編譯,第一隻殭屍出現/第一槍不會頓一下
  whenWarm().then(() => idle(warmRuntime)).catch((e) => console.warn('[warmup]', e));
}
boot();

async function warmRuntime() {
  const g = new THREE.Group();
  const inst = instantiate(getVariant('walker', 0));
  const M = zombieMaterials();
  inst.mesh.material = [M.skin, M.cloth, M.gear, M.bone, M.hair, M.glow, ...Object.values(M.eye)]; // 只編譯、不渲染
  g.add(inst.mesh);
  // 執行期才會建立的常見材質型態(曳光、血池/貼花、光暈 sprite、粒子)
  const tex = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
  tex.colorSpace = THREE.SRGBColorSpace;
  g.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 0, -1)]), new THREE.LineBasicMaterial({ transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })));
  g.add(new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false })));
  g.add(new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true })));
  const res = await precompile(game, g);
  inst.mesh.skeleton.dispose();
  await texturesReady();
  performance.mark('hz:warm');
  return res;
}

// ---- PWA:manifest、圖示;正式版才註冊 Service Worker(public/sw.js) ----
function installPWA() {
  const head = document.head, base = import.meta.env.BASE_URL || '/';
  const link = (rel, href, extra = {}) => { if (head.querySelector(`link[rel="${rel}"]`)) return; const l = document.createElement('link'); l.rel = rel; l.href = href; Object.assign(l, extra); head.appendChild(l); };
  link('manifest', base + 'manifest.webmanifest');
  link('icon', base + 'icons/icon.svg', { type: 'image/svg+xml' });
  link('apple-touch-icon', base + 'icons/icon-192.png');
  if (!head.querySelector('meta[name="theme-color"]')) { const m = document.createElement('meta'); m.name = 'theme-color'; m.content = '#050606'; head.appendChild(m); }
  if (!import.meta.env.PROD || !('serviceWorker' in navigator) || caps.flags.has('nosw')) return;
  // 版本號 = 主程式檔名的雜湊(每次 build 內容有變就換),Service Worker 依此切換快取
  const v = new URL(import.meta.url).pathname.split('/').pop().replace(/\.js$/, '');
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(`${base}sw.js?v=${encodeURIComponent(v)}`, { scope: base }).catch((e) => console.warn('[sw]', e.message));
  });
}
