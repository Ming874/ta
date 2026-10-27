import * as THREE from 'three';
import { surf } from './hospital/surfaces.js';
import { sfx, _internal as AUDIO } from '../audio.js';
import { ENV, WIND, LIGHT_MODS, GLOWS } from './props/outdoor/env.js';

// 天氣與夜空(戶外):
//  - 雨:GPU 實例化雨絲(頂點著色器在鏡頭周圍的盒子內循環;依地圖「雨停高度」遮罩剔除屋頂下的雨滴)+ 地面濺水
//  - 濕地:戶外地板材質注入濕潤(變暗、粗糙度下降)、隨機水窪(鏡面 + 雨滴漣漪)
//  - 低霧:貼地的數層霧片(依戶外遮罩淡出,不進室內)
//  - 閃電:雲層閃光 + 偶爾的閃電形狀 + 月光平行光短暫增亮;有 sfx.thunder 時延遲播放雷聲
//  - 夜空:快速飄動的暴風雲(月光鑲邊)、地平線外的城市剪影(零星亮窗、閃爍航空障礙燈、遠方火光)
// 依 game.quality 調整數量;每幀不配置新物件。game.js 只加兩行(import + new Weather(this)),
// 每幀更新掛在 hospital.update 之後(環境光、霧色由 atmosphere 先算好,這裡再疊加閃電)。

const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const hash = (n) => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };
const noise1 = (x) => { const i = Math.floor(x), f = x - i, u = f * f * (3 - 2 * f); return (hash(i) * (1 - u) + hash(i + 1) * u) * 2 - 1; };

// ======================================================================
// 濕地材質(共用 uniform)
// ======================================================================
export const WET = { uWet: { value: 0.85 }, uRainT: { value: 0 }, uRain: { value: 0.8 }, uRipple: { value: 1 } };
const WET_PARS = /* glsl */`
uniform float uWet; uniform float uRainT; uniform float uRain; uniform float uRipple; uniform float uPuddle; uniform float uPudMin; uniform float uDarken; uniform float uGloss;
varying vec3 vWetPos;
float wHash( vec2 p ) { return fract( sin( dot( p, vec2( 127.1, 311.7 ) ) ) * 43758.5453 ); }
float wNoise( vec2 p ) { vec2 i = floor( p ), f = fract( p ); f = f * f * ( 3.0 - 2.0 * f );
  return mix( mix( wHash( i ), wHash( i + vec2( 1.0, 0.0 ) ), f.x ), mix( wHash( i + vec2( 0.0, 1.0 ) ), wHash( i + vec2( 1.0, 1.0 ) ), f.x ), f.y ); }
// 雨滴漣漪:兩層 0.4m 格子,每格一個隨機時間擴散的圓環 → 回傳高度場梯度(世界 xz)
vec2 wRipple( vec2 p, float t ) {
  vec2 g = vec2( 0.0 );
  for ( int k = 0; k < 2; k ++ ) {
    vec2 q = p * 2.6 + float( k ) * vec2( 17.3, 5.1 );
    vec2 i = floor( q ), f = fract( q ) - 0.5;
    float h = wHash( i + float( k ) * 7.13 );
    float age = fract( t * ( 0.8 + 0.4 * h ) + h );
    vec2 d = f - ( vec2( wHash( i + 3.3 ), wHash( i + 5.7 ) ) - 0.5 ) * 0.5;
    float r = length( d ) + 1e-4;
    float x = ( r - age * 0.42 ) * 34.0;
    float env = ( 1.0 - age ) * ( 1.0 - age ) * exp( - x * x * 0.08 ) * step( r, 0.5 );
    g += d / r * cos( x ) * env;
  }
  return g;
}
`;
const WET_ROUGH = /* glsl */`
	float wUp = smoothstep( 0.72, 0.95, ( vec4( normalize( vNormal ), 0.0 ) * viewMatrix ).y );
	float wN = wNoise( vWetPos.xz * 0.21 ) * 0.62 + wNoise( vWetPos.xz * 0.83 + 3.1 ) * 0.28 + wNoise( vWetPos.xz * 3.7 ) * 0.1;
	float wPud = max( smoothstep( 0.66 - 0.1 * uWet, 0.7 - 0.1 * uWet, wN ) * uPuddle, uPudMin ) * uWet * wUp;
	float wDamp = uWet * ( 0.65 + 0.35 * wN );
	diffuseColor.rgb *= 1.0 - uDarken * wDamp;
	diffuseColor.rgb = mix( diffuseColor.rgb, diffuseColor.rgb * 0.3, wPud );
	roughnessFactor = mix( roughnessFactor, roughnessFactor * ( 1.0 - uGloss ) + 0.06, wDamp );
	roughnessFactor = mix( roughnessFactor, 0.035, wPud );
`;
const WET_NORMAL = /* glsl */`
	if ( wPud > 0.01 ) {
		vec2 wg = uRipple > 0.5 && uRain > 0.02 ? wRipple( vWetPos.xz, uRainT ) * 0.09 * uRain : vec2( 0.0 );
		vec3 wFlat = normalize( ( viewMatrix * vec4( - wg.x, 1.0, - wg.y, 0.0 ) ).xyz );
		normal = normalize( mix( normal, wFlat, wPud ) );
	}
`;
const WET_VERT = /* glsl */`
	{
		vec4 wetP = vec4( transformed, 1.0 );
		#ifdef USE_INSTANCING
		wetP = instanceMatrix * wetP;
		#endif
		vWetPos = ( modelMatrix * wetP ).xyz;
	}
`;
// 把濕潤效果注入 MeshStandardMaterial(可疊在其他 onBeforeCompile 之前:先改字串、再呼叫原本的 hook)
// puddle:水窪量(0 = 沒有水窪,只變暗變亮);darken:濕了變暗程度;gloss:粗糙度下降程度
export function makeWet(m, { puddle = 0, darken = 0.3, gloss = 0.55, full = false } = {}) {
  if (!m || m.userData.wet) return m;
  m.userData.wet = { uPuddle: { value: Math.min(1, puddle) }, uPudMin: { value: full ? 1 : 0 }, uDarken: { value: darken }, uGloss: { value: gloss } };
  const prev = m.onBeforeCompile;
  const hasPrev = prev && prev !== THREE.Material.prototype.onBeforeCompile;
  m.onBeforeCompile = function (s, r) {
    Object.assign(s.uniforms, WET, this.userData.wet);
    s.vertexShader = s.vertexShader
      .replace('void main() {', 'varying vec3 vWetPos;\nvoid main() {')
      .replace('#include <project_vertex>', '#include <project_vertex>\n' + WET_VERT);
    s.fragmentShader = s.fragmentShader
      .replace('void main() {', WET_PARS + 'void main() {')
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n' + WET_ROUGH)
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\n' + WET_NORMAL);
    if (hasPrev) prev.call(this, s, r);
  };
  const key = hasPrev ? (m.customProgramCacheKey !== THREE.Material.prototype.customProgramCacheKey ? m.customProgramCacheKey() : prev.toString()) : '';
  m.customProgramCacheKey = () => 'wet|' + key;
  m.needsUpdate = true;
  return m;
}

// ======================================================================
// 地圖遮罩
// ======================================================================
// 雨停高度:每格最上面的實心面(樓板/屋頂/牆頂);地圖外一圈 = 0(遠景地面)
function buildMasks(L) {
  const W = L.W + 2, H = L.H + 2, nL = L.levels.length, top = L.levels[nL - 1];
  const rain = new Float32Array(W * H);
  const fog = new Uint8Array(W * H * 4);
  for (let r = -1; r <= L.H; r++) for (let c = -1; c <= L.W; c++) {
    const k = (r + 1) * W + (c + 1);
    let y = 0;
    const inMap = c >= 0 && r >= 0 && c < L.W && r < L.H;
    if (inMap) {
      if (L.roofed(c, r)) y = top.y + L.LEVEL_H;
      else {
        y = -50;
        for (let li = nL - 1; li >= 0; li--) {
          const ch = L.charAt(li, c, r);
          if (ch === '_' || ch === 'o' || ch === '%') continue;
          const ly = L.levels[li].y;
          if (ch === '#' || ch === 'E') y = ly + (L.levels[li].id === '1F' && !L.inBuilding(c, r) ? 3.0 : L.LEVEL_H);
          else if (ch === 'W') y = ly + L.LEVEL_H;
          else y = ly;
          break;
        }
      }
    }
    rain[k] = y;
    // 霧片遮罩:G = 一樓戶外地面(地圖外也算)、B = 頂樓平台
    const f1 = !inMap || (y < 0.5 && y > -0.5 && ((L.flagsAt(1, c, r) & L.F.OUTDOOR) || '|#'.includes(L.charAt(1, c, r)) && !L.inBuilding(c, r)));
    const roof = inMap && Math.abs(y - top.y) < 0.5 && (L.flagsAt(nL - 1, c, r) & L.F.WALK);
    fog[k * 4] = 0; fog[k * 4 + 1] = f1 ? 255 : 0; fog[k * 4 + 2] = roof ? 255 : 0; fog[k * 4 + 3] = 255;
  }
  const rt = new THREE.DataTexture(rain, W, H, THREE.RedFormat, THREE.FloatType);
  rt.minFilter = rt.magFilter = THREE.NearestFilter;
  rt.needsUpdate = true;
  const ft = new THREE.DataTexture(fog, W, H, THREE.RGBAFormat, THREE.UnsignedByteType);
  ft.minFilter = ft.magFilter = THREE.LinearFilter;
  ft.needsUpdate = true;
  // 地圖座標 → 遮罩 uv:u = (x/CELL + 1) / W
  const xf = new THREE.Vector4(1 / (L.CELL * W), 1 / (L.CELL * H), 1 / W, 1 / H);
  // 每層每格附近(8 格內)是否有露天格(玩家在深處室內時不畫雨)
  const near = L.levels.map((lv) => {
    const open = new Uint8Array(L.W * L.H), out = new Uint8Array(L.W * L.H);
    for (let r = 0; r < L.H; r++) for (let c = 0; c < L.W; c++) open[r * L.W + c] = rain[(r + 1) * W + c + 1] <= lv.y + 0.6 ? 1 : 0;
    const R = 8;
    for (let r = 0; r < L.H; r++) for (let c = 0; c < L.W; c++) {
      let f = 0;
      for (let dr = -R; dr <= R && !f; dr++) for (let dc = -R; dc <= R; dc++) {
        const cc = c + dc, rr = r + dr;
        if (cc < 0 || rr < 0 || cc >= L.W || rr >= L.H || open[rr * L.W + cc]) { f = 1; break; }
      }
      out[r * L.W + c] = f;
    }
    return out;
  });
  return { rain, rainTex: rt, fogTex: ft, xf, near, W, H };
}

// ======================================================================
// 雨絲 / 濺水
// ======================================================================
const RAIN_MAX = 9000, SPLASH_MAX = 800;
function rainMesh(masks) {
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, 0, 0, 0.5, 0, 0, 0.5, 1, 0, -0.5, 1, 0], 3));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  const seed = new Float32Array(RAIN_MAX * 4);
  for (let i = 0; i < seed.length; i++) seed[i] = Math.random();
  g.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seed, 4));
  g.instanceCount = 6000;
  const m = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 }, uCam: { value: new THREE.Vector3() }, uBox: { value: new THREE.Vector3(34, 18, 34) }, uBoxN: { value: new THREE.Vector3(11, 9, 11) },
      uVel: { value: new THREE.Vector3(1.2, -12, 0.5) }, uMask: { value: masks.rainTex }, uMaskXf: { value: masks.xf },
      uLen: { value: 0.8 }, uWidth: { value: 0.011 }, uPx: { value: 0.0015 }, uCol: { value: new THREE.Color(0x8a96a8) }, uAlpha: { value: 0.32 }, uInt: { value: 1 },
    },
    vertexShader: /* glsl */`
      attribute vec4 aSeed;
      uniform float uTime; uniform vec3 uCam; uniform vec3 uBox; uniform vec3 uBoxN; uniform vec3 uVel;
      uniform sampler2D uMask; uniform vec4 uMaskXf; uniform float uLen; uniform float uWidth; uniform float uPx; uniform float uInt;
      varying float vA; varying vec2 vUv;
      void main() {
        float nearL = step( aSeed.w, 0.45 );
        vec3 B = mix( uBox, uBoxN, nearL );
        float sp = 0.85 + 0.3 * fract( aSeed.w * 13.7 );
        vec3 p = aSeed.xyz * B + uVel * ( uTime * sp );
        vec3 base = uCam - B * 0.5;
        p = base + mod( p - base, B );
        vec3 vel = normalize( uVel );
        float stopY = texture2D( uMask, p.xz * uMaskXf.xy + uMaskXf.zw ).r;
        vec3 toC = uCam - p;
        float dist = max( length( toC ), 0.001 );
        vec3 side = normalize( cross( vel, toC / dist ) );
        float w = max( uWidth, uPx * dist * 1.6 );
        float len = uLen * sp * ( 1.0 + nearL * 0.3 );
        vec3 wp = p - vel * ( position.y * len ) + side * ( position.x * w );
        vec3 rel = ( p - base ) / B;
        float edge = ( 1.0 - smoothstep( 0.4, 0.5, max( abs( rel.x - 0.5 ), abs( rel.z - 0.5 ) ) ) ) * smoothstep( 0.0, 0.08, rel.y ) * ( 1.0 - smoothstep( 0.9, 1.0, rel.y ) );
        vA = step( stopY, p.y ) * edge * smoothstep( 0.5, 1.8, dist ) * clamp( uWidth / w, 0.18, 1.0 ) * step( fract( aSeed.w * 7.31 ), uInt );
        vUv = vec2( position.x + 0.5, position.y );
        gl_Position = projectionMatrix * viewMatrix * vec4( wp, 1.0 );
        if ( vA < 0.001 ) gl_Position = vec4( 0.0, 0.0, 2.0, 1.0 );
      }`,
    fragmentShader: /* glsl */`
      uniform vec3 uCol; uniform float uAlpha;
      varying float vA; varying vec2 vUv;
      void main() {
        float a = vA * ( 1.0 - abs( vUv.x * 2.0 - 1.0 ) ) * smoothstep( 0.0, 0.3, vUv.y ) * ( 1.0 - smoothstep( 0.75, 1.0, vUv.y ) ) * uAlpha;
        if ( a < 0.002 ) discard;
        gl_FragColor = vec4( uCol, a );
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
  });
  const mesh = new THREE.Mesh(g, m);
  mesh.frustumCulled = false;
  mesh.renderOrder = 20;
  mesh.name = 'rain';
  return mesh;
}
function splashMesh(masks) {
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0], 3));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  const seed = new Float32Array(SPLASH_MAX * 4);
  for (let i = 0; i < seed.length; i++) seed[i] = Math.random();
  g.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seed, 4));
  g.instanceCount = 400;
  const m = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uCam: { value: new THREE.Vector3() }, uBox: { value: new THREE.Vector2(14, 14) }, uMask: { value: masks.rainTex }, uMaskXf: { value: masks.xf }, uInt: { value: 1 }, uCol: { value: new THREE.Color(0x9aa6b6) } },
    vertexShader: /* glsl */`
      attribute vec4 aSeed;
      uniform float uTime; uniform vec3 uCam; uniform vec2 uBox; uniform sampler2D uMask; uniform vec4 uMaskXf; uniform float uInt;
      varying vec2 vUv; varying float vA; varying float vAge;
      float h1( float n ) { return fract( sin( n ) * 43758.5453 ); }
      void main() {
        float tt = uTime / ( 0.3 + 0.2 * aSeed.w ) + aSeed.z;
        float cyc = floor( tt ), age = fract( tt );
        vec2 p = ( aSeed.xy + vec2( h1( cyc * 12.9898 + aSeed.x * 78.2 ), h1( cyc * 39.35 + aSeed.y * 11.1 ) ) ) * uBox;
        vec2 base = uCam.xz - uBox * 0.5;
        p = base + mod( p - base, uBox );
        float y = texture2D( uMask, p * uMaskXf.xy + uMaskXf.zw ).r;
        float vis = step( abs( y - uCam.y + 1.2 ), 4.0 ) * step( h1( cyc * 3.7 + aSeed.w * 91.0 ), uInt );
        float s = ( 0.07 + 0.09 * aSeed.w ) * ( 0.5 + age );
        vec4 mv = viewMatrix * vec4( p.x, y + s * 0.45, p.y, 1.0 );
        mv.xy += position.xy * s;
        float d = length( mv.xyz );
        vA = vis * ( 1.0 - smoothstep( 6.0, 9.0, d ) ) * smoothstep( 0.6, 1.5, d );
        vUv = position.xy + 0.5; vAge = age;
        gl_Position = projectionMatrix * mv;
        if ( vA < 0.001 ) gl_Position = vec4( 0.0, 0.0, 2.0, 1.0 );
      }`,
    fragmentShader: /* glsl */`
      uniform vec3 uCol;
      varying vec2 vUv; varying float vA; varying float vAge;
      void main() {
        vec2 q = vUv - vec2( 0.5, 0.12 );
        float ring = exp( - pow( ( length( q * vec2( 1.0, 3.2 ) ) - vAge * 0.38 ) * 16.0, 2.0 ) ) * step( q.y, 0.12 );
        float crown = 0.0;
        for ( int i = 0; i < 5; i ++ ) {
          float a = ( float( i ) - 2.0 ) * 0.42;
          vec2 dp = vec2( sin( a ) * 0.32 * vAge, 0.18 + 0.55 * vAge * cos( a ) - 0.6 * vAge * vAge );
          crown += smoothstep( 0.05, 0.0, length( q - dp ) );
        }
        float a = ( ring * 0.7 + crown ) * vA * ( 1.0 - vAge ) * 0.55;
        if ( a < 0.003 ) discard;
        gl_FragColor = vec4( uCol, a );
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
  });
  const mesh = new THREE.Mesh(g, m);
  mesh.frustumCulled = false;
  mesh.renderOrder = 21;
  mesh.name = 'rain-splash';
  return mesh;
}

// ======================================================================
// 夜空:暴風雲(透明,只畫在天空像素上)+ 城市剪影(不透明,深度略小於 1 讓雲與閃光擋不到)+ 閃電形狀
// ======================================================================
const SKY_NOISE = /* glsl */`
  float h1( float n ) { return fract( sin( n * 127.1 ) * 43758.5453 ); }
  float h2( vec2 p ) { return fract( sin( dot( p, vec2( 127.1, 311.7 ) ) ) * 43758.5453 ); }
  float n2( vec2 p ) { vec2 i = floor( p ), f = fract( p ); f = f * f * ( 3.0 - 2.0 * f );
    return mix( mix( h2( i ), h2( i + vec2( 1.0, 0.0 ) ), f.x ), mix( h2( i + vec2( 0.0, 1.0 ) ), h2( i + vec2( 1.0, 1.0 ) ), f.x ), f.y ); }
  float fbm( vec2 p ) { float s = 0.0, a = 0.5; for ( int i = 0; i < 5; i ++ ) { s += a * n2( p ); p = p * 2.02 + vec2( 1.7, 9.2 ); a *= 0.5; } return s; }
`;
function cloudMesh() {
  const m = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uFog: { value: new THREE.Color() }, uMoon: { value: new THREE.Vector3(0.25, 0.42, 0.87).normalize() }, uFlash: { value: 0 }, uFlashDir: { value: new THREE.Vector2(1, 0) }, uCover: { value: 0.62 }, uWind: { value: new THREE.Vector2(0.012, 0.005) } },
    vertexShader: 'varying vec3 vDir; void main(){ vDir = position; vec4 p = projectionMatrix * modelViewMatrix * vec4( position, 1.0 ); gl_Position = p.xyww; }',
    fragmentShader: /* glsl */`
      uniform float uTime; uniform vec3 uFog; uniform vec3 uMoon; uniform float uFlash; uniform vec2 uFlashDir; uniform float uCover; uniform vec2 uWind;
      varying vec3 vDir;
      ${SKY_NOISE}
      void main() {
        vec3 d = normalize( vDir );
        float up = d.y;
        if ( up < -0.03 ) discard;
        vec2 cp = d.xz / ( max( up, 0.0 ) + 0.1 ) * 0.75 + uWind * uTime;
        float c = fbm( cp ), c2 = fbm( cp * 2.7 + vec2( 5.2, 1.3 ) + uWind * uTime * 0.6 );
        float cov = smoothstep( 1.0 - uCover - 0.12, 1.0 - uCover + 0.22, c * 0.72 + c2 * 0.28 );
        float m = max( dot( d, uMoon ), 0.0 );
        float edge = cov * ( 1.0 - cov ) * 4.0;
        vec3 col = vec3( 0.022, 0.026, 0.036 ) + vec3( 0.03, 0.034, 0.045 ) * c2;
        col += vec3( 0.32, 0.37, 0.48 ) * pow( m, 14.0 ) * ( 0.25 + edge ) + vec3( 0.05, 0.06, 0.08 ) * pow( m, 3.0 ) * edge;
        // 遠方城市的光害映在雲底 + 兩處火光
        float az = atan( d.z, d.x );
        float low = exp( - up * 9.0 );
        col += vec3( 0.07, 0.045, 0.03 ) * low * cov;
        float fire = exp( - abs( az - 2.35 ) * 7.0 ) + 0.6 * exp( - abs( az + 0.9 ) * 9.0 );
        col += vec3( 0.32, 0.12, 0.03 ) * fire * exp( - up * 14.0 ) * ( 0.75 + 0.25 * sin( uTime * 2.3 + c * 9.0 ) ) * cov;
        // 閃電:雲朵從內部被照亮
        float fd = max( dot( normalize( d.xz + 1e-4 ), uFlashDir ), 0.0 );
        vec3 fl = vec3( 0.6, 0.66, 0.85 ) * uFlash * ( 0.2 + 0.8 * pow( fd, 4.0 ) ) * ( 0.35 + c2 * 1.1 );
        col += fl * ( 0.4 + cov );
        float a = max( cov * 0.93, uFlash * 0.5 * pow( fd, 2.0 ) ) * smoothstep( -0.03, 0.1, up );
        col = mix( uFog * 1.1, col, smoothstep( -0.02, 0.18, up ) * 0.85 + 0.15 );
        gl_FragColor = vec4( col, a );
      }`,
    transparent: true, depthWrite: false, depthTest: true, fog: false, side: THREE.BackSide,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(86, 32, 16), m);
  mesh.frustumCulled = false;
  mesh.renderOrder = -900;
  mesh.name = 'storm-clouds';
  return mesh;
}
function skylineMesh() {
  const m = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uFog: { value: new THREE.Color() }, uFlash: { value: 0 } },
    vertexShader: 'varying vec3 vDir; void main(){ vDir = position; vec4 p = projectionMatrix * modelViewMatrix * vec4( position, 1.0 ); p.z = p.w * 0.99999; gl_Position = p; }',
    fragmentShader: /* glsl */`
      uniform float uTime; uniform vec3 uFog; uniform float uFlash;
      varying vec3 vDir;
      ${SKY_NOISE}
      void main() {
        vec3 d = normalize( vDir );
        float az = atan( d.z, d.x );
        float el = d.y / max( length( d.xz ), 1e-4 );
        // 遠層:密集的低矮樓房
        float u1 = az * 41.0, i1 = floor( u1 ), f1 = fract( u1 );
        float H1 = 0.008 + 0.042 * pow( h1( i1 ), 2.2 ) + 0.012 * step( 0.8, h1( i1 + 3.0 ) ) * step( abs( f1 - 0.5 ), 0.2 );
        float b1 = step( 0.05, f1 ) * step( f1, 0.96 ) * step( el, H1 );
        // 近層:稀疏的高樓(有退縮的屋頂、天線)
        float u2 = az * 15.0 + 3.7, i2 = floor( u2 ), f2 = fract( u2 );
        float on2 = step( 0.42, h1( i2 + 11.0 ) ), w2 = 0.28 + 0.45 * h1( i2 + 5.0 );
        float H2 = 0.035 + 0.1 * pow( h1( i2 + 2.0 ), 1.4 );
        float in2 = on2 * step( abs( f2 - 0.5 ), w2 * 0.5 );
        float top2 = H2 + 0.012 * step( abs( f2 - 0.5 ), w2 * 0.22 );
        float ant = on2 * step( 0.55, h1( i2 + 7.0 ) ) * step( abs( f2 - 0.5 - w2 * 0.15 ), 0.0025 ) * step( el, top2 + 0.03 );
        float b2 = max( in2 * step( el, top2 ), ant );
        float ground = step( el, 0.002 );
        if ( b1 + b2 + ground < 0.5 ) discard;
        bool nearB = b2 > 0.5;
        float haze = smoothstep( -0.06, 0.04, el );
        vec3 col = uFog * mix( 0.62, nearB ? 0.38 : 0.5, haze );
        // 窗戶(少數亮著,偶爾閃爍)
        float k = nearB ? 1700.0 : 2400.0;
        vec2 wq = vec2( az * k, el * k * 1.15 );
        vec2 wi = floor( wq ), wf = fract( wq );
        float win = step( 0.28, wf.x ) * step( wf.x, 0.72 ) * step( 0.3, wf.y ) * step( wf.y, 0.78 ) * step( 0.0005, el ) * ( 1.0 - ground * step( el, 0.0 ) );
        float hw = h2( wi + ( nearB ? 7.0 : 0.0 ) );
        float lit = step( 0.968, hw ) * ( 0.65 + 0.35 * step( 0.3, fract( sin( floor( uTime * ( 0.2 + hw ) + hw * 50.0 ) ) * 4375.85 ) ) );
        vec3 wc = mix( vec3( 1.0, 0.72, 0.42 ), vec3( 0.65, 0.78, 1.0 ), step( 0.988, hw ) );
        col += wc * win * lit * 0.22 * ( b1 + b2 > 0.5 ? 1.0 : 0.0 );
        // 航空障礙燈(天線頂端,慢閃紅光)
        float tip = ant * step( top2 + 0.026, el );
        col += vec3( 1.0, 0.08, 0.05 ) * tip * step( 0.5, fract( uTime * 0.6 + h1( i2 ) ) ) * 2.0;
        // 閃電時剪影更暗(背光)
        col *= 1.0 - 0.35 * uFlash;
        gl_FragColor = vec4( col, 1.0 );
      }`,
    side: THREE.BackSide, depthWrite: true, depthTest: true, fog: false,
  });
  const g = new THREE.CylinderGeometry(80, 80, 32, 64, 1, true).translate(0, 7, 0);
  const mesh = new THREE.Mesh(g, m);
  mesh.frustumCulled = false;
  mesh.renderOrder = -999;
  mesh.name = 'skyline';
  return mesh;
}
// 閃電形狀(畫在 canvas 上的分岔閃電)
function boltMesh() {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 512;
  const x = c.getContext('2d');
  const branch = (px, py, ang, len, w, depth) => {
    let a = ang;
    x.beginPath(); x.moveTo(px, py);
    for (let s = 0; s < len; s += 10) {
      a += (Math.random() - 0.5) * 0.9;
      a = Math.max(Math.PI * 0.2, Math.min(Math.PI * 0.8, a));
      px += Math.cos(a) * 10; py += Math.sin(a) * 10;
      x.lineTo(px, py);
      if (depth < 2 && Math.random() < 0.08) { const sp = [px, py]; x.stroke(); branch(sp[0], sp[1], a + (Math.random() < 0.5 ? -0.6 : 0.6), len * 0.35, w * 0.55, depth + 1); x.beginPath(); x.moveTo(px, py); }
    }
    x.lineWidth = w; x.stroke();
  };
  x.strokeStyle = 'rgba(200,215,255,0.35)'; x.shadowColor = 'rgba(160,180,255,1)'; x.shadowBlur = 18;
  x.lineCap = 'round'; x.lineJoin = 'round';
  branch(128, 0, Math.PI / 2, 520, 9, 0);
  x.strokeStyle = 'rgba(245,248,255,1)'; x.shadowBlur = 6;
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  const m = new THREE.ShaderMaterial({
    uniforms: { uMap: { value: t }, uA: { value: 0 } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; vec4 p = projectionMatrix * modelViewMatrix * vec4( position, 1.0 ); gl_Position = p.xyww; }',
    fragmentShader: 'uniform sampler2D uMap; uniform float uA; varying vec2 vUv; void main(){ vec4 c = texture2D( uMap, vUv ); gl_FragColor = vec4( c.rgb * 2.2, c.a * uA ); }',
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(14, 28), m);
  mesh.frustumCulled = false;
  mesh.renderOrder = -899;
  mesh.visible = false;
  mesh.name = 'lightning-bolt';
  return mesh;
}

// ======================================================================
// 低霧:貼地霧片
// ======================================================================
function fogSheet(masks, y, channel, i) {
  const L = masks.W * 2, Hh = masks.H * 2;
  const g = new THREE.PlaneGeometry(L + 120, Hh + 120, 1, 1).rotateX(-Math.PI / 2).translate(L / 2 - 2, y, Hh / 2 - 2);
  const m = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uMask: { value: masks.fogTex }, uMaskXf: { value: masks.xf }, uCol: { value: new THREE.Color() }, uA: { value: 0.16 }, uFog: { value: 0.03 }, uFlash: { value: 0 }, uSeed: { value: i * 17.3 } },
    vertexShader: 'varying vec3 vW; varying float vD; void main(){ vec4 w = modelMatrix * vec4( position, 1.0 ); vW = w.xyz; vec4 mv = viewMatrix * w; vD = length( mv.xyz ); gl_Position = projectionMatrix * mv; }',
    fragmentShader: /* glsl */`
      uniform float uTime; uniform sampler2D uMask; uniform vec4 uMaskXf; uniform vec3 uCol; uniform float uA; uniform float uFog; uniform float uFlash; uniform float uSeed;
      varying vec3 vW; varying float vD;
      ${SKY_NOISE}
      void main() {
        vec2 p = vW.xz * 0.045 + vec2( uTime * 0.012, uTime * 0.004 ) + uSeed;
        float n = fbm( p ) * 0.7 + fbm( p * 2.6 - vec2( uTime * 0.01, 0.0 ) ) * 0.3;
        float m = texture2D( uMask, vW.xz * uMaskXf.xy + uMaskXf.zw ).${channel};
        float a = smoothstep( 0.32, 0.75, n ) * m * uA * smoothstep( 1.5, 7.0, vD ) * exp( - pow( uFog * vD * 0.5, 2.0 ) * 0.5 );
        if ( a < 0.003 ) discard;
        gl_FragColor = vec4( uCol * ( 1.0 + uFlash * 2.5 ), a );
      }`,
    transparent: true, depthWrite: false, fog: false, side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(g, m);
  mesh.frustumCulled = false;
  mesh.renderOrder = 8;
  mesh.name = 'fog-bank';
  return mesh;
}

// ======================================================================
// Weather
// ======================================================================
const QLEVEL = { low: 0, medium: 1, high: 2, ultra: 3 };
const RAIN_N = [1800, 3600, 6000, 9000], SPLASH_N = [0, 220, 420, 760], SHEETS_N = [0, 2, 3, 4];
export class Weather {
  constructor(game) {
    this.game = game;
    this.ok = false;
    try { this.init(game); this.ok = true; } catch (e) { console.warn('[weather] 初始化失敗', e); }
  }
  init(game) {
    const L = game.world.layout, scene = game.scene;
    this.L = L;
    this.root = new THREE.Group();
    this.root.name = 'weather';
    scene.add(this.root);
    const masks = (this.masks = buildMasks(L));
    this.rain = rainMesh(masks);
    this.splash = splashMesh(masks);
    this.clouds = cloudMesh();
    this.skyline = skylineMesh();
    this.bolt = boltMesh();
    const y1 = L.levels.find((l) => l.id === '1F')?.y ?? 0, yT = L.levels[L.levels.length - 1].y;
    this.sheets = [fogSheet(masks, y1 + 0.18, 'g', 0), fogSheet(masks, y1 + 0.55, 'g', 1), fogSheet(masks, y1 + 0.95, 'g', 2), fogSheet(masks, yT + 0.3, 'b', 3)];
    this.sheets[1].material.uniforms.uA.value = 0.12;
    this.sheets[2].material.uniforms.uA.value = 0.08;
    this.sheets[3].material.uniforms.uA.value = 0.1;
    this.root.add(this.rain, this.splash, this.clouds, this.skyline, this.bolt, ...this.sheets);
    // 戶外地板變濕(結構材質:先注入再交給原本的 hook)
    const WETS = { asphalt: [0.85, 0.42, 0.6], paving: [0.6, 0.36, 0.55], gravel: [0.25, 0.3, 0.45], grass: [0.0, 0.18, 0.3], roof_gravel: [0.55, 0.3, 0.5], metal_grate: [0, 0.15, 0.5], soil: [0.8, 0.35, 0.45] };
    for (const [k, [p, d, g]] of Object.entries(WETS)) { try { makeWet(surf(k), { puddle: p, darken: d, gloss: g }); } catch { /* 沒有這個材質 */ } }
    // 燈具調整(閃爍路燈、跟著亮度的燈罩)
    this.mods = [];
    const fx = game.hospital?.lights?.fixtures || [];
    for (const md of LIGHT_MODS) {
      let best = null, bd = 0.6;
      for (const f of fx) { const d = Math.abs(f.x - md.x) + Math.abs(f.y - md.y) + Math.abs(f.z - md.z); if (d < bd) { bd = d; best = f; } }
      if (!best) continue;
      if (md.mode) best.mode = md.mode;
      if (md.state !== undefined) best.state = md.state;
      if (md.glow !== undefined) best.glow = md.glow;
      if (md.mat) this.mods.push({ f: best, m: md.mat, ei: md.ei ?? md.mat.emissiveIntensity });
    }
    // 閃電
    this.atmo = game.hospital?.atmo || null;
    this.moonBase = this.atmo ? this.atmo.moon.intensity : 0;
    this.moonCol = this.atmo ? this.atmo.moon.color.clone() : new THREE.Color();
    this.flashCol = new THREE.Color(0xc8d8ff);
    this.nextStrike = 6 + Math.random() * 10;
    this.strikeT = -99; this.strikeK = 1; this.thunderAt = -1; this.thunderPow = 1;
    this.flash = 0;
    this.rainK = 0.8;
    this.q = -1;
    this.t = 0;
    // 每幀更新:接在 hospital.update 之後(atmosphere 已先設好霧色/環境光)
    const H = game.hospital;
    if (H && typeof H.update === 'function') {
      const base = H.update;
      H.update = (time, dt, player) => { base.call(H, time, dt, player); this.update(time, dt, player); };
    }
  }

  applyQuality() {
    const q = this.game.quality;
    const lv = q ? (QLEVEL[q.preset] ?? 2) : 2;
    const fogQ = q ? q.get('fog') : 'high';
    this.q = lv;
    ENV.q = lv;
    this.rain.geometry.instanceCount = RAIN_N[lv];
    this.splash.geometry.instanceCount = SPLASH_N[lv];
    this.splash.visible = SPLASH_N[lv] > 0;
    const ns = fogQ === 'low' ? 0 : SHEETS_N[lv];
    this.sheets.forEach((s, i) => { s.userData.on = i < Math.min(3, ns) || (i === 3 && ns >= 2); });
    WET.uRipple.value = lv >= 1 ? 1 : 0;
  }

  update(time, dt, player) {
    if (!this.ok) return;
    const g = this.game, cam = g.camera;
    if (this.q < 0 && g.quality) { this.applyQuality(); g.quality.on('change', () => this.applyQuality()); }
    this.t += dt;
    const t = this.t;
    // ---- 共用狀態 ----
    const p = player?.pos || cam.position;
    ENV.t = t; ENV.dt = dt; ENV.px = p.x; ENV.py = p.y; ENV.pz = p.z;
    const gust = Math.max(0, noise1(t * 0.13) * 0.9 + noise1(t * 0.41 + 7) * 0.35);
    ENV.gust = gust;
    ENV.wind = 0.55 + 0.25 * noise1(t * 0.05 + 3);
    WIND.uWindT.value = t % 3600; WIND.uWind.value = ENV.wind; WIND.uGust.value = gust;
    // 雨量:緩慢變化(毛毛雨 ↔ 大雨),地面濕度跟著
    const target = clamp(0.72 + 0.28 * noise1(t * 0.011 + 1.3) + 0.15 * Math.max(0, noise1(t * 0.037)), 0.35, 1);
    this.rainK += (target - this.rainK) * Math.min(1, dt * 0.2);
    ENV.rain = this.rainK;
    ENV.wet = WET.uWet.value = clamp(0.62 + this.rainK * 0.4, 0, 1);
    WET.uRain.value = this.rainK;
    WET.uRainT.value = t % 1000;
    const out = this.atmo ? this.atmo.current.out : 1;
    ENV.out = out;
    // ---- 玩家附近有沒有露天 ----
    const L = this.L;
    const li = Math.max(0, L.levelOfY(p.y + 0.3));
    const c = Math.floor(p.x / L.CELL), r = Math.floor(p.z / L.CELL);
    const nearOpen = c < 0 || r < 0 || c >= L.W || r >= L.H || this.masks.near[li][r * L.W + c] === 1;
    const b1 = L.levels[li].id === 'B1';
    // ---- 雨 ----
    const ru = this.rain.material.uniforms;
    this.rain.visible = nearOpen;
    this.splash.visible = nearOpen && this.splash.geometry.instanceCount > 0;
    ru.uTime.value = t % 2000;
    ru.uCam.value.copy(cam.position);
    ru.uInt.value = 0.35 + 0.65 * this.rainK;
    ru.uVel.value.set(0.6 + 1.6 * ENV.wind + gust * 1.5, -11.5, 0.3 + 0.6 * gust);
    const h = g.renderer.domElement.height || 720;
    ru.uPx.value = 2 / (h * cam.projectionMatrix.elements[5]);
    const fogC = g.scene.fog ? g.scene.fog.color : this.moonCol;
    ru.uCol.value.setRGB(0.42 + fogC.r * 2, 0.46 + fogC.g * 2, 0.54 + fogC.b * 2).multiplyScalar(0.6 + this.flash * 3);
    const su = this.splash.material.uniforms;
    su.uTime.value = t % 2000; su.uCam.value.copy(cam.position); su.uInt.value = this.rainK;
    // ---- 天空層跟著鏡頭 ----
    this.clouds.position.copy(cam.position);
    this.skyline.position.copy(cam.position);
    const cu = this.clouds.material.uniforms, ku = this.skyline.material.uniforms;
    cu.uTime.value = t % 5000; ku.uTime.value = t % 5000;
    cu.uFog.value.copy(fogC); ku.uFog.value.copy(fogC);
    cu.uWind.value.set(0.006 + 0.01 * ENV.wind, 0.003);
    cu.uCover.value = 0.55 + 0.25 * this.rainK;
    this.clouds.visible = this.skyline.visible = !b1;
    // ---- 霧片 ----
    const fd = g.scene.fog ? g.scene.fog.density : 0.03;
    for (let i = 0; i < this.sheets.length; i++) {
      const s = this.sheets[i];
      s.visible = !!s.userData.on && !b1 && (i < 3 ? li <= 1 || out > 0.5 : li >= L.levels.length - 2);
      if (!s.visible) continue;
      const u = s.material.uniforms;
      u.uTime.value = t % 5000; u.uFog.value = fd; u.uFlash.value = this.flash * out;
      u.uCol.value.copy(fogC).multiplyScalar(1.6).addScalar(0.015);
    }
    // ---- 閃電 ----
    this.updateLightning(t, dt, out, b1);
    // ---- 燈具/霓虹 ----
    for (let i = 0; i < this.mods.length; i++) { const md = this.mods[i]; md.m.emissiveIntensity = md.ei * (md.f.cur ?? 1); }
    for (let i = 0; i < GLOWS.length; i++) { const gl = GLOWS[i]; gl.m.emissiveIntensity = gl.ei * gl.fn(t); }
    // 下雨時能見度稍差
    if (g.scene.fog && out > 0.01) g.scene.fog.density *= 1 + 0.18 * this.rainK * out;
  }

  updateLightning(t, dt, out, b1) {
    if (t > this.nextStrike) {
      this.strikeT = t;
      this.nextStrike = t + 14 + Math.random() * 26;
      const a = Math.random() * Math.PI * 2;
      this.clouds.material.uniforms.uFlashDir.value.set(Math.cos(a), Math.sin(a));
      this.strikeK = 0.55 + Math.random() * 0.45;
      const dist = 0.3 + Math.random() * 0.7; // 0 近 .. 1 遠
      this.thunderAt = t + 0.6 + dist * 4.5;
      this.thunderPow = 1.15 - dist * 0.6;
      this.boltShow = Math.random() < 0.65;
      // 閃電形狀:擺在閃光方向的遠方
      const bd = 78;
      this.bolt.position.set(Math.cos(a) * bd, 14 + Math.random() * 4, Math.sin(a) * bd);
      this.bolt.lookAt(0, this.bolt.position.y, 0);
      this.bolt.scale.set(Math.random() < 0.5 ? -1 : 1, 1, 1);
      this.boltOff = this.bolt.position.clone();
    }
    // 閃光波形:主閃 + 兩次餘閃
    const k = t - this.strikeT;
    let f = 0;
    if (k >= 0 && k < 1.2) {
      f = Math.exp(-(((k - 0.03) / 0.045) ** 2)) + 0.55 * Math.exp(-(((k - 0.21) / 0.05) ** 2)) + 0.8 * Math.exp(-(((k - 0.46) / 0.07) ** 2)) + 0.25 * Math.exp(-(((k - 0.75) / 0.12) ** 2));
      f = Math.min(1, f) * this.strikeK;
    }
    this.flash = f;
    ENV.flash = f;
    const vis = b1 ? 0 : 1;
    this.clouds.material.uniforms.uFlash.value = f * vis;
    this.skyline.material.uniforms.uFlash.value = f * vis;
    this.bolt.visible = !!this.boltShow && vis > 0 && k >= 0 && k < 0.55 && f > 0.25;
    if (this.bolt.visible) { this.bolt.position.copy(this.boltOff).add(this.game.camera.position); this.bolt.material.uniforms.uA.value = Math.min(1, f * 1.3); }
    // 月光平行光閃一下(陰影擋住室內;沒開陰影時只在戶外閃)
    if (this.atmo) {
      const sh = this.game.renderer.shadowMap.enabled ? 1 : out;
      const moon = this.atmo.moon;
      if (f > 0.001 || this._flashOn) {
        moon.intensity = this.moonBase + f * 9 * sh * vis;
        moon.color.copy(this.moonCol).lerp(this.flashCol, Math.min(1, f * 1.5));
        this.atmo.hemi.intensity += f * 0.9 * out * vis;
        if (this.game.scene.fog) this.game.scene.fog.color.addScalar(f * 0.05 * out * vis);
        this._flashOn = f > 0.001;
      }
    }
    // 雷聲(距離越遠越晚、越小)
    if (this.thunderAt > 0 && t >= this.thunderAt) {
      this.thunderAt = -1;
      try {
        if (typeof sfx.thunder === 'function') sfx.thunder(this.thunderPow);
        else AUDIO?.AMB?.EVENTS?.thunder?.(); // 音效模組還沒有公開的 thunder:暫用環境音事件
      } catch { /* 音效失敗不影響遊戲 */ }
    }
  }
}
