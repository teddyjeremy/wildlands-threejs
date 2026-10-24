import * as THREE from 'three';
import { createRandom } from '../procedural/random.js';
import { WildlifeBrain } from './wildlifeBrain.js';
import { paint, place, merge, box, cone } from '../procedural/geo.js';

// Island hares: procedural bodies, a WildlifeBrain each, simple steering.
// Behaviour updates run on a fixed 20 Hz tick, only for animals near the player;
// rendering interpolates position every frame.

const TICK = 1 / 20;

function buildHare() {
  const fur = '#b08a62';
  const light = '#e8dcc6';
  const root = new THREE.Group();
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  const body = new THREE.Mesh(merge([
    place(paint(new THREE.IcosahedronGeometry(0.32, 0), fur), { y: 0.32, sz: 1.45, sx: 0.9 }),
    place(paint(new THREE.IcosahedronGeometry(0.18, 0), light), { y: 0.36, z: -0.42 }), // tail
  ]), mat);
  root.add(body);
  // Head on a pivot so it can look around / dip to graze.
  const neck = new THREE.Group();
  neck.position.set(0, 0.45, 0.32);
  const head = new THREE.Mesh(merge([
    place(paint(new THREE.IcosahedronGeometry(0.17, 0), fur), { z: 0.1, sz: 1.3 }),
    box(0.05, 0.05, 0.05, '#2a2420', { x: 0.1, y: 0.04, z: 0.16 }),
    box(0.05, 0.05, 0.05, '#2a2420', { x: -0.1, y: 0.04, z: 0.16 }),
    box(0.05, 0.04, 0.04, '#d9a0a0', { y: -0.02, z: 0.31 }),
  ]), mat);
  neck.add(head);
  const ears = [];
  for (const sx of [-1, 1]) {
    const ear = new THREE.Group();
    ear.position.set(sx * 0.07, 0.12, 0.02);
    ear.add(new THREE.Mesh(merge([cone(0.05, 0.38, 4, fur, { y: 0.19, sz: 0.5 }), cone(0.03, 0.3, 4, '#d8b6a0', { y: 0.18, z: 0.012, sz: 0.4 })]), mat));
    ear.rotation.z = sx * -0.15;
    neck.add(ear);
    ears.push(ear);
  }
  root.add(neck);
  // Legs on hip/shoulder pivots.
  const legs = [];
  const legGeo = merge([box(0.07, 0.24, 0.09, fur, { y: -0.12 })]);
  const hindGeo = merge([box(0.09, 0.26, 0.2, fur, { y: -0.12, z: 0.04 })]);
  for (const [x, z, hind] of [[-0.14, 0.24, 0], [0.14, 0.24, 0], [-0.17, -0.2, 1], [0.17, -0.2, 1]]) {
    const pivot = new THREE.Group();
    pivot.position.set(x, 0.26, z);
    pivot.add(new THREE.Mesh(hind ? hindGeo : legGeo, mat));
    root.add(pivot);
    legs.push({ pivot, hind });
  }
  root.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return { root, neck, ears, legs, mat };
}

export class Wildlife {
  constructor({ scene, terrain, collisions, seed, count = 3 }) {
    this.terrain = terrain;
    this.collisions = collisions;
    this.scene = scene;
    this.animals = [];
    this.acc = 0;
    this.activeRange = 70;
    this.activeCount = 0;
    const L = terrain.layout;
    // Habitat: a clearing on the forest's meadow side.
    this.habitat = { x: L.forest.x + 4, z: L.forest.z + 10, r: 16 };
    const rng = createRandom(`${seed}:wildlife`);
    for (let i = 0; i < count; i++) {
      let x = this.habitat.x;
      let z = this.habitat.z;
      for (let t = 0; t < 30; t++) {
        const a = rng.range(0, 6.28);
        const r = rng.range(0, this.habitat.r * 0.6);
        x = this.habitat.x + Math.cos(a) * r;
        z = this.habitat.z + Math.sin(a) * r;
        if (this.valid(x, z)) break;
      }
      const view = buildHare();
      view.root.position.set(x, terrain.heightAt(x, z), z);
      scene.add(view.root);
      const brain = new WildlifeBrain({ home: { x, z }, habitatRadius: this.habitat.r, rng: rng.fork(`hare${i}`) });
      // Each animal's home sits inside the shared habitat.
      brain.home = { x, z };
      brain.clampToHabitat = (p) => {
        const dx = p.x - this.habitat.x;
        const dz = p.z - this.habitat.z;
        const d = Math.hypot(dx, dz);
        if (d > this.habitat.r) {
          p.x = this.habitat.x + (dx / d) * this.habitat.r;
          p.z = this.habitat.z + (dz / d) * this.habitat.r;
        }
        return p;
      };
      this.animals.push({
        id: `hare-${i}`,
        view,
        brain,
        pos: { x, z },
        prev: { x, z },
        heading: rng.range(0, 6.28),
        speed: 0,
        anim: rng.range(0, 10),
        stuck: 0,
        active: true,
      });
    }
    this.lastStates = this.animals.map((a) => a.brain.state);
  }

  /** Suitable ground: land, not steep, not water, not inside a solid. */
  valid(x, z) {
    const t = this.terrain;
    if (t.heightAt(x, z) < 1.0) return false;
    if (t.slopeAt(x, z) > 0.3) return false;
    if (t.streamDistance(x, z) < 2) return false;
    return !this.collisions.blocked(x, z, 0.3, t.heightAt(x, z));
  }

  setCount(n) {
    this.animals.forEach((a, i) => {
      a.enabled = i < n;
      a.view.root.visible = a.enabled;
    });
  }

  _tick(a, player) {
    a.prev.x = a.pos.x;
    a.prev.z = a.pos.z;
    const prevState = a.brain.state;
    a.brain.tick(TICK, a.pos, player);
    const desired = a.brain.speed();
    const tx = a.brain.target.x - a.pos.x;
    const tz = a.brain.target.z - a.pos.z;
    const dist = Math.hypot(tx, tz);
    // Turn toward the target with a limited turn rate (no direction jitter).
    if (a.brain.state === 'notice' || a.brain.state === 'alert') {
      const look = Math.atan2(player.x - a.pos.x, player.z - a.pos.z);
      a.heading += Math.atan2(Math.sin(look - a.heading), Math.cos(look - a.heading)) * Math.min(1, TICK * 6);
    } else if (dist > 0.3) {
      const want = Math.atan2(tx, tz);
      const diff = Math.atan2(Math.sin(want - a.heading), Math.cos(want - a.heading));
      const rate = a.brain.state === 'flee' ? 9 : 3.5;
      a.heading += Math.max(-rate * TICK, Math.min(rate * TICK, diff));
    }
    const go = dist > 0.3 ? desired : 0;
    a.speed += (go - a.speed) * Math.min(1, TICK * 6);
    const nx = a.pos.x + Math.sin(a.heading) * a.speed * TICK;
    const nz = a.pos.z + Math.cos(a.heading) * a.speed * TICK;
    if (this.valid(nx, nz)) {
      a.pos.x = nx;
      a.pos.z = nz;
      a.stuck = 0;
    } else if (a.speed > 0.1) {
      // Blocked: try sliding left/right before giving up.
      let moved = false;
      for (const off of [0.7, -0.7, 1.4, -1.4]) {
        const h = a.heading + off;
        const sx = a.pos.x + Math.sin(h) * a.speed * TICK;
        const sz = a.pos.z + Math.cos(h) * a.speed * TICK;
        if (this.valid(sx, sz)) {
          a.pos.x = sx;
          a.pos.z = sz;
          a.heading += off * 0.3;
          moved = true;
          break;
        }
      }
      if (!moved) {
        a.stuck += TICK;
        if (a.stuck > 0.6 && a.brain.state === 'forage') a.brain._pickForageTarget();
        a.speed *= 0.5;
      }
    }
    return prevState !== a.brain.state ? a.brain.state : null;
  }

  /**
   * @returns {Array} state-change events [{animal, state}]
   */
  update(dt, player) {
    const events = [];
    this.acc = Math.min(this.acc + dt, 0.25);
    while (this.acc >= TICK) {
      this.acc -= TICK;
      this.activeCount = 0;
      for (const a of this.animals) {
        if (a.enabled === false) continue;
        a.active = Math.hypot(player.x - a.pos.x, player.z - a.pos.z) < this.activeRange;
        if (!a.active) continue;
        this.activeCount++;
        const changed = this._tick(a, player);
        if (changed) events.push({ animal: a, state: changed });
      }
    }
    const alpha = this.acc / TICK;
    for (const a of this.animals) {
      if (a.enabled === false) continue;
      const x = a.prev.x + (a.pos.x - a.prev.x) * alpha;
      const z = a.prev.z + (a.pos.z - a.prev.z) * alpha;
      const v = a.view;
      v.root.position.set(x, this.terrain.heightAt(x, z), z);
      v.root.rotation.y = a.heading;
      // Animation: hop when moving, graze/twitch when foraging, ears up when alert.
      a.anim += dt * (2 + a.speed * 3);
      const moving = a.speed > 0.3;
      const hop = moving ? Math.abs(Math.sin(a.anim * 2.2)) * Math.min(0.25, a.speed * 0.05) : 0;
      v.root.position.y += hop;
      for (const leg of v.legs) leg.pivot.rotation.x = moving ? Math.sin(a.anim * 2.2 + (leg.hind ? Math.PI : 0)) * 0.7 : 0;
      const state = a.brain.state;
      const graze = state === 'forage' && !moving ? (Math.sin(a.anim * 0.7) > 0.2 ? 0.7 : 0.1) : 0;
      const alert = state === 'notice' || state === 'alert' ? 1 : 0;
      v.neck.rotation.x += ((graze - alert * 0.3) - v.neck.rotation.x) * Math.min(1, dt * 6);
      for (const ear of v.ears) ear.rotation.x += ((alert ? -0.25 : 0.35 + Math.sin(a.anim * 3) * 0.05) - ear.rotation.x) * Math.min(1, dt * 8);
    }
    return events;
  }

  /** Nearest animal to a point (for the observation interaction). */
  nearest(x, z) {
    let best = null;
    let bd = Infinity;
    for (const a of this.animals) {
      if (a.enabled === false) continue;
      const d = Math.hypot(a.pos.x - x, a.pos.z - z);
      if (d < bd) {
        bd = d;
        best = a;
      }
    }
    return best ? { animal: best, distance: bd } : null;
  }

  dispose() {
    for (const a of this.animals) {
      this.scene.remove(a.view.root);
      a.view.root.traverse((o) => o.geometry?.dispose());
      a.view.mat.dispose();
    }
  }
}
