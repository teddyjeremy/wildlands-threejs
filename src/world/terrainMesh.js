import * as THREE from 'three';
import { createRandom } from '../procedural/random.js';

// Builds the faceted island mesh from the shared height grid and patches
// the standard Lambert material with three extras:
//   - trail darkening from the TrailGrid texture
//   - rain wetness, stronger in low ground
//   - developer overlays (trail heat, region map, slope map, grid lines)

const C = (hex) => new THREE.Color(hex);
const COLORS = {
  deep: C('#4d6f73'),
  wetSand: C('#bda57a'),
  sand: C('#e3cf9b'),
  grass: C('#86ab52'),
  grassDark: C('#6a9442'),
  forest: C('#557f38'),
  wetland: C('#6b8a4a'),
  rock: C('#8f8578'),
  rockHigh: C('#a69d8f'),
  path: C('#b99c6c'),
  plaza: C('#bfa57c'),
};
const REGION_DEBUG = {
  sea: C('#2a4d8f'), beach: C('#f0d98a'), cove: C('#ffb36b'), village: C('#e46f6f'), forest: C('#2f7d3a'),
  ridge: C('#9a8f86'), wetland: C('#3fb0b0'), lighthouse: C('#ffffff'), cave: C('#5b3f7a'), meadow: C('#9ccf5c'),
};

export function buildTerrainMesh(terrain, seed) {
  const { N, half, cell } = terrain.grid;
  const rng = createRandom(`${seed}:terrain-colour`);
  const H = (i, j) => terrain.grid.heights[j * (N + 1) + i];

  const triCount = N * N * 2;
  const pos = new Float32Array(triCount * 9);
  const col = new Float32Array(triCount * 9);
  const dbgRegion = new Float32Array(triCount * 9);
  const dbgSlope = new Float32Array(triCount * 9);
  const tmp = new THREE.Color();
  let o = 0;

  const writeTri = (ax, ay, az, bx, by, bz, cx, cy, cz) => {
    const mx = (ax + bx + cx) / 3;
    const mz = (az + bz + cz) / 3;
    const my = (ay + by + cy) / 3;
    // Face normal (y component) for slope colouring.
    const ux = bx - ax, uy = by - ay, uz = bz - az;
    const vx = cx - ax, vy = cy - ay, vz = cz - az;
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    const slope = 1 - Math.abs(ny) / Math.hypot(nx, ny, nz);

    const ground = terrain.groundTypeAt(mx, mz);
    const region = terrain.regionAt(mx, mz);
    if (my < -0.2) tmp.copy(COLORS.wetSand).lerp(COLORS.deep, Math.min(1, -my / 5));
    else if (ground === 'water') tmp.copy(COLORS.wetSand);
    else if (ground === 'sand') tmp.copy(COLORS.sand).lerp(COLORS.wetSand, my < 0.5 ? 0.5 : 0);
    else if (ground === 'rock') tmp.copy(COLORS.rock).lerp(COLORS.rockHigh, Math.min(1, Math.max(0, (my - 10) / 10)));
    else if (ground === 'path') tmp.copy(region === 'village' ? COLORS.plaza : COLORS.path);
    else if (region === 'forest') tmp.copy(COLORS.forest);
    else if (region === 'wetland') tmp.copy(COLORS.wetland);
    else tmp.copy(COLORS.grass).lerp(COLORS.grassDark, Math.min(1, Math.max(0, (my - 3) / 8)));
    // Blend grass towards rock as it steepens, so cliffs don't have hard seams.
    if (ground === 'grass' && slope > 0.2) tmp.lerp(COLORS.rock, Math.min(1, (slope - 0.2) / 0.15));
    const k = 1 + rng.range(-0.035, 0.035);
    tmp.multiplyScalar(k);

    const rc = REGION_DEBUG[region] || REGION_DEBUG.meadow;
    const sc = slope < 0.12 ? C('#3c9a4a') : slope < 0.32 ? C('#e3c14a') : C('#d0453a');
    for (let v = 0; v < 3; v++) {
      col[o + v * 3] = tmp.r; col[o + v * 3 + 1] = tmp.g; col[o + v * 3 + 2] = tmp.b;
      dbgRegion[o + v * 3] = rc.r; dbgRegion[o + v * 3 + 1] = rc.g; dbgRegion[o + v * 3 + 2] = rc.b;
      dbgSlope[o + v * 3] = sc.r; dbgSlope[o + v * 3 + 1] = sc.g; dbgSlope[o + v * 3 + 2] = sc.b;
    }
    pos.set([ax, ay, az, bx, by, bz, cx, cy, cz], o);
    o += 9;
  };

  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const x0 = -half + i * cell;
      const z0 = -half + j * cell;
      const x1 = x0 + cell;
      const z1 = z0 + cell;
      const a = H(i, j), b = H(i + 1, j), c = H(i, j + 1), d = H(i + 1, j + 1);
      // Same diagonal (b-c) as terrain.heightAt. Counter-clockwise from above.
      writeTri(x0, a, z0, x0, c, z1, x1, b, z0);
      writeTri(x1, b, z0, x0, c, z1, x1, d, z1);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('debugRegion', new THREE.BufferAttribute(dbgRegion, 3));
  geo.setAttribute('debugSlope', new THREE.BufferAttribute(dbgSlope, 3));
  geo.computeVertexNormals();
  geo.computeBoundingSphere();

  const uniforms = {
    uTrail: { value: null },
    uTrailSize: { value: 240 },
    uWetness: { value: 0 },
    uDebugMode: { value: 0 },
    uGridCell: { value: cell },
  };
  const material = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
attribute vec3 debugRegion;
attribute vec3 debugSlope;
varying vec3 vWPos;
varying vec3 vDebugRegion;
varying vec3 vDebugSlope;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
vDebugRegion = debugRegion;
vDebugSlope = debugSlope;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
uniform sampler2D uTrail;
uniform float uTrailSize;
uniform float uWetness;
uniform float uGridCell;
uniform int uDebugMode;
varying vec3 vWPos;
varying vec3 vDebugRegion;
varying vec3 vDebugSlope;`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
// Trail: world XZ -> trail texture UV. The texture covers the whole grid.
vec2 trailUv = (vWPos.xz + 0.5 * uTrailSize) / uTrailSize;
float trail = texture2D(uTrail, trailUv).r;
// Trodden ground: a touch darker and browner (grass bent over, soil showing).
diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.72, 0.62, 0.42), min(trail * 1.1, 1.0));
// Rain wetness pools in low ground: darker, slightly cooler.
float lowness = 1.0 - smoothstep(0.5, 9.0, vWPos.y);
float wet = uWetness * (0.35 + 0.65 * lowness);
diffuseColor.rgb *= 1.0 - wet * 0.32;
diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.85, 0.95, 1.1), wet * 0.4);
if (uDebugMode > 0) {
  vec3 dbg = diffuseColor.rgb;
  if (uDebugMode == 1) dbg = mix(diffuseColor.rgb * 0.5, mix(vec3(1.0, 0.85, 0.1), vec3(1.0, 0.1, 0.05), trail), step(0.01, trail));
  if (uDebugMode == 2) dbg = vDebugRegion;
  if (uDebugMode == 3) dbg = vDebugSlope;
  vec2 g = abs(fract(vWPos.xz / uGridCell - 0.5) - 0.5) / fwidth(vWPos.xz / uGridCell);
  float line = 1.0 - min(min(g.x, g.y), 1.0);
  diffuseColor.rgb = mix(dbg, vec3(0.05), line * 0.35);
}`,
      );
  };
  material.customProgramCacheKey = () => 'wildlands-terrain';

  const mesh = new THREE.Mesh(geo, material);
  mesh.receiveShadow = true;
  mesh.name = 'terrain';
  return { mesh, uniforms };
}
