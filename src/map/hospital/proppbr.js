import * as THREE from 'three';
import { pbrTex, PBR_SETS } from './pbr.js';
import { forEachMat } from '../materials.js';

// 道具材質的 PBR 細節:道具網格的 UV 各式各樣(而且靜態道具會合併到世界座標),所以用「物件空間三平面投影」——
// 依模型座標(合併後就是世界座標;實例化/可動道具是模板座標 → 會跟著物體走)從三個方向取樣同一組貼圖,依法線混合。
// 原本的顏色保留(貼圖只提供明暗/色差細節、粗糙度變化與凹凸),所以綠色烤漆櫃子還是綠的,只是多了刮痕與鏽點。
// 規則:[材質鍵 regex, 貼圖組, 一張貼圖幾公尺, 模式('rgb' 用貼圖的色差 / 'lum' 只用明暗), 強度, 凹凸]
const RULES = [
  [/^(pi_m_)?wood|^pi_wood|wood_(dark|light|old|toy)/, 'wood_old', 0.9, 'rgb', 0.85, 1.2],
  [/^metal_|^pi_enamel|^pi_m_enamel/, 'metal_painted', 0.7, 'rgb', 0.75, 0.8],
  [/^(steel|chrome|aluminum|cast_iron)$|^pi_(galv|brass|steel|gold)|^pi_dyn_metal$/, 'steel', 0.5, 'lum', 0.55, 0.4],
  [/rust/, 'rust', 0.9, 'rgb', 0.85, 1.4],
  [/^fabric_|^pi_(fab|plush|cloth|gauze|mattress|lead_apron)|^pi_m_(linen|mattress)/, 'fabric', 0.3, 'lum', 0.7, 1.2],
  [/^leather$|^vinyl|^pi_(vinyl|leather)/, 'leather', 0.35, 'lum', 0.6, 0.9],
  [/cardboard/, 'cardboard', 0.6, 'rgb', 0.85, 0.8],
  [/^(stone_statue|marble)$|^pi_plaster$/, 'concrete', 1.0, 'lum', 0.55, 0.8],
  [/^plastic_|^pi_pl_|^pi_dyn_gloss$/, 'plaster_paint', 1.4, 'lum', 0.22, 0.25],
  [/^pi_dyn_matte$/, 'fabric', 0.4, 'lum', 0.35, 0.6],
];
const SKIP = /^(pi_lab|pi_glow|pi_decal|pi_noise|pi_clear|glass|screen|glow_|flame|water|paper)/;
const VERT_PARS = 'varying vec3 vTriP;\nvarying vec3 vTriN;\n';
const FRAG_PARS = `
varying vec3 vTriP;
varying vec3 vTriN;
uniform sampler2D tTriC;
uniform sampler2D tTriO;
uniform vec4 uTri;
uniform vec3 uTriAvg;
vec3 triPerturb( vec3 surf_pos, vec3 surf_norm, vec2 dHdxy, float faceDir ) {
	vec3 vSigmaX = normalize( dFdx( surf_pos ) ), vSigmaY = normalize( dFdy( surf_pos ) );
	vec3 R1 = cross( vSigmaY, surf_norm ), R2 = cross( surf_norm, vSigmaX );
	float fDet = dot( vSigmaX, R1 ) * faceDir;
	vec3 vGrad = sign( fDet ) * ( dHdxy.x * R1 + dHdxy.y * R2 );
	return normalize( abs( fDet ) * surf_norm - vGrad );
}
`;
function hook(shader) {
  const U = this.userData.tri;
  Object.assign(shader.uniforms, U);
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>\n' + VERT_PARS)
    .replace('#include <begin_vertex>', '#include <begin_vertex>\n\tvTriP = position;\n\tvTriN = normal;');
  shader.fragmentShader = shader.fragmentShader
    .replace('void main() {', FRAG_PARS + 'void main() {')
    .replace('#include <map_fragment>', `#include <map_fragment>
	vec3 tN = normalize( vTriN );
	vec3 tw = pow( abs( tN ), vec3( 4.0 ) ); tw /= max( 1e-4, tw.x + tw.y + tw.z );
	vec3 tp = vTriP * uTri.x;
	vec4 tc = texture2D( tTriC, tp.zy ) * tw.x + texture2D( tTriC, tp.xz ) * tw.y + texture2D( tTriC, tp.xy ) * tw.z;
	float tL = dot( tc.rgb, vec3( 0.299, 0.587, 0.114 ) ), aL = max( 0.02, dot( uTriAvg, vec3( 0.299, 0.587, 0.114 ) ) );
	vec3 tr = uTri.w > 0.5 ? tc.rgb / max( uTriAvg, vec3( 0.02 ) ) : vec3( tL / aL );
	diffuseColor.rgb *= mix( vec3( 1.0 ), clamp( tr, 0.0, 2.5 ), uTri.y );`)
    .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
	vec4 to = texture2D( tTriO, tp.zy ) * tw.x + texture2D( tTriO, tp.xz ) * tw.y + texture2D( tTriO, tp.xy ) * tw.z;
	roughnessFactor = clamp( roughnessFactor * mix( 1.0, to.g * 1.5, uTri.y * 0.6 ), 0.04, 1.0 );
	diffuseColor.rgb *= mix( 1.0, to.r, 0.35 * uTri.y );`)
    .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
	normal = triPerturb( - vViewPosition, normal, vec2( dFdx( tL ), dFdy( tL ) ) * uTri.z, faceDirection );`);
}
const _c = new THREE.Color();
const done = new WeakSet();
// 把目前所有道具材質依規則升級(可重複呼叫;已升級的跳過)
export function upgradePropMaterials() {
  let n = 0;
  forEachMat((m, key) => {
    if (!m || !m.isMeshStandardMaterial || done.has(m) || m.map || m.transparent || m.onBeforeCompile !== THREE.Material.prototype.onBeforeCompile || SKIP.test(key)) return;
    if (m.emissive && m.emissive.getHex() && m.emissiveIntensity > 0) return;
    const rule = RULES.find(([re]) => re.test(key));
    if (!rule) return;
    const [, set, tile, mode, k, bump] = rule;
    if (!PBR_SETS[set]) return;
    _c.set(PBR_SETS[set].avg);
    m.userData.tri = {
      tTriC: { value: pbrTex(set, 'color', { tile: 1 }) }, tTriO: { value: pbrTex(set, 'orm', { tile: 1 }) },
      uTri: { value: new THREE.Vector4(1 / tile, k, bump, mode === 'rgb' ? 1 : 0) }, uTriAvg: { value: new THREE.Vector3(_c.r, _c.g, _c.b) },
    };
    m.onBeforeCompile = hook;
    m.customProgramCacheKey = () => 'tri';
    m.needsUpdate = true;
    done.add(m);
    n++;
  });
  return n;
}
