import { mkCanvas } from './paint.js';

// 貼花/標示圖集(之後補上內容)。paintAtlas(key) → { c, meta }
export function paintAtlas(key) {
  const c = mkCanvas(64, 64);
  const x = c.getContext('2d');
  x.clearRect(0, 0, 64, 64);
  return { c, hc: null, meta: { key } };
}
