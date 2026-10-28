import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

// 最終畫面:邊緣色差、去飽和(受傷時更明顯)、暗角、底片顆粒、受傷泛紅
// [motion] 轉場全部是這個 pass 的 uniform(src/ui/motion.js 寫值;不加 pass、不用 define → 不會在 hz:warm 之後編譯新 program):
//   fade/fadeCol 全畫面淡到某色 · tint/tintCol 邊緣染色(燈篙亮起的紅)· vig 暗角加減(負值 = 打開)· lid 眼皮(1 = 閉上)·
//   crt 監視器(選單:掃描線、桶形、圓角)· roll 垂直捲動(監視器跳格)· dawn 天亮調色 ·
//   grain 顆粒加量 · desat 去飽和 · beat 心跳的暗角脈動(0..1)
export const PostShader = {
  uniforms: {
    tDiffuse: { value: null }, time: { value: 0 }, aspect: { value: 1 }, hurt: { value: 0 }, past: { value: 0 }, // [ghost] past:回憶(src/horror/memories.js)
    fade: { value: 0 }, fadeCol: { value: new THREE.Color(0, 0, 0) }, tint: { value: 0 }, tintCol: { value: new THREE.Color(0.55, 0.06, 0.03) },
    vig: { value: 0 }, lid: { value: 0 }, crt: { value: 0 }, roll: { value: 0 }, dawn: { value: 0 }, grain: { value: 0 }, desat: { value: 0 }, beat: { value: 0 },
  },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float time; uniform float aspect; uniform float hurt; uniform float past;
    uniform float fade; uniform vec3 fadeCol; uniform float tint; uniform vec3 tintCol; uniform float vig; uniform float lid;
    uniform float crt; uniform float roll; uniform float dawn; uniform float grain; uniform float desat; uniform float beat;
    varying vec2 vUv;
    float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233))) * 43758.5453); }
    void main(){
      vec2 uv = vUv;
      float inside = 1.0;
      if (crt > 0.001) { // 監視器:輕微桶形、垂直捲動(跳格時)
        vec2 cc = uv - 0.5;
        uv = 0.5 + cc * (1.0 + crt * 0.075 * dot(cc, cc) * 4.0) * (1.0 - crt * 0.012);
        uv.y = fract(uv.y + roll);
        vec2 e = smoothstep(vec2(0.0), vec2(0.012), uv) * smoothstep(vec2(0.0), vec2(0.012), 1.0 - uv);
        inside = mix(1.0, e.x * e.y, crt);
      }
      vec2 d = uv - 0.5;
      float r2 = dot(d, d);
      vec2 off2 = d * r2 * (0.012 + crt * 0.01); // 邊緣輕微色差
      vec4 c;
      c.r = texture2D(tDiffuse, uv + off2).r;
      c.g = texture2D(tDiffuse, uv).g;
      c.b = texture2D(tDiffuse, uv - off2).b;
      c.a = 1.0;
      float l = dot(c.rgb, vec3(0.299, 0.587, 0.114));
      c.rgb = mix(vec3(l), c.rgb, clamp(0.8 - hurt * 0.5 - desat, 0.0, 1.0));
      vec2 dv = vUv - 0.5;
      float L = length(dv * vec2(aspect * 0.8, 1.0));
      float vg = clamp(vig + beat * 0.22, -0.6, 1.0);
      float v = smoothstep(0.95 - vg * 0.32, 0.2 - vg * 0.16, L);
      float edge = 1.0 - v;
      c.rgb *= mix(clamp(0.45 - vg * 0.38, 0.0, 0.85), 1.0, v);
      // 受傷:邊緣往暗紅壓(乘法,不把黑色抬成粉紅),中心只去飽和
      float hk = hurt * (0.35 + 0.65 * edge);
      c.rgb = mix(c.rgb, c.rgb * vec3(1.25, 0.42, 0.38) + vec3(0.035, 0.0, 0.0) * edge, clamp(hk, 0.0, 1.0));
      if (tint > 0.001) c.rgb = mix(c.rgb, tintCol * (l * 1.7 + 0.03), clamp(tint * edge * 1.4, 0.0, 1.0)); // 邊緣染色(燈篙亮起)
      if (past > 0.001) { // [ghost] 回憶:舊照片(亮部褐、暗部青綠)、更重的暗角與顆粒
        float lp = dot(c.rgb, vec3(0.299, 0.587, 0.114));
        vec3 sep = vec3(lp) * vec3(1.08, 0.97, 0.80) + vec3(0.0, 0.03, 0.028) * (1.0 - smoothstep(0.0, 0.5, lp));
        c.rgb = mix(c.rgb, sep, past * 0.88);
        c.rgb *= mix(1.0, mix(0.6, 1.0, v), past * 0.7);
        c.rgb += (hash(vUv * 480.0 + fract(time * 7.3)) - 0.5) * 0.065 * past;
      }
      if (dawn > 0.001) { // 天亮:先冷(藍灰的天光),再暖:亮部金、暗部抬成淡紫藍(不是紅褐),整體亮一點
        float ld = dot(c.rgb, vec3(0.299, 0.587, 0.114));
        float a = smoothstep(0.0, 0.45, dawn), b = smoothstep(0.35, 1.0, dawn);
        c.rgb = mix(c.rgb, c.rgb * vec3(0.86, 0.94, 1.12) + vec3(0.0, 0.006, 0.016), a * (1.0 - b));
        vec3 warm = c.rgb * mix(vec3(1.04, 1.02, 1.04), vec3(1.16, 1.04, 0.9), smoothstep(0.12, 0.65, ld)) + vec3(0.022, 0.024, 0.04) * (1.0 - ld);
        c.rgb = mix(c.rgb, warm * 1.08, b);
      }
      if (crt > 0.001) { // 掃描線 + 映像管的亮部暈開
        float sl = 0.5 + 0.5 * cos(gl_FragCoord.y * 2.0944);
        c.rgb *= 1.0 - crt * 0.2 * sl;
        c.rgb += crt * 0.012 * vec3(0.7, 1.0, 0.85);
        c.rgb *= 1.0 - crt * 0.35 * smoothstep(0.25, 0.75, length(d * vec2(1.0, 1.15)) * 1.2);
      }
      c.rgb += (hash(vUv * 900.0 + time) - 0.5) * (0.022 + grain * 0.03 + crt * 0.02);
      c.rgb *= inside;
      if (lid > 0.001) { // 眼皮:上下兩片,邊緣柔、中央先開
        float h = (1.0 - lid) * (0.62 - 0.22 * (dv.x * dv.x) * 4.0);
        float m = smoothstep(h, h + 0.09 + lid * 0.06, abs(dv.y) * 1.06);
        c.rgb *= 1.0 - m;
        c.rgb = mix(c.rgb, vec3(dot(c.rgb, vec3(0.3, 0.59, 0.11))) * vec3(1.02, 0.98, 0.96), lid * 0.6);
      }
      c.rgb = mix(c.rgb, fadeCol, clamp(fade, 0.0, 1.0));
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
