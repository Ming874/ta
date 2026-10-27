// 跨來源隔離(SharedArrayBuffer 需要);正式環境由 server/index.js 送出同樣的標頭
const isolation = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
  'Cross-Origin-Resource-Policy': 'same-origin',
};
// 開發時把連線請求轉到本機的多人伺服器(node server/index.js,預設 8787)
const NET = process.env.NET_SERVER || 'localhost:8787';
const proxy = {
  '/ws': { target: `ws://${NET}`, ws: true, changeOrigin: true },
  '/api': { target: `http://${NET}`, changeOrigin: true },
};

export default {
  server: { port: 5173, headers: isolation, proxy },
  preview: { headers: isolation, proxy },
  build: { chunkSizeWarningLimit: 1500 },
  worker: { format: 'es' }, // 模組 Worker(new Worker(url, { type: 'module' })),Worker 內可動態 import / code splitting
};
