import * as THREE from 'three';
import { flowVertex, flowFragment } from '../shaders/flow.js';
import { buildDrainage } from './runoff.js';

// Visuals for the hydrology: the stream, rain-fed runoff channels and the
// wetland pools. All of it is driven by the WeatherSim scalars.

function ribbonFromPolyline(points, width, lift = 0.08) {
  // points: [[x,y,z], ...]
  const pos = [];
  const uv = [];
  const idx = [];
  let along = 0;
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const a = points[Math.max(0, i - 1)];
    const b = points[Math.min(points.length - 1, i + 1)];
    let dx = b[0] - a[0];
    let dz = b[2] - a[2];
    const len = Math.hypot(dx, dz) || 1;
    dx /= len;
    dz /= len;
    if (i > 0) along += Math.hypot(p[0] - points[i - 1][0], p[2] - points[i - 1][2]);
    // Taper the start so channels appear to gather water.
    const w = width * Math.min(1, 0.3 + i / 10);
    const nx = -dz * w * 0.5;
    const nz = dx * w * 0.5;
    pos.push(p[0] + nx, p[1] + lift, p[2] + nz, p[0] - nx, p[1] + lift, p[2] - nz);
    uv.push(0, along, 1, along);
    if (i > 0) {
      const k = i * 2;
      idx.push(k - 2, k - 1, k, k - 1, k + 1, k);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

function flowMaterial(color, speed) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uFlow: { value: 0 },
      uSpeed: { value: speed },
      uColor: { value: new THREE.Color(color) },
      uFogColor: { value: new THREE.Color('#c7dde6') },
      uFogNear: { value: 60 },
      uFogFar: { value: 240 },
      uLight: { value: 1 },
    },
    vertexShader: flowVertex,
    fragmentShader: flowFragment,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
}

export function createWater({ scene, terrain, seed }) {
  const L = terrain.layout;
  const group = new THREE.Group();
  group.name = 'water';
  scene.add(group);

  // Stream: sample the carved bed along the authored polyline.
  const streamPts = [];
  for (let i = 0; i < L.stream.length - 1; i++) {
    const [ax, az] = L.stream[i];
    const [bx, bz] = L.stream[i + 1];
    const steps = Math.ceil(Math.hypot(bx - ax, bz - az) / 1.0);
    for (let s = 0; s < steps; s++) {
      const x = ax + ((bx - ax) * s) / steps;
      const z = az + ((bz - az) * s) / steps;
      const h = terrain.heightAt(x, z);
      if (h < terrain.seaLevel - 0.2) break;
      streamPts.push([x, h, z]);
    }
  }
  const streamMat = flowMaterial('#4aa8c0', 0.6);
  const stream = new THREE.Mesh(ribbonFromPolyline(streamPts, 2.6, 0.25), streamMat);
  stream.renderOrder = 2;
  group.add(stream);

  // Runoff channels traced downhill from the ridge.
  const routes = buildDrainage(terrain, seed, 5);
  const runoffMat = flowMaterial('#6fb4c8', 1.1);
  const runoffMeshes = routes.map((r) => {
    const m = new THREE.Mesh(ribbonFromPolyline(r.points, 1.2, 0.12), runoffMat);
    m.renderOrder = 2;
    group.add(m);
    return m;
  });

  // Pools: flat discs whose height and size follow the pool level.
  const poolMat = new THREE.MeshLambertMaterial({ color: '#3f8fa6', transparent: true, opacity: 0.0, depthWrite: false });
  const pools = L.pools.map((p) => {
    const base = terrain.heightAt(p.x, p.z);
    const geo = new THREE.CircleGeometry(p.r, 18);
    geo.rotateX(-Math.PI / 2);
    const m = new THREE.Mesh(geo, poolMat);
    m.position.set(p.x, base, p.z);
    m.renderOrder = 2;
    group.add(m);
    return { mesh: m, base, ...p };
  });

  return {
    group,
    routes,
    stream,
    pools,
    update(time, weather, sky, fogFar) {
      const light = sky.light;
      for (const mat of [streamMat, runoffMat]) {
        mat.uniforms.uTime.value = time;
        mat.uniforms.uLight.value = light;
        mat.uniforms.uFogColor.value.copy(sky.fogColor);
        mat.uniforms.uFogFar.value = fogFar;
      }
      // The stream always trickles; rain swells it.
      streamMat.uniforms.uFlow.value = 0.45 + 0.55 * weather.runoff;
      streamMat.uniforms.uSpeed.value = 0.5 + weather.runoff * 0.9;
      runoffMat.uniforms.uFlow.value = Math.max(0, (weather.runoff - 0.05) / 0.95);
      const level = weather.pool;
      poolMat.opacity = Math.min(0.85, level * 1.6);
      poolMat.color.setRGB(0.25 * light, 0.56 * light, 0.65 * light);
      for (const p of pools) {
        p.mesh.visible = level > 0.01;
        p.mesh.position.y = p.base + 0.05 + level * 0.9;
        const s = 0.35 + 0.65 * Math.min(1, level * 1.4);
        p.mesh.scale.set(s, 1, s);
      }
    },
    dispose() {
      group.traverse((o) => o.geometry?.dispose());
      streamMat.dispose();
      runoffMat.dispose();
      poolMat.dispose();
      scene.remove(group);
    },
  };
}
