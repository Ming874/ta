import * as THREE from 'three';
import { Game } from './game.js';
import { Quality } from './sys/quality.js';
import { Perf } from './sys/perf.js';
import { caps } from './sys/caps.js';
import { idle } from './sys/sched.js';
import { precompile, precompilePasses, initPrograms, warmDraw, warmDrawScene, yieldNow } from './sys/warmup.js';
import { backgroundTicker } from './sys/ticker.js';
import { texStats, texturesReady } from './sys/texworker.js';
import { prewarm, whenWarm, variantStats, getVariant, instantiate } from './zombies/model.js';
import { materials as zombieMaterials } from './zombies/materials.js';
import * as audio from './audio.js';
import { initNet } from './net/lobby.js';
import { startPhysicsWorker, physicsLoad } from './physics/index.js';
import { assets } from './sys/assets.js';
import { installStreaming } from './sys/stream.js';
import { loadUI } from './sys/loadui.js';
import { pools } from './sys/workers.js';

performance.mark('hz:boot');
installPWA();

// ---- 關鍵檔先下載:物理 Worker(+WASM)與殭屍建模 Worker 在建世界(數秒的同步工作)之前就開始抓;
//      貼圖/模型在 assets 佇列等閘門打開(關鍵檔就緒、最多 12 秒、或玩家按開始)才依距離排序下載 ----
startPhysicsWorker();
prewarm();
// Chrome 的模組 Worker 要主執行緒有空檔才會真正開始執行;接下來建世界是好幾秒的同步工作 →
// 先讓出主執行緒到 Worker 開機(腳本已下載並執行:物理開始抓 WASM、殭屍開始在背景建模),最多等 1.5 秒
await new Promise((resolve) => {
  const t0 = performance.now();
  const tick = () => {
    const ph = physicsLoad.state, mp = pools.find((p) => p.name === 'model');
    const physUp = ph !== 'script', modelUp = !mp || mp.failed || mp.slots.some((s) => s.ready);
    if ((physUp && modelUp) || performance.now() - t0 > 1500) resolve(); else setTimeout(tick, 10);
  };
  tick();
});
let game = null;
const loading = loadUI(() => {
  const p = game?.physics, v = variantStats(), a = assets.progress, ph = physicsLoad.state;
  const physOK = !p ? 0 : p.ready || p.failed || ph === 'off' || ph === 'failed' ? 1 : ph === 'wasm' || ph === 'main' ? 0.55 : 0.15;
  const fin = a.done + a.failed;
  return {
    playing: game?.state === 'playing',
    steps: [
      ['物理', physOK, ph === 'wasm' ? '編譯中' : ph === 'main' ? '載入中' : '下載中'],
      ['殭屍', v.ready / v.total, `${v.ready}/${v.total}`],
      ['貼圖與模型', a.total ? fin / a.total : a.open ? 1 : 0, a.open ? `${fin}/${a.total}${a.bytes ? ' · ' + (a.bytes / 1048576).toFixed(1) + ' MB' : ''}` : '等待中', 3],
    ],
  };
});

game = new Game(document.getElementById('game'));
game.bindInput();
initNet(game); // [net] 主選單的多人連線入口(src/net/lobby.js)
window.__game = game; // 除錯用:在瀏覽器 console 操作 __game

// ---- 效能基礎建設 ----
game.renderer.info.autoReset = false; // 一幀內多個 pass 的 draw call 合計(主迴圈每幀歸零)
game.renderer.debug.checkShaderErrors = !import.meta.env.PROD; // 正式版不查 shader 錯誤日誌(那些查詢會同步等編譯完成)
game.quality = new Quality(game); // 畫質預設檔 + 動態解析度(src/sys/quality.js)
game.perf = new Perf(game); // F3 效能面板(src/sys/perf.js)
prewarm(); // 殭屍變體:有 Worker 時立刻全部平行送到 Worker 池建模
performance.mark('hz:game');
window.__perfVariants = variantStats; // 測試用
window.__assets = assets; // 測試用:下載佇列進度
window.__physLoad = physicsLoad;
installStreaming(game); // 下載順序:玩家附近 → 同層 → 其他樓層
assets.hiRes = game.quality.preset !== 'low'; // 低畫質:不下載 1K 顏色圖(省頻寬與顯示記憶體)
game.quality.on('change', (k, q) => { assets.hiRes = q.preset !== 'low'; });
{
  const t0 = performance.now();
  const gate = setInterval(() => {
    const v = variantStats(), ph = physicsLoad.state;
    const ok = (ph === 'ready' || ph === 'failed' || ph === 'off') && (v.ready >= v.total || !v.pool || v.pool.failed);
    if (ok || performance.now() - t0 > 10000) { clearInterval(gate); assets.open(ok ? 'critical' : 'timeout'); }
  }, 100);
  const begin0 = game.begin;
  game.begin = function (...a) { assets.open('start'); assets.concurrency = 3; return begin0.apply(this, a); }; // 遊戲中少開幾條連線(多人時不塞滿下行)
}

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
  // 光源數量是 shader 參數:第一次 updateCombat 才加進場景的爆炸閃光燈(boomLight)若在預編譯之後才出現,
  // 第一幀會把全部 program 同步重編一次(慢機器上 5~15 秒的凍結)→ 預編譯前先初始化
  game.initCombat?.();
  await yieldNow(); // 先讓模組執行完(DOMContentLoaded、選單可互動),編譯分批在之後的任務裡做
  const t = performance.now();
  try {
    const all = Promise.all([
      precompile(game, game.scene),
      precompile(game, game.weaponScene, { target: game.weaponScene, camera: game.weaponCamera, shadows: false }),
      precompilePasses(game),
    ]);
    const res = await Promise.race([all, new Promise((r) => setTimeout(() => r(null), 4000))]);
    if (res) {
      game.perf.time('預編譯', performance.now() - t);
      // 選單畫面看不到的物件(背後、被擋住、隱藏中)的 program 也在閒置時先做第一次使用的初始化
      all.then(([a, b]) => initPrograms(new Set([...a.programs, ...b.programs]))).then(() => idle(() => warmDrawScene(game), 500));
    }
  } catch (e) { console.warn('[warmup]', e); }
  performance.measure('hz:precompile', { start: t });
  last = performance.now();
  if (!raf && !document.hidden) raf = requestAnimationFrame(frame);
  // 殭屍與常見特效材質:變體建好後在閒置時段預編譯,第一隻殭屍出現/第一槍不會頓一下
  whenWarm().then(() => idle(warmRuntime, 300)).catch((e) => console.warn('[warmup]', e));
}
boot();

async function warmRuntime() {
  const g = new THREE.Group();
  const inst = instantiate(getVariant('walker', 0));
  const M = zombieMaterials();
  inst.mesh.material = [M.skin, M.cloth, M.gear, M.bone, M.hair, M.glow, ...Object.values(M.eye)]; // 只編譯、不渲染
  g.add(inst.mesh);
  // 執行期才會建立的常見材質型態(曳光、血池/貼花、光暈與血條 sprite、粒子):program 只看功能旗標(貼圖/霧…),不看顏色數值
  const tex = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
  tex.colorSpace = THREE.SRGBColorSpace;
  const line = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 0, -1)]), quad = new THREE.PlaneGeometry(1, 1);
  for (const fog of [true, false]) {
    g.add(new THREE.Line(line, new THREE.LineBasicMaterial({ fog, transparent: true })));
    for (const map of [tex, null]) {
      g.add(new THREE.Mesh(quad, new THREE.MeshBasicMaterial({ fog, map, transparent: true })));
      g.add(new THREE.Sprite(new THREE.SpriteMaterial({ fog, map, transparent: true })));
    }
  }
  const res = await precompile(game, g);
  await initPrograms(res.programs);
  await texturesReady();
  // 再真的畫一次(離屏):每種殭屍材質 × 蒙皮頂點格式、特效物件,連同陰影 pass
  await idle(() => {
    const v = getVariant('walker', 0), draws = new THREE.Group();
    inst.mesh.material = v.materials;
    draws.add(inst.mesh);
    for (const m of [M.skin, M.cloth, M.gear, M.bone, M.hair, M.glow, ...Object.values(M.eye)]) {
      const sm = new THREE.SkinnedMesh(v.geometry, m);
      sm.bind(inst.mesh.skeleton, inst.mesh.bindMatrix);
      draws.add(sm);
    }
    for (const o of [...g.children]) if (o !== inst.mesh) draws.add(o);
    warmDraw(game, [draws]);
  }, 300);
  inst.mesh.skeleton.dispose();
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
