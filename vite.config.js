export default {
  server: { port: 5173 },
  build: { chunkSizeWarningLimit: 1500 },
  worker: { format: 'es' }, // 模組 Worker(new Worker(url, { type: 'module' })),Worker 內可動態 import / code splitting
};
