import * as THREE from 'three';

// Ambient particles: fireflies, pollen, falling leaves, snow and storm
// sparks. One pool, two draw calls (additive glow and normal flakes).
// Particles are recycled around a focus point (the lantern or camera), and
// what spawns depends on the season field, time of day and the island.

const KINDS = {
  firefly: { glow: true, color: [1.0, 0.92, 0.45], size: 0.22, life: [5, 9] },
  pollen: { glow: true, color: [0.95, 1.0, 0.7], size: 0.09, life: [4, 7] },
  spark: { glow: true, color: [0.75, 0.7, 1.0], size: 0.12, life: [0.6, 1.4] },
  leaf: { glow: false, color: [0.85, 0.42, 0.12], size: 0.2, life: [4, 7] },
  snow: { glow: false, color: [0.96, 0.98, 1.0], size: 0.11, life: [4, 7] },
};

const vertex = /* glsl */ `
attribute float aSize;
attribute vec4 aColor;
varying vec4 vColor;
uniform float uScale;
void main() {
  vColor = aColor;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = aSize * uScale / max(-mv.z, 0.1);
  gl_Position = projectionMatrix * mv;
}
`;
const fragment = /* glsl */ `
varying vec4 vColor;
uniform float uGlow;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float d = length(c);
  float a = uGlow > 0.5 ? pow(max(0.0, 1.0 - d * 2.0), 2.2) : smoothstep(0.5, 0.35, d);
  if (a < 0.01) discard;
  gl_FragColor = vec4(vColor.rgb * (uGlow > 0.5 ? 1.6 : 1.0), vColor.a * a);
}
`;

function makeLayer(count, glow) {
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(count * 3);
  const col = new Float32Array(count * 4);
  const size = new Float32Array(count);
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('aColor', new THREE.BufferAttribute(col, 4).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1).setUsage(THREE.DynamicDrawUsage));
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
  const mat = new THREE.ShaderMaterial({
    vertexShader: vertex,
    fragmentShader: fragment,
    uniforms: { uScale: { value: 600 }, uGlow: { value: glow ? 1 : 0 } },
    transparent: true,
    depthWrite: false,
    blending: glow ? THREE.AdditiveBlending : THREE.NormalBlending,
  });
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  pts.name = glow ? 'particles-glow' : 'particles';
  return { pts, geo, mat, pos, col, size, count, used: 0 };
}

export function createParticles(scene, maxCount = 1600) {
  const glow = makeLayer(maxCount, true);
  const flat = makeLayer(maxCount, false);
  scene.add(glow.pts, flat.pts);
  const pool = [];
  let limit = maxCount;
  let seed = 1;
  let lastHeight = null;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

  function spawn(kind, x, y, z, spread, heightAt) {
    if (pool.length >= limit) return;
    const k = KINDS[kind];
    const a = rnd() * Math.PI * 2;
    const r = Math.sqrt(rnd()) * spread;
    const px = x + Math.cos(a) * r;
    const pz = z + Math.sin(a) * r;
    const ground = heightAt ? heightAt(px, pz) : y;
    const p = {
      kind,
      k,
      x: px,
      z: pz,
      y: kind === 'snow' || kind === 'leaf' ? Math.max(ground, y) + 4 + rnd() * 4 : Math.max(ground, 0) + 0.4 + rnd() * (kind === 'firefly' ? 2.2 : 3),
      vx: 0,
      vy: 0,
      vz: 0,
      t: 0,
      life: k.life[0] + rnd() * (k.life[1] - k.life[0]),
      ph: rnd() * 10,
      ground,
    };
    if (kind === 'spark') {
      p.vx = (rnd() - 0.5) * 3;
      p.vz = (rnd() - 0.5) * 3;
      p.vy = 2 + rnd() * 2;
    }
    pool.push(p);
  }

  return {
    glow,
    flat,
    get count() {
      return pool.length;
    },
    /** A few particles at a point, e.g. leaves blowing off a thornwall. */
    burst(kind, x, z, n = 2) {
      for (let i = 0; i < n; i++) spawn(kind, x, lastHeight ? lastHeight(x, z) : 0, z, 2.5, lastHeight);
    },
    setLimit(n) {
      limit = Math.min(maxCount, n);
      if (pool.length > limit) pool.length = limit;
    },
    /**
     * @param {object} o {dt, time, focus:{x,y,z}, camera, field, night, wind:{x,z}, heightAt, forest, reducedMotion}
     */
    update(o) {
      const { dt, field, focus, heightAt } = o;
      lastHeight = heightAt;
      const rates = { firefly: o.night * 14 * (o.forest ? 1.6 : 1), pollen: 0, spark: 0, leaf: o.forest ? 1.5 : 0, snow: 0 };
      if (field && field.intensity > 0.05) {
        const s = field.season;
        const I = field.intensity;
        if (s === 'spring') { rates.pollen += 40 * I; rates.firefly += 10 * I; }
        if (s === 'autumn') rates.leaf += 45 * I;
        if (s === 'winter') rates.snow += 80 * I;
        if (s === 'storm') rates.spark += 30 * I;
      }
      for (const kind in rates) {
        const want = rates[kind] * dt;
        let n = Math.floor(want) + (rnd() < want % 1 ? 1 : 0);
        const fieldKind = kind !== 'firefly' || (field && field.season === 'spring');
        const fx = fieldKind && field ? field.x : focus.x;
        const fz = fieldKind && field ? field.z : focus.z;
        const fy = fieldKind && field ? field.y : focus.y;
        const spread = fieldKind && field && field.radius > 1 ? field.radius : 22;
        while (n-- > 0) spawn(kind, fx, fy, fz, spread, heightAt);
      }
      const wx = o.wind?.x ?? 0.6;
      const wz = o.wind?.z ?? 0.2;
      const t = o.time;
      for (let i = pool.length - 1; i >= 0; i--) {
        const p = pool[i];
        p.t += dt;
        if (p.t > p.life) {
          pool[i] = pool[pool.length - 1];
          pool.pop();
          continue;
        }
        switch (p.kind) {
          case 'firefly':
            p.x += Math.sin(t * 0.7 + p.ph) * dt * 0.6;
            p.z += Math.cos(t * 0.6 + p.ph * 1.3) * dt * 0.6;
            p.y += Math.sin(t * 1.1 + p.ph * 2) * dt * 0.3;
            break;
          case 'pollen':
            p.x += (wx * 0.4 + Math.sin(t + p.ph) * 0.3) * dt;
            p.z += (wz * 0.4 + Math.cos(t * 0.8 + p.ph) * 0.3) * dt;
            p.y += 0.15 * dt;
            break;
          case 'leaf':
            p.x += (wx * 1.2 + Math.sin(t * 2.1 + p.ph) * 0.9) * dt;
            p.z += (wz * 1.2 + Math.cos(t * 1.7 + p.ph) * 0.9) * dt;
            p.y -= 0.9 * dt;
            if (p.y < p.ground + 0.05) { p.y = p.ground + 0.05; p.t = Math.max(p.t, p.life - 1); }
            break;
          case 'snow':
            p.x += (wx * 0.6 + Math.sin(t * 1.3 + p.ph) * 0.25) * dt;
            p.z += (wz * 0.6) * dt;
            p.y -= 1.3 * dt;
            if (p.y < p.ground) { p.y = p.ground; p.t = Math.max(p.t, p.life - 0.6); }
            break;
          case 'spark':
            p.vy -= 3 * dt;
            p.x += p.vx * dt;
            p.y += p.vy * dt;
            p.z += p.vz * dt;
            break;
          default:
        }
      }
      // Write buffers.
      glow.used = 0;
      flat.used = 0;
      for (const p of pool) {
        const L = p.k.glow ? glow : flat;
        const j = L.used++;
        L.pos[j * 3] = p.x;
        L.pos[j * 3 + 1] = p.y;
        L.pos[j * 3 + 2] = p.z;
        const fade = Math.min(1, p.t * 2, (p.life - p.t) * 1.5);
        let a = fade;
        if (p.kind === 'firefly') a *= 0.5 + 0.5 * Math.sin(t * 3 + p.ph * 5);
        const c = p.k.color;
        let r = c[0];
        let g = c[1];
        let b = c[2];
        if (p.kind === 'leaf') {
          const v = (p.ph * 7.3) % 1;
          r = 0.7 + v * 0.3; g = 0.25 + v * 0.35; b = 0.08;
        }
        L.col[j * 4] = r;
        L.col[j * 4 + 1] = g;
        L.col[j * 4 + 2] = b;
        L.col[j * 4 + 3] = a;
        L.size[j] = p.k.size;
      }
      for (const L of [glow, flat]) {
        L.geo.setDrawRange(0, L.used);
        L.geo.attributes.position.needsUpdate = true;
        L.geo.attributes.aColor.needsUpdate = true;
        L.geo.attributes.aSize.needsUpdate = true;
        L.mat.uniforms.uScale.value = o.pixelScale || 600;
      }
    },
    dispose() {
      for (const L of [glow, flat]) {
        scene.remove(L.pts);
        L.geo.dispose();
        L.mat.dispose();
      }
    },
  };
}
