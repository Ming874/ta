import * as THREE from 'three';
import { prng } from './paint.js';

// 結構表面的「歲月」層:一張可平鋪的 RGBA 雜訊貼圖 + 著色器片段,依世界座標(不會跟著貼圖重複)疊上
// 牆腳污漬帶、天花板漏水的水漬圈(潮痕)、往下流的污痕、霉斑、地板髒污與積水、天花板水損。
// 每個頂點有 aWear(0 乾淨 ~ 1 破舊;每面牆/每區不同),每種材質有 uWear(髒污、水漬、霉、潮濕)強度。
// 雜訊通道:R = 大塊 fbm(水漬)、G = 中頻高對比 fbm(剝落/霉)、B = 縱向條紋(流痕)、A = 細胞斑點(霉點/滴痕頭)
let tex = null;
export function wearTexture() {
  if (tex) return tex;
  const N = 256, data = new Uint8Array(N * N * 4), R = prng(0x5eed);
  const lattice = (n) => { const a = new Float32Array(n); for (let i = 0; i < n; i++) a[i] = R(); return a; };
  const vn = (L, Px, Py, x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi;
    const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    const x0 = ((xi % Px) + Px) % Px, x1 = (x0 + 1) % Px, y0 = ((yi % Py) + Py) % Py, y1 = (y0 + 1) % Py;
    const a = L[y0 * Px + x0], b = L[y0 * Px + x1], c = L[y1 * Px + x0], d = L[y1 * Px + x1];
    return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
  };
  // 可平鋪 fbm:第 k 個八度的週期 = base × 2^k(格數必須整除才能無縫)
  const fbm = (px, py, oct, gain = 0.5) => {
    const lats = [];
    for (let k = 0; k < oct; k++) lats.push({ L: lattice((px << k) * (py << k)), Px: px << k, Py: py << k });
    return (u, v) => { let s = 0, a = 1, n = 0; for (const o of lats) { s += a * vn(o.L, o.Px, o.Py, u * o.Px, v * o.Py); n += a; a *= gain; } return s / n; };
  };
  const fR = fbm(4, 4, 5, 0.55), fG = fbm(8, 8, 4, 0.6), fB = fbm(32, 3, 3, 0.45);
  // 細胞斑點(F1 距離,12×12 格)
  const C = 12, pts = new Float32Array(C * C * 2);
  for (let i = 0; i < C * C; i++) { pts[i * 2] = R(); pts[i * 2 + 1] = R(); }
  const cell = (u, v) => {
    const x = u * C, y = v * C, xi = Math.floor(x), yi = Math.floor(y);
    let d = 9;
    for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
      const cx = xi + i, cy = yi + j, k = (((cy % C) + C) % C) * C + (((cx % C) + C) % C);
      const dx = cx + pts[k * 2] - x, dy = cy + pts[k * 2 + 1] - y;
      d = Math.min(d, dx * dx + dy * dy);
    }
    return Math.sqrt(d);
  };
  const ch = [new Float32Array(N * N), new Float32Array(N * N), new Float32Array(N * N), new Float32Array(N * N)];
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const u = x / N, v = y / N, i = y * N + x;
    ch[0][i] = fR(u, v);
    ch[1][i] = fG(u, v);
    ch[2][i] = fB(u, v);
    ch[3][i] = 1 - Math.min(1, cell(u, v) * 1.6);
  }
  // 每個通道拉伸到 0..1(G 再加對比)
  for (let c = 0; c < 4; c++) {
    let lo = 1e9, hi = -1e9;
    for (const v of ch[c]) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
    for (let i = 0; i < N * N; i++) {
      let v = (ch[c][i] - lo) / (hi - lo || 1);
      if (c === 1) v = v * v * (3 - 2 * v);
      data[i * 4 + c] = Math.round(v * 255);
    }
  }
  tex = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.colorSpace = THREE.NoColorSpace;
  tex.needsUpdate = true;
  return tex;
}

// ---- 頂點著色器 ----
export const WEAR_VERT_PARS = /* glsl */`
attribute float aWear;
varying vec3 vWPos;
varying vec3 vWNrm;
varying float vWear;
`;
export const WEAR_VERT = /* glsl */`
	vWPos = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;
	vWNrm = normalize( mat3( modelMatrix ) * objectNormal );
	vWear = aWear;
`;

// ---- 片段著色器 ----
// uWear = (髒污, 水漬/流痕, 霉, 積水);uWear2 = (剝落量, 剝落雜訊尺度, 未用, 未用)
export const WEAR_FRAG_PARS = /* glsl */`
uniform sampler2D tWear;
uniform vec4 uWear;
uniform vec4 uWear2;
varying vec3 vWPos;
varying vec3 vWNrm;
varying float vWear;
`;
// 先算出遮罩(map 之前):wxKind 0 牆 / 1 地 / 2 天花;wxPeel 剝落;wxWet 積水
export const WEAR_SETUP = /* glsl */`
	vec3 wxN = normalize( vWNrm );
	vec3 wxA = abs( wxN );
	float wxIsFloor = step( 0.6, wxN.y ), wxIsCeil = step( 0.6, - wxN.y );
	vec2 wxUv = wxA.y > 0.6 ? vWPos.xz : ( wxA.x > wxA.z ? vec2( vWPos.z, vWPos.y ) : vec2( vWPos.x, vWPos.y ) );
	float wxH = mod( vWPos.y + 4.2005, 4.2 );
	vec4 wxNA = texture2D( tWear, wxUv * vec2( 0.09, 0.12 ) );
	vec4 wxNB = texture2D( tWear, wxUv * 0.33 + vec2( 0.31, 0.57 ) );
	float wxW = clamp( vWear, 0.0, 1.0 );
	float wxPeel = 0.0, wxWet = 0.0, wxRough = 0.0;
	{
		// 剝落:中頻雜訊 × 每面牆的破舊度;牆腳(反潮)與牆頂(漏水)更容易剝
		float pn = texture2D( tWear, wxUv * uWear2.y + vec2( 0.13, 0.71 ) ).g * 0.75 + wxNA.r * 0.25;
		float edge = ( 1.0 - smoothstep( 0.0, 0.9, wxH ) ) * 0.22 + smoothstep( 2.4, 3.4, wxH ) * 0.12;
		float th = 1.02 - uWear2.x * ( 0.25 + 0.6 * wxW * wxW ) - edge * wxW;
		wxPeel = ( 1.0 - wxIsFloor - wxIsCeil ) * smoothstep( th, th + 0.035, pn );
	}
`;
// 顏色(color_fragment 之後)
export const WEAR_ALBEDO = /* glsl */`
	{
		vec3 wc = vec3( 1.0 );
		if ( wxIsFloor + wxIsCeil < 0.5 ) {
			// 大面積的不均勻(老化、清潔不均)+ 越破舊越灰暗
			wc *= mix( 1.0, 0.8 + 0.34 * wxNA.g, uWear.x * 0.55 );
			wc *= 1.0 - 0.16 * wxW * uWear.x;
			// 牆腳污漬帶(高度不規則)
			float band = 1.0 - smoothstep( 0.02, 0.14 + 0.32 * wxNB.g * ( 0.4 + wxW ), wxH );
			wc *= mix( vec3( 1.0 ), vec3( 0.5, 0.46, 0.4 ), band * uWear.x * ( 0.45 + 0.55 * wxW ) );
			// 天花板漏水的水漬(內部泛黃、邊緣一圈深色潮痕)
			float st = wxNA.r * 0.82 + wxNB.r * 0.18 + smoothstep( 1.8, 3.4, wxH ) * 0.2 - ( 1.0 - wxW ) * 0.22;
			float th = 0.8 - 0.16 * uWear.y;
			float ins = smoothstep( th, th + 0.06, st );
			float rim = smoothstep( th - 0.014, th, st ) * ( 1.0 - smoothstep( th + 0.004, th + 0.03, st ) );
			wc *= mix( vec3( 1.0 ), vec3( 0.84, 0.76, 0.6 ), ins * uWear.y * 0.75 );
			wc *= mix( vec3( 1.0 ), vec3( 0.55, 0.45, 0.32 ), rim * uWear.y * 0.9 );
			// 由上往下的流痕
			float sk = texture2D( tWear, vec2( wxUv.x * 0.5, wxUv.y * 0.07 ) + vec2( 0.7, 0.2 ) ).b;
			sk = smoothstep( 0.58, 0.9, sk ) * smoothstep( 0.6, 3.3, wxH ) * uWear.y * ( 0.25 + wxW );
			wc *= 1.0 - 0.32 * sk;
			// 霉(牆腳與零星斑點)
			float md = wxNB.g * 0.6 + wxNA.a * 0.25 + ( 1.0 - smoothstep( 0.0, 1.1, wxH ) ) * 0.3 + smoothstep( 2.9, 3.4, wxH ) * 0.12;
			md = smoothstep( 0.66, 0.86, md ) * uWear.z * ( 0.3 + wxW );
			wc *= mix( vec3( 1.0 ), vec3( 0.3, 0.34, 0.24 ), clamp( md, 0.0, 1.0 ) );
			wxRough += md * 0.2 + band * 0.08;
		} else if ( wxIsFloor > 0.5 ) {
			// 地板:大片髒污(走道磨亮、角落積灰由頂點色處理)
			float d = smoothstep( 0.42, 0.86, wxNA.r * 0.65 + wxNB.g * 0.35 );
			wc *= mix( vec3( 1.0 ), vec3( 0.6, 0.56, 0.48 ), d * uWear.x * ( 0.35 + 0.65 * wxW ) );
			wxRough += d * uWear.x * 0.12;
			// 積水:暗、亮面、法線變平
			float wet = wxNA.g * 0.7 + wxNB.r * 0.3;
			float wt = 0.86 - 0.3 * uWear.w;
			wxWet = smoothstep( wt, wt + 0.03, wet ) * step( 0.01, uWear.w );
			wc *= 1.0 - 0.28 * wxWet;
			wc *= mix( vec3( 1.0 ), vec3( 0.7, 0.62, 0.5 ), smoothstep( wt - 0.05, wt, wet ) * ( 1.0 - wxWet ) * step( 0.01, uWear.w ) * 0.6 );
		} else {
			// 天花板水損:泛黃水漬 + 深色潮痕
			float st = wxNA.r * 0.8 + wxNB.r * 0.2 - ( 1.0 - wxW ) * 0.28;
			float th = 0.76 - 0.14 * uWear.y;
			float ins = smoothstep( th, th + 0.05, st );
			float rim = smoothstep( th - 0.012, th, st ) * ( 1.0 - smoothstep( th + 0.003, th + 0.025, st ) );
			wc *= mix( vec3( 1.0 ), vec3( 0.78, 0.68, 0.5 ), ins * uWear.y );
			wc *= mix( vec3( 1.0 ), vec3( 0.48, 0.38, 0.26 ), rim * uWear.y );
			float md = smoothstep( 0.72, 0.9, wxNB.g * 0.7 + wxNA.a * 0.3 ) * uWear.z * wxW;
			wc *= mix( vec3( 1.0 ), vec3( 0.3, 0.32, 0.25 ), md );
		}
		diffuseColor.rgb *= wc;
	}
`;
