import * as THREE from 'three';

// Shared season-field uniforms and GLSL. Every material that reacts to the
// lantern (terrain, grass, foliage, props) references the *same* uniform
// objects, so updating them once per frame moves the effect everywhere.
//
// uSeasonKind: 0 none, 1 spring, 2 winter, 3 autumn, 4 storm.

export const SEASON_KIND = { spring: 1, winter: 2, autumn: 3, storm: 4 };

export const seasonUniforms = {
  uSeasonPos: { value: new THREE.Vector3() },
  uSeasonRadius: { value: 0 },
  uSeasonAmt: { value: 0 },
  uSeasonKind: { value: 0 },
  uSeasonTime: { value: 0 },
  uPlayerPos: { value: new THREE.Vector3(0, -100, 0) },
};

export function updateSeasonUniforms(field, time, player) {
  const u = seasonUniforms;
  u.uSeasonPos.value.set(field.x, field.y, field.z);
  u.uSeasonRadius.value = field.radius;
  u.uSeasonAmt.value = field.intensity;
  u.uSeasonKind.value = field.season ? SEASON_KIND[field.season] : 0;
  u.uSeasonTime.value = time;
  if (player) u.uPlayerPos.value.set(player.x, player.y, player.z);
}

export const seasonPars = /* glsl */ `
uniform vec3 uSeasonPos;
uniform float uSeasonRadius;
uniform float uSeasonAmt;
uniform int uSeasonKind;
uniform float uSeasonTime;
float seasonWeight(vec3 wp) {
  if (uSeasonKind == 0) return 0.0;
  float d = distance(wp.xz, uSeasonPos.xz);
  return uSeasonAmt * (1.0 - smoothstep(uSeasonRadius * 0.65, uSeasonRadius, d));
}
// Thin bright ring at the edge of the field so its reach is readable.
float seasonRing(vec3 wp) {
  if (uSeasonKind == 0) return 0.0;
  float d = distance(wp.xz, uSeasonPos.xz);
  float wob = sin(atan(wp.z - uSeasonPos.z, wp.x - uSeasonPos.x) * 9.0 + uSeasonTime * 1.5) * 0.25;
  return uSeasonAmt * smoothstep(0.55, 0.0, abs(d - uSeasonRadius * 0.86 + wob));
}
vec3 seasonRingColor() {
  if (uSeasonKind == 1) return vec3(0.65, 1.0, 0.45);
  if (uSeasonKind == 2) return vec3(0.7, 0.9, 1.0);
  if (uSeasonKind == 3) return vec3(1.0, 0.6, 0.2);
  return vec3(0.7, 0.6, 1.0);
}
// foliage: 0 = ground/stone, 1 = leaves/grass.  up: how much the surface faces the sky.
vec3 seasonColor(vec3 c, vec3 wp, float foliage, float up) {
  float w = seasonWeight(wp);
  if (w > 0.001) {
    float lum = dot(c, vec3(0.3, 0.55, 0.15));
    if (uSeasonKind == 1) {
      // Spring: lush, saturated, a little brighter.
      vec3 lush = c * mix(vec3(1.03, 1.05, 1.0), vec3(0.92, 1.18, 0.86), foliage) + vec3(0.02, 0.05, 0.0) * foliage;
      c = mix(c, lush, w);
    } else if (uSeasonKind == 2) {
      // Winter: snow settles on anything facing up; foliage goes frosty blue-grey.
      float snow = smoothstep(0.35, 0.85, up);
      vec3 frost = mix(vec3(lum) * vec3(0.85, 0.92, 1.05), vec3(0.93, 0.96, 1.0), snow);
      c = mix(c, frost, w * mix(0.65, 1.0, snow));
    } else if (uSeasonKind == 3) {
      // Autumn: greens ramp to amber and rust, ground gets drier.
      float n = fract(sin(dot(floor(wp.xz * 0.7), vec2(12.9898, 78.233))) * 43758.5453);
      vec3 amber = mix(vec3(0.85, 0.42, 0.12), vec3(0.72, 0.22, 0.1), n) * (0.6 + lum * 1.1);
      vec3 dry = c * vec3(1.08, 0.92, 0.7);
      c = mix(c, mix(dry, amber, foliage), w);
    } else {
      // Storm: cold, dark and desaturated.
      c = mix(c, vec3(lum) * vec3(0.62, 0.66, 0.82), w * 0.75);
    }
  }
  return c;
}
`;

/** Inject the season chunk into a Lambert/Standard material's fragment stage. */
export function patchSeasonFragment(shader, { foliage = '0.0', up = '1.0', ring = true } = {}) {
  Object.assign(shader.uniforms, seasonUniforms);
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', `#include <common>\n${seasonPars}`)
    .replace(
      '#include <color_fragment>',
      `#include <color_fragment>
diffuseColor.rgb = seasonColor(diffuseColor.rgb, vSeasonWorld, ${foliage}, ${up});
${ring ? 'vSeasonRingAmt = seasonRing(vSeasonWorld);' : ''}`,
    )
    .replace(
      '#include <emissivemap_fragment>',
      `#include <emissivemap_fragment>
${ring ? 'totalEmissiveRadiance += seasonRingColor() * vSeasonRingAmt * 0.55;' : ''}`,
    );
  shader.fragmentShader = shader.fragmentShader.replace('void main() {', `varying vec3 vSeasonWorld;\nfloat vSeasonRingAmt = 0.0;\nvoid main() {`);
}

/** Vertex side: provide world position (handles instancing). */
export function patchSeasonVertex(shader) {
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>\nvarying vec3 vSeasonWorld;')
    .replace(
      '#include <worldpos_vertex>',
      `#include <worldpos_vertex>
{
  vec4 sw = vec4(transformed, 1.0);
  #ifdef USE_INSTANCING
  sw = instanceMatrix * sw;
  #endif
  vSeasonWorld = (modelMatrix * sw).xyz;
}`,
    );
}

seasonUniforms.uWindAmt = { value: 1 };

const UP_FROM_DERIVATIVES = 'abs(normalize(cross(dFdx(vSeasonWorld), dFdy(vSeasonWorld))).y)';
const GREENISH = 'smoothstep(0.0, 0.07, diffuseColor.g - max(diffuseColor.r, diffuseColor.b) * 0.92)';

/**
 * Season-aware vertex-coloured Lambert material. With `sway`, green
 * vertices (leaves) move in the wind; trunks and stone stay put.
 */
export function createSeasonMaterial({ sway = false, name = 'props', ...params } = {}) {
  const material = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, ...params });
  material.onBeforeCompile = (shader) => {
    patchSeasonVertex(shader);
    if (sway) {
      shader.uniforms.uWindAmt = seasonUniforms.uWindAmt;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uSeasonTime;\nuniform float uWindAmt;')
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
#ifdef USE_COLOR
{
  float leaf = smoothstep(0.0, 0.06, color.g - max(color.r, color.b) * 0.92);
  vec3 base = vec3(0.0);
  #ifdef USE_INSTANCING
  base = (instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  #endif
  float h = clamp(transformed.y / 6.0, 0.0, 1.0);
  float t = uSeasonTime;
  float gust = 0.6 + 0.4 * sin(t * 0.37 + base.x * 0.05);
  float s = sin(t * 1.6 + base.x * 0.31 + base.z * 0.17 + transformed.y * 0.6) * 0.09 * uWindAmt * gust;
  transformed.x += s * leaf * h * 1.5;
  transformed.z += s * 0.6 * leaf * h;
  transformed.y += sin(t * 3.1 + transformed.x * 2.0 + transformed.z) * 0.02 * leaf * uWindAmt;
}
#endif`,
        );
    }
    patchSeasonFragment(shader, { foliage: GREENISH, up: UP_FROM_DERIVATIVES });
  };
  material.customProgramCacheKey = () => `season-${name}-${sway ? 1 : 0}`;
  return material;
}

export { UP_FROM_DERIVATIVES, GREENISH };
