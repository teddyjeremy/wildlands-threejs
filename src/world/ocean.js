import * as THREE from 'three';
import { oceanVertex, oceanFragment } from '../shaders/ocean.js';
import { smoothstep } from '../procedural/math.js';

/** Bake "how close is the seabed" into a small texture for the ocean shader. */
function bakeShoreTexture(terrain, res = 256) {
  const data = new Uint8Array(res * res);
  const { size, half } = terrain.grid;
  for (let j = 0; j < res; j++) {
    for (let i = 0; i < res; i++) {
      const x = -half + ((i + 0.5) / res) * size;
      const z = -half + ((j + 0.5) / res) * size;
      const h = terrain.heightAt(x, z);
      data[j * res + i] = Math.round(255 * smoothstep(-7, 0.15, h));
    }
  }
  const tex = new THREE.DataTexture(data, res, res, THREE.RedFormat, THREE.UnsignedByteType);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

export function createOcean(terrain, segments = 128) {
  const shore = bakeShoreTexture(terrain);
  const uniforms = {
    uTime: { value: 0 },
    uWaveScale: { value: 1 },
    uSunDir: { value: new THREE.Vector3(0.5, 0.6, 0.3).normalize() },
    uSunColor: { value: new THREE.Color('#ffe0a8') },
    uDeep: { value: new THREE.Color('#1d4e7a') },
    uShallow: { value: new THREE.Color('#4fd0c4') },
    uSkyTint: { value: new THREE.Color('#9cc7e0') },
    uShore: { value: shore },
    uShoreSize: { value: terrain.grid.size },
    uFogColor: { value: new THREE.Color('#bcd3dc') },
    uFogNear: { value: 60 },
    uFogFar: { value: 260 },
    uLight: { value: 1 },
  };
  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: oceanVertex,
    fragmentShader: oceanFragment,
    transparent: true,
    depthWrite: false,
  });
  // Dense in the middle where the island is, coarse further out.
  const geo = new THREE.PlaneGeometry(1400, 1400, segments, segments);
  geo.rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(geo, material);
  mesh.position.y = terrain.seaLevel;
  mesh.renderOrder = 1;
  mesh.name = 'ocean';
  mesh.frustumCulled = false;

  // Fallback if the custom shader fails to compile on some driver: swap in a
  // plain transparent material so the world is still playable.
  const fallback = new THREE.MeshLambertMaterial({ color: '#2f7fa0', transparent: true, opacity: 0.85 });

  return {
    mesh,
    uniforms,
    useFallback() {
      mesh.material = fallback;
    },
    update(time) {
      uniforms.uTime.value = time;
    },
    dispose() {
      geo.dispose();
      material.dispose();
      fallback.dispose();
      shore.dispose();
    },
  };
}
