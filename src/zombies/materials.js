import * as THREE from 'three';
import { paintTexture, paintTextures } from '../sys/texworker.js';

// 殭屍共用材質。顏色細節(屍斑、瘀青、血、汙垢)都畫在頂點色上,
// 貼圖只負責可平鋪的微細節:毛孔、皺紋、血管、布料織紋、髮絲。
// 貼圖產生器在 materials.paint.js,由貼圖 Worker 用 OffscreenCanvas 畫(不支援時主執行緒畫同一份),
// 這裡立刻拿到 THREE.Texture,畫好後自動更新。

const NS = 'zombies/materials:';
const SRGB = {}, LINEAR = { srgb: false };

let M = null;
export function materials() {
  if (M) return M;
  const sk = paintTextures(NS + 'skin', null, { map: SRGB, bump: LINEAR });
  const cl = paintTextures(NS + 'cloth', null, { map: SRGB, alpha: LINEAR });
  const skinMat = new THREE.MeshStandardMaterial({ vertexColors: true, map: sk.map, bumpMap: sk.bump, bumpScale: 1.6, roughness: 0.7 });
  // 頂點色的 alpha 當作「濕潤度」:血與傷口較亮滑
  skinMat.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader.replace(
      '#include <roughnessmap_fragment>',
      '#include <roughnessmap_fragment>\n#ifdef USE_COLOR_ALPHA\nroughnessFactor = mix(roughnessFactor, 0.38, smoothstep(0.2, 1.0, vColor.a));\n#endif',
    );
  };
  skinMat.customProgramCacheKey = () => 'zskin';
  const eye = (iris, emissive, intensity) => {
    const e = paintTextures(NS + 'eye', { iris, glow: intensity > 0.9 }, { map: { wrap: false, anisotropy: 1 }, glow: { wrap: false, anisotropy: 1 } });
    return new THREE.MeshStandardMaterial({ map: e.map, roughness: 0.2, emissive, emissiveMap: e.glow, emissiveIntensity: intensity });
  };
  M = {
    skin: skinMat,
    cloth: new THREE.MeshStandardMaterial({
      vertexColors: true, map: cl.map, alphaMap: cl.alpha, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.93,
    }),
    gear: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.2 }),
    bone: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.42 }),
    hair: new THREE.MeshStandardMaterial({ vertexColors: true, map: paintTexture(NS + 'hair', null, SRGB), alphaTest: 0.38, side: THREE.DoubleSide, roughness: 0.75 }),
    glow: new THREE.MeshStandardMaterial({ vertexColors: true, color: 0xb8a878, emissive: 0x5a6a0a, emissiveIntensity: 0.6, roughness: 0.18 }),
    eye: {
      walker: eye('#8d9088', 0x3a3a30, 0.6),
      runner: eye('#a01808', 0xff3010, 1.6),
      crawler: eye('#b8b090', 0x403a28, 0.6),
      bloater: eye('#b8c020', 0xc8e020, 1.4),
      brute: eye('#ff5a10', 0xff4a08, 1.8),
    },
  };
  return M;
}
