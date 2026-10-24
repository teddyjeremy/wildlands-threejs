import * as THREE from 'three';

// Instanced grass clumps that read the trail grid.
//
// Each instance gets a per-instance `aTrail` value copied from the
// TrailGrid cell it sits in. The vertex shader uses it to flatten and bend
// the blades (and darken them a little). Wind sway is purely in the shader.
// Only instances near the player are refreshed each update, in a bounded
// number of grid cells, so the cost doesn't grow with the island.

function makeClumpGeometry() {
  // Three crossed, tapered blades. y in [0,1] so the shader can use it as
  // "how far up the blade" for bending.
  const pos = [];
  const blades = 3;
  for (let b = 0; b < blades; b++) {
    const a = (b / blades) * Math.PI;
    const dx = Math.cos(a) * 0.22;
    const dz = Math.sin(a) * 0.22;
    const lean = 0.1 * (b - 1);
    pos.push(-dx, 0, -dz, dx, 0, dz, lean, 1, lean * 0.5);
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

  const uniforms = { uTime: { value: 0 }, uWind: { value: 1 } };
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
varying float vTip;
varying float vTrail;`,
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
float sway = sin(uTime * 1.7 + root.x * 0.35 + root.z * 0.21) * 0.12 * uWind * (1.0 - aTrail);
// Trampled blades: squash height and lay them over along a per-clump direction.
float trodden = aTrail * 0.85;
float dir = fract(sin(dot(root.xz, vec2(12.9898, 78.233))) * 43758.5453) * 6.2831;
transformed.y *= 1.0 - trodden;
transformed.x += (sway + cos(dir) * trodden * 0.7) * tip;
transformed.z += (sway * 0.5 + sin(dir) * trodden * 0.7) * tip;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
varying float vTip;
varying float vTrail;`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
// Darker at the root, sun-bleached at the tip; trampled grass goes olive.
diffuseColor.rgb *= mix(0.55, 1.12, vTip);
diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.85, 0.8, 0.55), vTrail * 0.7);`,
      );
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
