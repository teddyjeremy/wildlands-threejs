import * as THREE from 'three';
import { merge, box, cyl, cone, ico, dodeca, place, paint } from '../procedural/geo.js';
import { createRandom } from '../procedural/random.js';
import { createSeasonMaterial, seasonUniforms } from '../shaders/season.js';
import { SEASON_INFO } from '../levels/levels.js';

// Everything that makes up a level's crossing: vine bridges, thornwalls,
// windmill drawbridges, ice sheets, the shrine, the season ember and the
// boat. Visuals follow the PuzzleElement state; collisions are toggled with
// the `enabled` flag on decks and solids.

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();

function frameFor(seg) {
  const dx = seg.b.x - seg.a.x;
  const dz = seg.b.z - seg.a.z;
  const len = Math.hypot(dx, dz);
  return { len, ry: Math.atan2(dx, dz), ux: dx / len, uz: dz / len, mx: (seg.a.x + seg.b.x) / 2, mz: (seg.a.z + seg.b.z) / 2 };
}

/** Deck height along a bridge: linear between the ends with a gentle arch. */
function archFn(seg, len, lift = 0.25, sag = 0.6) {
  const y0 = seg.a.y + lift;
  const y1 = seg.b.y + lift;
  return (lz) => {
    const t = Math.min(1, Math.max(0, lz / len + 0.5));
    return y0 + (y1 - y0) * t + Math.sin(t * Math.PI) * sag;
  };
}

function vineBridge(seg, ctx) {
  const { scene, collisions, material, rng } = ctx;
  const f = frameFor(seg);
  const height = archFn(seg, f.len, 0.2, 0.5);
  const deck = collisions.addDeck({ x: f.mx, z: f.mz, hw: 1.05, hd: f.len / 2 + 0.4, ry: f.ry, heightAt: height, enabled: false });
  // Low rails so you can't step off the side once it's grown.
  const rails = [-1, 1].map((s) =>
    collisions.add({ type: 'box', x: f.mx + Math.cos(f.ry) * s * 1.3, z: f.mz - Math.sin(f.ry) * s * 1.3, hw: 0.12, hd: f.len / 2 - 0.4, ry: f.ry, enabled: false }),
  );

  const group = new THREE.Group();
  group.position.set(f.mx, 0, f.mz);
  group.rotation.y = f.ry;
  scene.add(group);

  const N = Math.max(8, Math.round(f.len / 0.55));
  const plankGeo = merge([
    box(1.9, 0.12, 0.42, '#6b8a3a', { y: -0.06 }),
    box(1.6, 0.06, 0.3, '#86a84a', { y: 0.02 }),
    cyl(0.07, 0.07, 2.1, 5, '#4e6a2a', { y: -0.1, rz: Math.PI / 2 }),
  ]);
  const planks = new THREE.InstancedMesh(plankGeo, material, N);
  const leafGeo = merge([ico(0.22, 0, '#5f9a35'), ico(0.14, 0, '#7cbf45', { x: 0.14, y: 0.08 })]);
  const leaves = new THREE.InstancedMesh(leafGeo, material, N * 2);
  const bloomGeo = merge([dodeca(0.11, '#ffd1ea'), ico(0.05, 0, '#ffe36b', { y: 0.06 })]);
  const blooms = new THREE.InstancedMesh(bloomGeo, material, N);
  for (const m of [planks, leaves, blooms]) {
    m.castShadow = true;
    m.receiveShadow = true;
    group.add(m);
  }
  // Dormant roots at the shore end - what the player has to wake.
  const rootGeo = merge([
    cyl(0.18, 0.32, 1.6, 6, '#5a4630', { y: 0.8, rz: 0.2 }),
    cyl(0.14, 0.26, 1.4, 6, '#5a4630', { x: 1.3, y: 0.7, rz: -0.25 }),
    ico(0.5, 0, '#4e6a2a', { y: 1.7, x: 0.2 }),
    ico(0.4, 0, '#4e6a2a', { y: 1.5, x: 1.4 }),
  ]);
  for (const s of [-1, 1]) {
    const post = new THREE.Mesh(rootGeo, material);
    post.position.set(s * 1.4 - (s > 0 ? 1.3 : 0), seg.a.y - 0.3, -f.len / 2 - 0.2);
    post.castShadow = true;
    group.add(post);
    const post2 = post.clone();
    post2.position.set(s * 1.4 - (s > 0 ? 1.3 : 0), seg.b.y - 0.3, f.len / 2 + 0.2);
    group.add(post2);
  }
  const jitter = Array.from({ length: N * 3 }, () => rng.range(-1, 1));

  let shown = -1;
  return {
    type: 'vine',
    deck,
    update(el, dt) {
      // Grown amount eases towards puzzle progress so it reads as growth.
      const target = el.solved ? 1 : el.progress;
      this.shown = shown = shown < 0 ? target : shown + (target - shown) * Math.min(1, dt * 4);
      deck.enabled = el.solved;
      for (const r of rails) r.enabled = el.solved;
      for (let i = 0; i < N; i++) {
        const lz = -f.len / 2 + ((i + 0.5) / N) * f.len;
        const g = Math.min(1, Math.max(0, shown * (N + 3) - i));
        const y = height(lz) - 0.02;
        const s = g < 0.01 ? 0.0001 : g;
        _q.setFromEuler(_e.set(jitter[i] * 0.04, jitter[i + N] * 0.05, jitter[i] * 0.03));
        _m.compose(_p.set(0, y - (1 - g) * 0.6, lz), _q, _s.set(s, s, s));
        planks.setMatrixAt(i, _m);
        for (const side of [0, 1]) {
          const sx = side ? 1.05 : -1.05;
          _q.setFromEuler(_e.set(jitter[i + side] * 2, i * 1.7, 0));
          _m.compose(_p.set(sx, y + 0.08 + Math.abs(jitter[i + N + side]) * 0.25, lz), _q, _s.setScalar(Math.max(0.0001, g * (0.8 + jitter[i] * 0.2))));
          leaves.setMatrixAt(i * 2 + side, _m);
        }
        const b = el.solved ? Math.min(1, Math.max(0, (shown - 0.92) * 12 - (i % 5) * 0.1)) : 0;
        _m.compose(_p.set(i % 2 ? 1.1 : -1.1, y + 0.32, lz), _q.identity(), _s.setScalar(Math.max(0.0001, b)));
        blooms.setMatrixAt(i, _m);
      }
      planks.instanceMatrix.needsUpdate = true;
      leaves.instanceMatrix.needsUpdate = true;
      blooms.instanceMatrix.needsUpdate = true;
    },
    dispose() {
      scene.remove(group);
      plankGeo.dispose();
      leafGeo.dispose();
      bloomGeo.dispose();
      rootGeo.dispose();
    },
  };
}

function causewayWithHedge(seg, ctx) {
  const { scene, collisions, material, rng } = ctx;
  const f = frameFor(seg);
  const height = archFn(seg, f.len, 0.12, 0.15);
  const deck = collisions.addDeck({ x: f.mx, z: f.mz, hw: 1.3, hd: f.len / 2 + 0.5, ry: f.ry, heightAt: height });
  const group = new THREE.Group();
  group.position.set(f.mx, 0, f.mz);
  group.rotation.y = f.ry;
  scene.add(group);
  // Causeway: chunky stones with moss.
  const N = Math.round(f.len / 0.9);
  const stoneGeo = merge([dodeca(0.75, '#8d857a', { sy: 0.45 }), ico(0.3, 0, '#6f8a45', { y: 0.25, x: 0.3, sy: 0.4 })]);
  const stones = new THREE.InstancedMesh(stoneGeo, material, N * 2);
  for (let i = 0; i < N; i++) {
    const lz = -f.len / 2 + ((i + 0.5) / N) * f.len;
    for (const side of [0, 1]) {
      _q.setFromEuler(_e.set(0, rng.range(0, 6.28), 0));
      _m.compose(_p.set((side ? 0.55 : -0.55) + rng.range(-0.1, 0.1), height(lz) - 0.32, lz + rng.range(-0.15, 0.15)), _q, _s.set(rng.range(1, 1.3), 1, rng.range(0.9, 1.2)));
      stones.setMatrixAt(i * 2 + side, _m);
    }
  }
  stones.receiveShadow = true;
  stones.castShadow = true;
  group.add(stones);

  // Thornwall across the shore end of the causeway.
  const hedgeZ = -f.len / 2 - 0.6;
  const wall = collisions.add({ type: 'box', x: seg.a.x + f.ux * 0.4, z: seg.a.z + f.uz * 0.4, hw: 4.2, hd: 0.9, ry: f.ry });
  const bushGeo = merge([
    ico(0.9, 0, '#2f4a24'),
    ico(0.6, 0, '#3d5a2a', { x: 0.5, y: 0.5 }),
    ...[0, 1, 2, 3, 4, 5, 6].map((k) => cone(0.07, 0.45, 4, '#7a2a24', { x: Math.cos(k * 0.9) * 0.8, y: Math.sin(k * 1.7) * 0.5 + 0.2, z: Math.sin(k * 0.9) * 0.8, rx: Math.cos(k) * 1.4, rz: Math.sin(k) * 1.4 })),
  ]);
  const twigGeo = merge([
    cyl(0.05, 0.08, 1.3, 4, '#5b4030', { y: 0.6, rz: 0.4 }),
    cyl(0.04, 0.07, 1.1, 4, '#5b4030', { y: 0.5, rz: -0.5 }),
    cyl(0.04, 0.06, 0.9, 4, '#6a4a36', { y: 0.45, rx: 0.5 }),
  ]);
  const B = 14;
  const bushes = new THREE.InstancedMesh(bushGeo, material, B);
  const twigs = new THREE.InstancedMesh(twigGeo, material, B);
  const bushData = [];
  for (let i = 0; i < B; i++) {
    const lx = -4 + (i / (B - 1)) * 8 + rng.range(-0.25, 0.25);
    const lz = hedgeZ + rng.range(-0.5, 0.5);
    const wx = f.mx + lx * Math.cos(f.ry) + lz * Math.sin(f.ry);
    const wz = f.mz - lx * Math.sin(f.ry) + lz * Math.cos(f.ry);
    bushData.push({ lx, lz, y: ctx.terrain.heightAt(wx, wz), s: rng.range(0.9, 1.35), r: rng.range(0, 6.28) });
    _q.setFromEuler(_e.set(0, bushData[i].r, 0));
    _m.compose(_p.set(lx, bushData[i].y, lz), _q, _s.setScalar(bushData[i].s));
    twigs.setMatrixAt(i, _m);
  }
  bushes.castShadow = true;
  twigs.castShadow = true;
  group.add(bushes, twigs);
  let shown = -1;
  return {
    type: 'hedge',
    deck,
    update(el, dt) {
      const target = el.solved ? 1 : el.progress;
      shown = shown < 0 ? target : shown + (target - shown) * Math.min(1, dt * 3);
      wall.enabled = !el.solved;
      for (let i = 0; i < B; i++) {
        const d = bushData[i];
        // Leaves thin out unevenly, then the bush shrivels.
        const k = Math.min(1, Math.max(0, shown * 1.6 - (i % 4) * 0.15));
        const s = d.s * (1 - k * 0.92);
        const shake = el.activity > 0.3 && !el.solved ? Math.sin(ctx.time() * 30 + i) * 0.04 : 0;
        _q.setFromEuler(_e.set(shake, d.r, shake));
        _m.compose(_p.set(d.lx, d.y + 0.6 * s, d.lz), _q, _s.set(s, s * 1.1, s));
        bushes.setMatrixAt(i, _m);
      }
      bushes.instanceMatrix.needsUpdate = true;
    },
    // Where to throw falling leaves from while it's being stripped.
    emitter: () => ({ x: seg.a.x, z: seg.a.z, active: shown > 0.02 && shown < 0.98 }),
    dispose() {
      scene.remove(group);
      stoneGeo.dispose();
      bushGeo.dispose();
      twigGeo.dispose();
    },
  };
}

function windmillBridge(seg, ctx, anchor) {
  const { scene, collisions, material } = ctx;
  const f = frameFor(seg);
  const height = archFn(seg, f.len, 0.25, 0.1);
  const deck = collisions.addDeck({ x: f.mx, z: f.mz, hw: 1.15, hd: f.len / 2 + 0.4, ry: f.ry, heightAt: height, enabled: false });
  // A gate post on the shore end so you can't jump onto the raised span.
  const gate = collisions.add({ type: 'box', x: seg.a.x + f.ux * 0.3, z: seg.a.z + f.uz * 0.3, hw: 1.6, hd: 0.25, ry: f.ry });

  // Windmill.
  const wy = ctx.terrain.heightAt(anchor.x, anchor.z);
  const mill = new THREE.Group();
  mill.position.set(anchor.x, wy, anchor.z);
  mill.rotation.y = f.ry + Math.PI / 2;
  const towerGeo = merge([
    cyl(1.0, 1.5, 6.5, 8, '#d8cdb8', { y: 3.25 }),
    cyl(1.55, 1.6, 0.5, 8, '#8d857a', { y: 0.2 }),
    cone(1.35, 1.6, 8, '#9c4a32', { y: 7.3 }),
    box(0.7, 1.1, 0.1, '#5b4030', { y: 0.7, z: 1.45 }),
    box(0.4, 0.5, 0.1, '#2f2a26', { y: 4.2, z: 1.2 }),
  ]);
  const tower = new THREE.Mesh(towerGeo, material);
  tower.castShadow = true;
  tower.receiveShadow = true;
  mill.add(tower);
  collisions.add({ type: 'circle', x: anchor.x, z: anchor.z, r: 1.5 });
  const hub = new THREE.Group();
  hub.position.set(0, 5.8, 1.35);
  mill.add(hub);
  const bladeGeo = merge([
    box(0.18, 3.4, 0.08, '#6b4a32', { y: 1.9 }),
    box(0.75, 2.9, 0.04, '#efe6d0', { y: 2.05, x: 0.42 }),
    cyl(0.22, 0.22, 0.3, 6, '#4a3a2a', { rx: Math.PI / 2 }),
  ]);
  for (let i = 0; i < 4; i++) {
    const b = new THREE.Mesh(bladeGeo, material);
    b.rotation.z = (i / 4) * Math.PI * 2;
    b.castShadow = true;
    hub.add(b);
  }
  scene.add(mill);
  // Charge lights up the window.
  const glowMat = new THREE.MeshBasicMaterial({ color: '#2a2440' });
  const glow = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.46, 0.05), glowMat);
  glow.position.set(0, 4.2, 1.27);
  mill.add(glow);

  // Bridge span, hinged at the shore end.
  const hinge = new THREE.Group();
  hinge.position.set(seg.a.x, height(-f.len / 2), seg.a.z);
  hinge.rotation.y = f.ry;
  scene.add(hinge);
  const lift = new THREE.Group();
  hinge.add(lift);
  const spanGeo = merge([
    box(2.2, 0.18, f.len + 0.6, '#7b5a3c', { y: -0.09, z: (f.len + 0.6) / 2 }),
    ...Array.from({ length: Math.round(f.len / 0.7) }, (_, i) => box(2.3, 0.06, 0.32, i % 2 ? '#8a6748' : '#6f5034', { y: 0.02, z: 0.3 + i * 0.7 })),
    box(0.12, 0.6, f.len, '#5b4030', { x: 1.05, y: 0.3, z: f.len / 2 }),
    box(0.12, 0.6, f.len, '#5b4030', { x: -1.05, y: 0.3, z: f.len / 2 }),
  ]);
  const span = new THREE.Mesh(spanGeo, material);
  span.castShadow = true;
  span.receiveShadow = true;
  lift.add(span);
  const postGeo = merge([box(0.35, 4.2, 0.35, '#5b4030', { y: 2.1 }), box(2.9, 0.3, 0.35, '#5b4030', { y: 4.1 })]);
  const posts = new THREE.Mesh(postGeo, material);
  posts.position.set(0, -0.5, -0.4);
  hinge.add(posts);
  // The far end's slope matters: tilt the span to meet the islet.
  const slope = Math.atan2(height(f.len / 2) - height(-f.len / 2), f.len);

  let angle = -1.25;
  let spin = 0;
  return {
    type: 'drawbridge',
    deck,
    mill,
    update(el, dt) {
      const target = el.solved ? -slope : -1.25;
      angle += (target - angle) * Math.min(1, dt * (el.solved ? 0.9 : 3));
      lift.rotation.x = angle;
      const open = el.solved && Math.abs(angle - target) < 0.04;
      deck.enabled = open;
      gate.enabled = !open;
      const speed = el.solved ? 1.6 : 0.15 + el.activity * 5 + el.progress * 2;
      spin += speed * dt;
      hub.rotation.z = -spin;
      const c = el.solved ? 1 : el.progress;
      glowMat.color.setRGB(0.16 + c * 0.84, 0.14 + c * 0.7, 0.25 + c * 0.6);
    },
    sparkAt: () => ({ x: anchor.x, y: wy + 5.8, z: anchor.z }),
    dispose() {
      scene.remove(mill, hinge);
      towerGeo.dispose();
      bladeGeo.dispose();
      spanGeo.dispose();
      postGeo.dispose();
      glowMat.dispose();
      glow.geometry.dispose();
    },
  };
}

/** Frost grid + ice sheets for every ice segment on the level. */
function iceSheets(segs, ctx) {
  const { scene, terrain, trailFactory } = ctx;
  if (!segs.length) return null;
  const corridor = (x, z) => {
    for (const s of segs) {
      const dx = s.b.x - s.a.x;
      const dz = s.b.z - s.a.z;
      const l2 = dx * dx + dz * dz;
      const t = Math.max(-0.15, Math.min(1.15, ((x - s.a.x) * dx + (z - s.a.z) * dz) / l2));
      const px = s.a.x + dx * t;
      const pz = s.a.z + dz * t;
      if (Math.hypot(x - px, z - pz) < 4.2) return true;
    }
    return false;
  };
  const frost = trailFactory({
    cellSize: 1,
    surfaceAt: (x, z) => (corridor(x, z) && terrain.heightAt(x, z) < 0.3 ? 'water' : 'rock'),
    response: {
      grass: { gain: 0, regrow: 1 },
      path: { gain: 0, regrow: 1 },
      sand: { gain: 0, regrow: 1 },
      rock: { gain: 0, regrow: 1 },
      water: { gain: 1, regrow: 1 / 10 }, // fully frozen ice melts in about ten seconds
    },
  });
  const data = new Uint8Array(frost.res * frost.res);
  const tex = new THREE.DataTexture(data, frost.res, frost.res, THREE.RedFormat, THREE.UnsignedByteType);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  const uniforms = {
    uFrost: { value: tex },
    uFrostSize: { value: frost.size },
    uTime: seasonUniforms.uSeasonTime,
    uSunDir: { value: new THREE.Vector3(0.3, 0.8, 0.2) },
    uLight: { value: 1 },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    depthWrite: false,
    vertexShader: /* glsl */ `
varying vec3 vW;
void main() { vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: /* glsl */ `
uniform sampler2D uFrost;
uniform float uFrostSize;
uniform float uTime;
uniform vec3 uSunDir;
uniform float uLight;
varying vec3 vW;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
// Voronoi edge distance for the crack pattern.
float cracks(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p);
  float d1 = 8.0, d2 = 8.0;
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec2 g = vec2(float(x), float(y));
    vec2 o = vec2(hash(i + g), hash(i + g + 17.0));
    float d = length(g + o - f);
    if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) d2 = d;
  }
  return d2 - d1;
}
void main() {
  vec2 uv = (vW.xz + 0.5 * uFrostSize) / uFrostSize;
  float f = texture2D(uFrost, uv).r;
  float a = smoothstep(0.12, 0.45, f);
  if (a < 0.01) discard;
  vec3 viewDir = normalize(cameraPosition - vW);
  float fres = pow(1.0 - max(viewDir.y, 0.0), 3.0);
  float c = cracks(vW.xz * 0.7);
  float edge = 1.0 - smoothstep(0.0, 0.06, c);
  vec3 col = mix(vec3(0.62, 0.82, 0.92), vec3(0.9, 0.96, 1.0), fres * 0.7 + 0.2);
  col = mix(col, vec3(1.0), edge * 0.55);
  // Frost bloom at the melting rim.
  float rim = smoothstep(0.12, 0.3, f) * (1.0 - smoothstep(0.3, 0.55, f));
  col = mix(col, vec3(1.0), rim * 0.7);
  vec3 h = normalize(viewDir + normalize(uSunDir));
  col += pow(max(h.y, 0.0), 90.0) * 0.6;
  gl_FragColor = vec4(col * max(uLight, 0.35), a * (0.78 + fres * 0.2));
}`,
  });
  const meshes = segs.map((s) => {
    const fr = frameFor(s);
    const g = new THREE.PlaneGeometry(9, fr.len + 6, 1, 1);
    g.rotateX(-Math.PI / 2);
    const m = new THREE.Mesh(g, mat);
    m.position.set(fr.mx, 0.07, fr.mz);
    m.rotation.y = fr.ry;
    m.renderOrder = 2;
    m.name = 'ice';
    scene.add(m);
    return m;
  });
  let timer = 0;
  return {
    frost,
    uniforms,
    /** Walkable ice surface height under (x,z), or -Infinity. */
    surfaceAt(x, z) {
      return frost.valueAt(x, z) > 0.35 ? 0.06 : -Infinity;
    },
    update(dt, field) {
      if (field.season === 'winter' && field.intensity > 0.05) frost.stampAt(field.x, field.z, field.radius * 0.8, dt * 2.2 * field.intensity);
      frost.update(dt);
      timer += dt;
      if (timer > 0.08 && frost.dirty) {
        timer = 0;
        const v = frost.values;
        for (let i = 0; i < v.length; i++) data[i] = v[i] * 255;
        tex.needsUpdate = true;
        frost.dirty = false;
      }
    },
    dispose() {
      for (const m of meshes) {
        scene.remove(m);
        m.geometry.dispose();
      }
      mat.dispose();
      tex.dispose();
    },
  };
}

function shrine(pos, ctx, level) {
  const { scene, collisions, material, rng } = ctx;
  const group = new THREE.Group();
  group.position.set(pos.x, pos.y, pos.z);
  scene.add(group);
  const ring = [];
  const stoneGeo = merge([box(0.9, 3.2, 0.7, '#9a948a', { y: 1.5 }), box(1.0, 0.35, 0.8, '#7f786e', { y: 3.2 }), ico(0.3, 0, '#6f8a45', { y: 0.2, x: 0.4, sy: 0.4 })]);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const m = new THREE.Mesh(stoneGeo, material);
    m.position.set(Math.cos(a) * 4.4, 0, Math.sin(a) * 4.4);
    m.rotation.set(rng.range(-0.05, 0.05), -a, rng.range(-0.06, 0.06));
    m.castShadow = true;
    m.receiveShadow = true;
    group.add(m);
    ring.push(m);
    collisions.add({ type: 'circle', x: pos.x + Math.cos(a) * 4.4, z: pos.z + Math.sin(a) * 4.4, r: 0.6 });
  }
  const altarGeo = merge([cyl(1.4, 1.7, 0.5, 8, '#8d857a', { y: 0.25 }), cyl(0.9, 1.1, 0.9, 8, '#a39b8f', { y: 0.95 }), cyl(1.0, 0.9, 0.18, 8, '#7f786e', { y: 1.45 })]);
  const altar = new THREE.Mesh(altarGeo, material);
  altar.castShadow = true;
  altar.receiveShadow = true;
  group.add(altar);
  collisions.add({ type: 'circle', x: pos.x, z: pos.z, r: 1.4, top: pos.y + 1.4 });
  const colour = new THREE.Color(level.season ? SEASON_INFO[level.season].color : '#ffffff');
  const crystalMat = new THREE.MeshLambertMaterial({ color: '#59606a', emissive: colour, emissiveIntensity: 0.05, flatShading: true });
  const crystal = new THREE.Mesh(new THREE.OctahedronGeometry(0.6, 0), crystalMat);
  crystal.scale.y = 1.7;
  crystal.position.y = 2.6;
  crystal.castShadow = true;
  group.add(crystal);
  const beamMat = new THREE.MeshBasicMaterial({ color: colour, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 1.2, 80, 12, 1, true), beamMat);
  beam.position.y = 42;
  group.add(beam);
  const light = new THREE.PointLight(colour, 0, 22, 1.5);
  light.position.y = 3;
  group.add(light);
  let awake = 0;
  return {
    pos,
    awake: false,
    update(dt, t) {
      awake += ((this.awake ? 1 : 0) - awake) * Math.min(1, dt * 0.8);
      crystal.rotation.y = t * (0.2 + awake * 0.8);
      crystal.position.y = 2.6 + Math.sin(t * 1.3) * 0.1 * awake + awake * 0.5;
      crystalMat.emissiveIntensity = 0.05 + awake * 1.6;
      crystalMat.color.setRGB(0.35 + awake * 0.5, 0.38 + awake * 0.5, 0.42 + awake * 0.5);
      beamMat.opacity = awake * (0.18 + Math.sin(t * 2) * 0.03);
      light.intensity = awake * 30;
      ring.forEach((m, i) => (m.position.y = Math.sin(t * 1.1 + i) * 0.05 * awake));
    },
    dispose() {
      scene.remove(group);
      stoneGeo.dispose();
      altarGeo.dispose();
      crystalMat.dispose();
      crystal.geometry.dispose();
      beamMat.dispose();
      beam.geometry.dispose();
    },
  };
}

function floatingPickup(scene, pos, color, kind) {
  const group = new THREE.Group();
  group.position.set(pos.x, pos.y, pos.z);
  scene.add(group);
  const c = new THREE.Color(color);
  let mesh;
  if (kind === 'lantern') {
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
    mesh = new THREE.Mesh(merge([
      cyl(0.12, 0.14, 0.05, 6, '#4a3a2a', { y: 0.5 }),
      cyl(0.1, 0.1, 0.32, 6, '#ffe7a8', { y: 0.3 }),
      cyl(0.13, 0.12, 0.05, 6, '#4a3a2a', { y: 0.12 }),
      box(0.4, 0.1, 0.4, '#6f5034', { y: 0.05 }),
      cyl(0.015, 0.015, 0.2, 4, '#3a3026', { y: 0.62 }),
    ]), mat);
  } else {
    const mat = new THREE.MeshLambertMaterial({ color: c, emissive: c, emissiveIntensity: 1.3, flatShading: true });
    mesh = new THREE.Mesh(new THREE.OctahedronGeometry(0.32, 0), mat);
    mesh.position.y = 1.2;
  }
  group.add(mesh);
  const light = new THREE.PointLight(c, kind === 'lantern' ? 3 : 10, 8, 1.8);
  light.position.y = 1.1;
  group.add(light);
  return {
    pos,
    taken: false,
    update(t) {
      group.visible = !this.taken;
      if (kind !== 'lantern') {
        mesh.rotation.y = t * 1.2;
        mesh.position.y = 1.2 + Math.sin(t * 2) * 0.15;
      }
      light.intensity = (kind === 'lantern' ? 3 : 10) * (0.85 + Math.sin(t * 5) * 0.15);
    },
    dispose() {
      scene.remove(group);
      mesh.geometry.dispose();
      mesh.material.dispose();
    },
  };
}

function boat(scene, dockEnd, terrain) {
  const mat = createSeasonMaterial({ name: 'boat' });
  const hull = merge([
    box(1.6, 0.5, 4.2, '#7b5a3c', { y: 0.25 }),
    place(paint(new THREE.ConeGeometry(0.8, 1.3, 4), '#7b5a3c'), { y: 0.25, z: 2.7, rx: Math.PI / 2, ry: Math.PI / 4, sx: 1.4, sz: 0.45 }),
    box(1.7, 0.12, 4.3, '#5b4030', { y: 0.52 }),
    box(1.2, 0.08, 0.5, '#8a6748', { y: 0.5, z: -0.8 }),
    box(1.2, 0.08, 0.5, '#8a6748', { y: 0.5, z: 0.6 }),
    cyl(0.07, 0.08, 4.2, 5, '#4a3a2a', { y: 2.5, z: 0.4 }),
    place(paint(new THREE.PlaneGeometry(1.8, 2.8), '#efe6d0'), { x: 0.05, y: 2.8, z: -0.4, ry: Math.PI / 2 }),
    box(0.5, 0.3, 0.06, '#c9683a', { y: 4.4, z: 0.4, x: 0.25 }),
  ]);
  const mesh = new THREE.Mesh(hull, mat);
  mesh.material.side = THREE.DoubleSide;
  mesh.castShadow = true;
  const g = new THREE.Group();
  g.add(mesh);
  // Moor alongside the end of the dock.
  const home = { x: dockEnd.x + 2.6, y: 0, z: dockEnd.z - 0.5, ry: 0 };
  g.position.set(home.x, 0, home.z);
  scene.add(g);
  return {
    group: g,
    home,
    visible: false,
    update(t, waveScale = 1) {
      g.visible = this.visible;
      if (this.sailing) return;
      g.position.y = Math.sin(t * 1.2) * 0.06 * waveScale - 0.05;
      g.rotation.z = Math.sin(t * 0.9) * 0.03 * waveScale;
      g.rotation.x = Math.sin(t * 0.7 + 1) * 0.02 * waveScale;
    },
    dispose() {
      scene.remove(g);
      hull.dispose();
      mat.dispose();
    },
  };
}

/**
 * Build the crossing for a planned level.
 * @param {object} o {scene, collisions, terrain, plan, puzzles, props, trailFactory, time}
 */
export function buildCrossing({ scene, collisions, terrain, plan, puzzles, props, trailFactory, time }) {
  const material = createSeasonMaterial({ name: 'crossing' });
  const rng = createRandom(`${plan.level.seed}:crossing`);
  const ctx = { scene, collisions, terrain, material, rng, trailFactory, time };
  const parts = plan.segments.map((seg) => {
    const el = puzzles.get(seg.id);
    if (seg.type === 'vine') return vineBridge(seg, ctx);
    if (seg.type === 'hedge') return causewayWithHedge(seg, ctx);
    if (seg.type === 'drawbridge') return windmillBridge(seg, ctx, el.anchor);
    return { type: 'ice', update() {}, dispose() {} };
  });
  const ice = iceSheets(plan.segments.filter((s) => s.type === 'ice'), ctx);
  const sh = shrine(plan.shrine, ctx, plan.level);

  const d = props.data;
  let ember = null;
  if (plan.level.emberAt) {
    const spot = d[plan.level.emberAt];
    // Beside the landmark, not on top of its notebook interaction.
    const a = rng.range(0, Math.PI * 2);
    let ex = spot.x + Math.cos(a) * 2.6;
    let ez = spot.z + Math.sin(a) * 2.6;
    if (collisions.blocked(ex, ez, 0.5)) {
      ex = spot.x - Math.cos(a) * 2.6;
      ez = spot.z - Math.sin(a) * 2.6;
    }
    ember = floatingPickup(scene, { x: ex, y: terrain.heightAt(ex, ez), z: ez }, SEASON_INFO[plan.level.season].color, 'ember');
  }
  let lantern = null;
  if (plan.index === 0) {
    const n = d.dockNote;
    lantern = floatingPickup(scene, { x: n.x + 1.2, y: n.y + 0.06, z: n.z + 1.5 }, '#ffcf80', 'lantern');
  }
  const bt = boat(scene, d.dockEnd, terrain);

  return {
    parts,
    ice,
    shrine: sh,
    ember,
    lantern,
    boat: bt,
    material,
    update(dt, t, field) {
      puzzles.elements.forEach((el, i) => parts[i].update(el, dt));
      ice?.update(dt, field);
      sh.update(dt, t);
      ember?.update(t);
      lantern?.update(t);
    },
    dispose() {
      for (const p of parts) p.dispose();
      ice?.dispose();
      sh.dispose();
      ember?.dispose();
      lantern?.dispose();
      bt.dispose();
      material.dispose();
    },
  };
}
