import { createRandom } from './random.js';
import { createNoise2D } from './noise.js';

// Rule-based placement. Output is plain data (positions, kinds, scales) so it
// can be unit tested and inspected in the debug view without Three.js.

class SpacingGrid {
  constructor(cell = 4) {
    this.cell = cell;
    this.map = new Map();
  }
  key(x, z) {
    return `${Math.floor(x / this.cell)},${Math.floor(z / this.cell)}`;
  }
  add(x, z, r) {
    const k = this.key(x, z);
    if (!this.map.has(k)) this.map.set(k, []);
    this.map.get(k).push({ x, z, r });
  }
  free(x, z, r) {
    const cx = Math.floor(x / this.cell);
    const cz = Math.floor(z / this.cell);
    const span = Math.ceil((r + 6) / this.cell);
    for (let i = -span; i <= span; i++) {
      for (let j = -span; j <= span; j++) {
        const list = this.map.get(`${cx + i},${cz + j}`);
        if (!list) continue;
        for (const o of list) if (Math.hypot(o.x - x, o.z - z) < r + o.r) return false;
      }
    }
    return true;
  }
}

/** Places that must stay clear of trees/rocks (approach routes, landmarks). */
function keepOutZones(L) {
  return [
    { x: L.village.x, z: L.village.z, r: L.village.r + 3 },
    { x: L.lighthouse.x, z: L.lighthouse.z, r: 9 },
    { x: L.cave.x, z: L.cave.z, r: 9 },
    { x: L.cave.x, z: L.cave.z + 9, r: 5 },
    { x: L.spring.x, z: L.spring.z, r: 4 },
    { x: L.bridge.x, z: L.bridge.z, r: 7 },
    { x: L.cove.x, z: L.cove.z, r: 7 },
    { x: L.cove.x + 2, z: L.cove.z + 10, r: 6 },
    { x: L.peak.x, z: L.peak.z, r: 4 },
    { x: L.forest.x - 6, z: L.forest.z - 4, r: 6 }, // old tree clearing
    ...L.pools.map((p) => ({ x: p.x, z: p.z, r: p.r + 1.5 })),
    ...(L.keepOut || []),
  ];
}

const inZone = (zones, x, z, pad = 0) => zones.some((k) => Math.hypot(x - k.x, z - k.z) < k.r + pad);

export function placeHouses(terrain, seed) {
  const rng = createRandom(`${seed}:houses`);
  const L = terrain.layout;
  const houses = [];
  const count = 7;
  for (let i = 0; i < count; i++) {
    // Leave a gap towards the south-east where the cove path arrives.
    const a = (i / count) * Math.PI * 1.7 + 1.35 + rng.range(-0.12, 0.12);
    const r = rng.range(11, 13.5);
    const x = L.village.x + Math.cos(a) * r;
    const z = L.village.z + Math.sin(a) * r;
    // Face the doorway back towards the clearing.
    const ry = Math.atan2(L.village.x - x, L.village.z - z);
    houses.push({ id: `house-${i}`, x, z, y: terrain.heightAt(x, z), ry, variant: i });
  }
  return houses;
}

export function placeTrees(terrain, seed, houses = []) {
  const rng = createRandom(`${seed}:trees`);
  const L = terrain.layout;
  const zones = keepOutZones(L);
  const grid = new SpacingGrid(4);
  for (const h of houses) grid.add(h.x, h.z, 4.5);
  const trees = [];
  const half = terrain.grid.half - 10;
  for (let n = 0; n < 9000 && trees.length < 420; n++) {
    const x = rng.range(-half, half);
    const z = rng.range(-half, half);
    const h = terrain.heightAt(x, z);
    if (h < 1.9) continue;
    if (terrain.slopeAt(x, z) > 0.33) continue;
    if (terrain.pathDistance(x, z) < 2.6) continue;
    if (terrain.streamDistance(x, z) < 3.2) continue;
    if (inZone(zones, x, z)) continue;
    const region = terrain.regionAt(x, z);
    let kind;
    let spacing;
    let keep;
    switch (region) {
      case 'forest':
        kind = rng.chance(0.55) ? 'broadleaf' : 'pine';
        spacing = 2.8;
        keep = 0.95;
        break;
      case 'ridge':
        kind = 'pine';
        spacing = 4.5;
        keep = 0.35;
        break;
      case 'meadow':
        kind = rng.chance(0.6) ? 'birch' : 'broadleaf';
        spacing = 6;
        keep = 0.16;
        break;
      case 'wetland':
        kind = 'birch';
        spacing = 5;
        keep = 0.3;
        break;
      default:
        continue;
    }
    if (!rng.chance(keep)) continue;
    if (!grid.free(x, z, spacing / 2)) continue;
    grid.add(x, z, spacing / 2);
    trees.push({ kind, x, z, y: h, ry: rng.range(0, Math.PI * 2), scale: rng.range(0.85, 1.25) });
  }
  return trees;
}

export function placeRocks(terrain, seed, trees = []) {
  const rng = createRandom(`${seed}:rocks`);
  const L = terrain.layout;
  const zones = keepOutZones(L);
  const grid = new SpacingGrid(4);
  for (const t of trees) grid.add(t.x, t.z, 0.8);
  const rocks = [];
  const half = terrain.grid.half - 8;
  // Cluster centres first, then scatter a few rocks around each.
  for (let n = 0; n < 2400 && rocks.length < 260; n++) {
    const cx = rng.range(-half, half);
    const cz = rng.range(-half, half);
    const h = terrain.heightAt(cx, cz);
    const slope = terrain.slopeAt(cx, cz);
    const shore = h > -0.3 && h < 1.4;
    const steep = slope > 0.22 && h > 5;
    const forest = terrain.regionAt(cx, cz) === 'forest' && rng.chance(0.08);
    if (!(shore && rng.chance(0.25)) && !steep && !forest) continue;
    if (terrain.pathDistance(cx, cz) < 3 || inZone(zones, cx, cz, 1)) continue;
    const members = rng.int(2, 4);
    for (let m = 0; m < members; m++) {
      const x = cx + rng.range(-2.5, 2.5);
      const z = cz + rng.range(-2.5, 2.5);
      const y = terrain.heightAt(x, z);
      if (y < -0.4 || terrain.pathDistance(x, z) < 2.4 || inZone(zones, x, z)) continue;
      const kind = steep && rng.chance(0.4) ? 'cliff' : m === 0 ? 'boulder' : rng.chance(0.5) ? 'boulder' : 'pebble';
      const scale = kind === 'pebble' ? rng.range(0.8, 1.6) : kind === 'cliff' ? rng.range(0.7, 1.1) : rng.range(0.6, 1.5);
      const r = kind === 'pebble' ? 0.3 * scale : kind === 'cliff' ? 1.9 * scale : 0.85 * scale;
      if (!grid.free(x, z, r)) continue;
      grid.add(x, z, r);
      rocks.push({ kind, x, z, y, ry: rng.range(0, 6.28), scale, radius: r });
    }
  }
  // Stepping stones along the stream edge in the wetland.
  const srng = createRandom(`${seed}:steps`);
  for (let i = 0; i < 8; i++) {
    const p = L.pools[i % L.pools.length];
    const a = srng.range(0, 6.28);
    const x = p.x + Math.cos(a) * (p.r + 1.2);
    const z = p.z + Math.sin(a) * (p.r + 1.2);
    rocks.push({ kind: 'flat', x, z, y: terrain.heightAt(x, z) - 0.05, ry: a, scale: srng.range(0.6, 0.9), radius: 0 });
  }
  return rocks;
}

/**
 * Grass clump positions. Generated once at the maximum density in random
 * order, so lower quality presets simply take a prefix of the list.
 */
export function placeGrass(terrain, seed, maxCount = 26000) {
  const rng = createRandom(`${seed}:grass`);
  const { fbm } = createNoise2D(`${seed}:grass-noise`);
  const out = new Float32Array(maxCount * 4); // x, y, z, scale
  const half = terrain.grid.half - 10;
  let n = 0;
  for (let tries = 0; tries < maxCount * 8 && n < maxCount; tries++) {
    const x = rng.range(-half, half);
    const z = rng.range(-half, half);
    if (terrain.groundTypeAt(x, z) !== 'grass') continue;
    // Clustered: noise decides patchiness, lower density right by paths.
    const patch = fbm(x * 0.06, z * 0.06, 3) * 0.5 + 0.55;
    const nearPath = Math.min(1, (terrain.pathDistance(x, z) - 1.2) / 3);
    if (rng.next() > patch * Math.max(0.15, nearPath)) continue;
    out[n * 4] = x;
    out[n * 4 + 1] = terrain.heightAt(x, z);
    out[n * 4 + 2] = z;
    out[n * 4 + 3] = rng.range(0.7, 1.3);
    n++;
  }
  return out.subarray(0, n * 4);
}

export function placeFlowers(terrain, seed, count = 900) {
  const rng = createRandom(`${seed}:flowers`);
  const list = [];
  const half = terrain.grid.half - 10;
  for (let tries = 0; tries < count * 20 && list.length < count; tries++) {
    const cx = rng.range(-half, half);
    const cz = rng.range(-half, half);
    if (terrain.groundTypeAt(cx, cz) !== 'grass' || terrain.regionAt(cx, cz) === 'forest') continue;
    const colour = rng.int(0, 3);
    for (let k = 0; k < 6; k++) {
      const x = cx + rng.range(-1.5, 1.5);
      const z = cz + rng.range(-1.5, 1.5);
      if (terrain.groundTypeAt(x, z) !== 'grass') continue;
      list.push({ x, z, y: terrain.heightAt(x, z), colour, scale: rng.range(0.7, 1.2) });
    }
  }
  return list.slice(0, count);
}

/** Fixed, hand-picked collectible spots near landmarks (checked for land). */
export function placeCollectibles(terrain) {
  const L = terrain.layout;
  const spots = [
    { id: 'sea-glass', name: 'Sea Glass', x: L.cove.x - 4, z: L.cove.z + 3 },
    { id: 'heron-feather', name: 'Heron Feather', x: L.pools[0].x + L.pools[0].r + 2.2, z: L.pools[0].z },
    { id: 'amber-bead', name: 'Amber Bead', x: L.forest.x - 6, z: L.forest.z + 1.5 },
    { id: 'brass-compass', name: 'Brass Compass', x: L.lighthouse.x - 1, z: L.lighthouse.z + 6.5 },
    { id: 'cave-crystal', name: 'Glow Crystal', x: L.cave.x - 1.5, z: L.cave.z - 1.0 },
  ];
  return spots.map((s) => ({ ...s, y: terrain.heightAt(s.x, s.z) }));
}

export { SpacingGrid };
