import * as THREE from 'three';
import { seasonUniforms, patchSeasonVertex, patchSeasonFragment } from '../shaders/season.js';

// Instanced grass clumps that read the trail grid.
//
// Each instance gets a per-instance `aTrail` value copied from the
// TrailGrid cell it sits in. The vertex shader uses it to flatten and bend
// the blades (and darken them a little). Wind sway is purely in the shader.
// Only instances near the player are refreshed each update, in a bounded
// number of grid cells, so the cost doesn't grow with the island.

function makeClumpGeometry() {
  // Four tapered, slightly curved blades, two segments each so they can bend
  // instead of hinging. y runs 0..1 root to tip (the shader relies on that).
  const pos = [];
  const blades = 4;
  for (let b = 0; b < blades; b++) {
    const a = (b / blades) * Math.PI + b * 0.4;
    const ox = Math.cos(a * 2.3) * 0.08;
    const oz = Math.sin(a * 2.3) * 0.08;
    const dx = Math.cos(a) * 0.11;
    const dz = Math.sin(a) * 0.11;
    const lx = -dz * 0.9; // lean direction, perpendicular to the blade face
    const lz = dx * 0.9;
    const h = 0.8 + (b % 2) * 0.2;
    const row = (t) => {
      const w = 1 - t * 0.82;
      const bend = t * t * 0.35;
      return [
        [ox - dx * w + lx * bend, t * h, oz - dz * w + lz * bend],
        [ox + dx * w + lx * bend, t * h, oz + dz * w + lz * bend],
      ];
    };
    const r0 = row(0);
    const r1 = row(0.55);
    const tip = [ox + lx * 0.35, h, oz + lz * 0.35];
    pos.push(...r0[0], ...r0[1], ...r1[0]);
    pos.push(...r0[1], ...r1[1], ...r1[0]);
    pos.push(...r1[0], ...r1[1], ...tip);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

export function createGrass({ positions, maxCount, trail, scene }) {
  const total = positions.length / 4;
  const geo = makeClumpGeometry();
  const aTrail = new THREE.InstancedBufferAttribute(new Float32Array(total), 1);
  aTrail.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('aTrail', aTrail);

  const uniforms = { uTime: { value: 0 }, uWind: { value: 1 }, uPlayerPos: seasonUniforms.uPlayerPos };
  const material = new THREE.MeshLambertMaterial({ color: '#8fbf55', side: THREE.DoubleSide });
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
attribute float aTrail;
uniform float uTime;
uniform float uWind;
uniform vec3 uPlayerPos;
varying float vTip;
varying float vTrail;
varying float vHue;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
// position.y is 0 at the root and 1 at the tip (before instance scaling).
float tip = position.y;
vTip = tip;
vTrail = aTrail;
// World position of the clump root, for spatially varying wind.
vec3 root = (instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
// Wind: a slow travelling gust front plus per-clump flutter.
float gust = 0.55 + 0.45 * sin(uTime * 0.9 - root.x * 0.06 - root.z * 0.04);
float sway = (sin(uTime * 1.7 + root.x * 0.35 + root.z * 0.21) * 0.1 + sin(uTime * 4.3 + root.x * 1.3) * 0.025) * uWind * gust * (1.0 - aTrail);
vHue = fract(sin(dot(root.xz, vec2(4.1, 7.7))) * 1931.3);
// Push blades away from the player's legs.
vec2 away = root.xz - uPlayerPos.xz;
float pd = length(away);
float push = (1.0 - smoothstep(0.2, 1.3, pd)) * step(abs(uPlayerPos.y - root.y), 1.5);
vec2 pdir = away / max(pd, 0.001);
// Trampled blades: squash height and lay them over along a per-clump direction.
float trodden = aTrail * 0.85;
float dir = fract(sin(dot(root.xz, vec2(12.9898, 78.233))) * 43758.5453) * 6.2831;
transformed.y *= 1.0 - max(trodden, push * 0.5);
transformed.x += (sway + cos(dir) * trodden * 0.7 + pdir.x * push * 0.55) * tip * tip;
transformed.z += (sway * 0.5 + sin(dir) * trodden * 0.7 + pdir.y * push * 0.55) * tip * tip;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
varying float vTip;
varying float vTrail;
varying float vHue;`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
// Per-clump variety: some fresher, some drier.
diffuseColor.rgb *= mix(vec3(0.86, 1.04, 0.82), vec3(1.12, 1.0, 0.72), vHue);
// Darker at the root, sun-bleached at the tip; trampled grass goes olive.
diffuseColor.rgb *= mix(0.55, 1.12, vTip);
diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.85, 0.8, 0.55), vTrail * 0.7);`,
      );
    patchSeasonVertex(shader);
    patchSeasonFragment(shader, { foliage: '1.0', up: 'mix(0.2, 1.0, vTip)', ring: false });
  };
  material.customProgramCacheKey = () => 'wildlands-grass';

  const mesh = new THREE.InstancedMesh(geo, material, total);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3();
  const p = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  // Map from trail cell -> instance indices so updates are O(nearby).
  const byCell = new Map();
  for (let i = 0; i < total; i++) {
    const x = positions[i * 4];
    const y = positions[i * 4 + 1];
    const z = positions[i * 4 + 2];
    const sc = positions[i * 4 + 3];
    q.setFromAxisAngle(up, (i * 2.399) % 6.283);
    m.compose(p.set(x, y - 0.05, z), q, s.set(sc, sc * 0.75, sc));
    mesh.setMatrixAt(i, m);
    const idx = trail.index(x, z);
    if (idx >= 0) {
      let list = byCell.get(idx);
      if (!list) byCell.set(idx, (list = []));
      list.push(i);
    }
  }
  mesh.count = Math.min(total, maxCount);
  mesh.receiveShadow = true;
  mesh.name = 'grass';
  mesh.frustumCulled = false; // one big instanced mesh spanning the island
  scene.add(mesh);

  return {
    mesh,
    uniforms,
    setCount(n) {
      mesh.count = Math.min(total, n);
    },
    /**
     * Copy trail values into instances within `radius` of (x,z).
     * Bounded: (2r/cell)^2 cells regardless of island size.
     */
    refreshAround(x, z, radius = 22) {
      const cs = trail.cellSize;
      const r = Math.ceil(radius / cs);
      const ci = Math.floor((x + trail.half) / cs);
      const cj = Math.floor((z + trail.half) / cs);
      const arr = aTrail.array;
      let changed = false;
      for (let dj = -r; dj <= r; dj++) {
        const j = cj + dj;
        if (j < 0 || j >= trail.res) continue;
        for (let di = -r; di <= r; di++) {
          const i = ci + di;
          if (i < 0 || i >= trail.res) continue;
          const idx = j * trail.res + i;
          const list = byCell.get(idx);
          if (!list) continue;
          const v = trail.values[idx];
          for (const k of list) {
            if (arr[k] !== v) {
              arr[k] = v;
              changed = true;
            }
          }
        }
      }
      if (changed) aTrail.needsUpdate = true;
    },
    /** Full refresh, e.g. after loading a save. */
    refreshAll() {
      const arr = aTrail.array;
      for (const [idx, list] of byCell) for (const k of list) arr[k] = trail.values[idx];
      aTrail.needsUpdate = true;
    },
    dispose() {
      geo.dispose();
      material.dispose();
      scene.remove(mesh);
    },
  };
}
