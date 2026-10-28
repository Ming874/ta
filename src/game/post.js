import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

// 最終畫面:邊緣色差、去飽和(受傷時更明顯)、暗角、底片顆粒、受傷泛紅
export const PostShader = {
  uniforms: { tDiffuse: { value: null }, time: { value: 0 }, aspect: { value: 1 }, hurt: { value: 0 }, past: { value: 0 } }, // [ghost] past:回憶(src/horror/memories.js)
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float time; uniform float aspect; uniform float hurt; uniform float past;
    varying vec2 vUv;
    float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233))) * 43758.5453); }
    void main(){
      vec2 d = vUv - 0.5;
      float r2 = dot(d, d);
      vec2 off = d * r2 * 0.012; // 邊緣輕微色差
      vec4 c;
      c.r = texture2D(tDiffuse, vUv + off).r;
      c.g = texture2D(tDiffuse, vUv).g;
      c.b = texture2D(tDiffuse, vUv - off).b;
      c.a = 1.0;
      float l = dot(c.rgb, vec3(0.299, 0.587, 0.114));
      c.rgb = mix(vec3(l), c.rgb, 0.8 - hurt * 0.5);
      float v = smoothstep(0.95, 0.2, length(d * vec2(aspect * 0.8, 1.0)));
      c.rgb *= mix(0.45, 1.0, v);
      c.rgb += (hash(vUv * 900.0 + time) - 0.5) * 0.022;
      c.r += hurt * 0.12;
      if (past > 0.001) { // [ghost] 回憶:舊照片(亮部褐、暗部青綠)、更重的暗角與顆粒
        float lp = dot(c.rgb, vec3(0.299, 0.587, 0.114));
        vec3 sep = vec3(lp) * vec3(1.08, 0.97, 0.80) + vec3(0.0, 0.03, 0.028) * (1.0 - smoothstep(0.0, 0.5, lp));
        c.rgb = mix(c.rgb, sep, past * 0.88);
        c.rgb *= mix(1.0, mix(0.6, 1.0, v), past * 0.7);
        c.rgb += (hash(vUv * 480.0 + fract(time * 7.3)) - 0.5) * 0.065 * past;
      }
      gl_FragColor = c;
    }`,
};

// 清掉 HDR 緩衝裡偶發的 NaN/Inf,避免 Bloom 把整個畫面染成全黑;並把高光軟壓縮到約 8 以下(極亮的反光不會暈開成整片白光)
export const SanitizeShader = {
  uniforms: { tDiffuse: { value: null } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
  fragmentShader: `
    uniform sampler2D tDiffuse; varying vec2 vUv;
    void main(){
      vec4 c = texture2D(tDiffuse, vUv);
      if (!(c.r >= 0.0 && c.r < 60.0)) c.r = 0.0;
      if (!(c.g >= 0.0 && c.g < 60.0)) c.g = 0.0;
      if (!(c.b >= 0.0 && c.b < 60.0)) c.b = 0.0;
      // 高光軟壓縮:手電筒貼近牆面時 HDR 值可達上百 → Bloom 變成一大團白。超過 2 的部分平滑壓到約 8 以下
      // (色調映射後幾乎看不出差別,燈管光暈仍保留,只是不再炸成整片)
      float m = max(c.r, max(c.g, c.b));
      if (m > 2.0) { float e = m - 2.0; c.rgb *= (2.0 + e / (1.0 + e / 6.0)) / m; }
      c.a = 1.0;
      gl_FragColor = c;
    }`,
};

// 場景 → 手持武器(獨立深度)→ 清 NaN → Bloom → 最終調色 → 輸出
export function setupPost(game) {
  const rt = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, samples: 4 });
  const composer = new EffectComposer(game.renderer, rt);
  composer.addPass(new RenderPass(game.scene, game.camera));
  const wp = new RenderPass(game.weaponScene, game.weaponCamera);
  wp.clear = false;
  wp.clearDepth = true;
  composer.addPass(wp);
  composer.addPass(new ShaderPass(SanitizeShader));
  game.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.32, 0.6, 0.92);
  composer.addPass(game.bloom);
  game.post = new ShaderPass(PostShader);
  composer.addPass(game.post);
  composer.addPass(new OutputPass());
  game.composer = composer;
  game.hospital?.attachRenderer?.(game.renderer, game);
}
