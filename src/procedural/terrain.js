import { createNoise2D } from './noise.js';
import { clamp, lerp, smoothstep, distToPolyline } from './math.js';
import { DEFAULT_CONFIG, SEA_LEVEL, createLayout } from './layout.js';

// The island heightfield and the shared terrain queries.
//
// The analytic height function is sampled once into a grid. Every system
// (mesh, placement, player, wildlife, runoff) then reads the *grid* through
// heightAt(), which interpolates using the exact same triangle split as the
// render mesh. That way nothing floats or sinks between vertices.

export function resolveConfig(overrides = {}) {
  return {
    ...DEFAULT_CONFIG,
    ...overrides,
    mountain: { ...DEFAULT_CONFIG.mountain, ...(overrides.mountain || {}) },
    islets: overrides.islets || [],
    keepOut: overrides.keepOut || [],
  };
}

/** Stable fingerprint of the parameters that shape the terrain. Stored with saves. */
export function configKey(config) {
  const c = resolveConfig(config);
  return [c.seed, c.size, c.resolution, c.radius, c.maxHeight, c.coastIrregularity, c.noiseAmplitude, c.mountain.x, c.mountain.z, JSON.stringify(c.islets)].join('|');
}

export function generateTerrain(overrides = {}) {
  const config = resolveConfig(overrides);
  const layout = createLayout(config);
  const { noise2, fbm } = createNoise2D(`${config.seed}:terrain`);
  const coastNoise = createNoise2D(`${config.seed}:coast`);

  const L = layout;
  const lhAngle = Math.atan2(L.lighthouse.z, L.lighthouse.x);
  const angDiff = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));

  function baseHeight(x, z) {
    // Coastline: radius wobbles with low-frequency noise sampled on a circle
    // (no seam at +-PI), plus a deliberate headland for the lighthouse.
    const ang = Math.atan2(z, x);
    const cx = Math.cos(ang) * 1.6;
    const cz = Math.sin(ang) * 1.6;
    let R = config.radius * (1 + config.coastIrregularity * coastNoise.fbm(cx, cz, 3));
    R += 14 * Math.exp(-(angDiff(ang, lhAngle) ** 2) / 0.02);
    // Gentle bay around the starting cove.
    const coveAng = Math.atan2(L.cove.z, L.cove.x);
    R -= 6 * Math.exp(-(angDiff(ang, coveAng) ** 2) / 0.05);

    const d = Math.hypot(x, z) / R;
    const land = 1 - smoothstep(0.74, 1.04, d);

    let h = lerp(-7, 2.6, land);
    // Rolling hills, damped near the coast so beaches stay readable.
    h += land * land * config.noiseAmplitude * fbm(x * 0.022, z * 0.022, 4);
    h += land * 1.2 * smoothstep(0.2, 0.9, fbm(x * 0.05 + 7, z * 0.05 - 3, 2) + 0.5);

    // Central ridge: elongated gaussian with a few faceted bumps for rock faces.
    const mx = x - L.peak.x;
    const mz = (z - L.peak.z) * 1.25;
    const g = Math.exp(-(mx * mx + mz * mz) / (2 * L.peak.sigma * L.peak.sigma));
    h += config.maxHeight * g * (0.85 + 0.25 * noise2(x * 0.08, z * 0.08));
    // Secondary shoulder towards the cave side.
    const sx = x - (L.cave.x + 6);
    const sz = z - (L.cave.z - 2);
    h += 7 * Math.exp(-(sx * sx + sz * sz) / (2 * 11 * 11)) * land;
    return h;
  }

  function shapedHeight(x, z) {
    let h = baseHeight(x, z);

    // Flatten the village terrace.
    const dv = Math.hypot(x - L.village.x, z - L.village.z);
    h = lerp(h, L.village.height, 1 - smoothstep(L.village.r * 0.6, L.village.r * 1.3, dv));

    // Lower, flatter wetland basin.
    const dw = Math.hypot(x - L.wetland.x, z - L.wetland.z);
    h = lerp(h, L.wetland.height, 1 - smoothstep(L.wetland.r * 0.5, L.wetland.r * 1.4, dw));

    // Pools: shallow bowls inside the wetland.
    for (const p of L.pools) {
      const dp = Math.hypot(x - p.x, z - p.z);
      h -= 0.9 * Math.exp(-(dp * dp) / (2 * (p.r * 0.6) ** 2));
    }

    // Cove: soften into a sandy bowl.
    const dc = Math.hypot(x - L.cove.x, z - L.cove.z);
    h = lerp(h, Math.min(h, 1.6), 0.6 * (1 - smoothstep(6, 22, dc)));

    // Flat-ish ledge in front of the cave mouth.
    const dk = Math.hypot(x - L.cave.x, z - L.cave.z);
    h = lerp(h, caveFloor, 1 - smoothstep(5, 11, dk));
    return h;
  }

  const caveFloor = baseHeight(L.cave.x, L.cave.z);

  // Stream bed profile: sample the shaped terrain along the polyline, sink it
  // a little, then force it to be non-increasing so water never runs uphill.
  const BED_SAMPLES = 160;
  const bedProfile = new Float32Array(BED_SAMPLES + 1);
  {
    const pts = L.stream;
    const segLen = [];
    let total = 0;
    for (let i = 1; i < pts.length; i++) {
      const l = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
      segLen.push(l);
      total += l;
    }
    let running = shapedHeight(pts[0][0], pts[0][1]) - 1.2;
    for (let k = 0; k <= BED_SAMPLES; k++) {
      let dist = (k / BED_SAMPLES) * total;
      let si = 0;
      while (si < segLen.length - 1 && dist > segLen[si]) dist -= segLen[si++];
      const f = Math.min(1, dist / segLen[si]);
      const x = lerp(pts[si][0], pts[si + 1][0], f);
      const z = lerp(pts[si][1], pts[si + 1][1], f);
      running = Math.min(running, shapedHeight(x, z) - 1.2);
      bedProfile[k] = Math.max(running, lerp(SEA_LEVEL + 0.45, SEA_LEVEL - 0.8, k / BED_SAMPLES));
    }
  }
  const bedAt = (t) => {
    const f = clamp(t, 0, 1) * BED_SAMPLES;
    const k = Math.min(BED_SAMPLES - 1, Math.floor(f));
    return lerp(bedProfile[k], bedProfile[k + 1], f - k);
  };

  function rawHeight(x, z) {
    let h = shapedHeight(x, z);
    // Carve the stream channel.
    const s = distToPolyline(x, z, L.stream);
    const bed = bedAt(s.t);
    const w = 1 - smoothstep(1.2, 4.2, s.d);
    if (w > 0) h = lerp(h, Math.min(h, bed), w);

    // Offshore islets (used by the archipelago levels). Steep sides keep the
    // water between them deep enough that you can't just wade across.
    for (const it of config.islets) {
      const di = Math.hypot(x - it.x, z - it.z);
      if (di < it.r) h = Math.max(h, lerp(it.h, -4, smoothstep(it.r * 0.5, it.r, di)));
    }

    return h;
  }

  // ---- Sample into the grid ------------------------------------------------
  const N = config.resolution;
  const size = config.size;
  const half = size / 2;
  const cell = size / N;
  const heights = new Float32Array((N + 1) * (N + 1));
  for (let j = 0; j <= N; j++) {
    for (let i = 0; i <= N; i++) {
      heights[j * (N + 1) + i] = rawHeight(-half + i * cell, -half + j * cell);
    }
  }

  const H = (i, j) => heights[clamp(j, 0, N) * (N + 1) + clamp(i, 0, N)];

  /** Height of the rendered surface at (x, z). Matches the mesh triangulation. */
  function heightAt(x, z) {
    const gx = (x + half) / cell;
    const gz = (z + half) / cell;
    if (gx < 0 || gz < 0 || gx >= N || gz >= N) return -8;
    const i = Math.floor(gx);
    const j = Math.floor(gz);
    const fx = gx - i;
    const fz = gz - j;
    const a = H(i, j);
    const b = H(i + 1, j);
    const c = H(i, j + 1);
    const d = H(i + 1, j + 1);
    // Split along the b-c diagonal (same as the mesh index order).
    if (fx + fz <= 1) return a + (b - a) * fx + (c - a) * fz;
    return d + (c - d) * (1 - fx) + (b - d) * (1 - fz);
  }

  /** Unit normal via central differences; writes into `out` if given. */
  function normalAt(x, z, out = { x: 0, y: 1, z: 0 }) {
    const e = cell * 0.75;
    const dx = heightAt(x + e, z) - heightAt(x - e, z);
    const dz = heightAt(x, z + e) - heightAt(x, z - e);
    const nx = -dx;
    const ny = 2 * e;
    const nz = -dz;
    const len = Math.hypot(nx, ny, nz);
    out.x = nx / len;
    out.y = ny / len;
    out.z = nz / len;
    return out;
  }

  /** 0 = flat, 1 = vertical. */
  function slopeAt(x, z) {
    return 1 - normalAt(x, z).y;
  }

  function isLandAt(x, z) {
    return heightAt(x, z) > SEA_LEVEL + 0.15;
  }

  const pathDistance = (x, z) => {
    let best = Infinity;
    for (const p of L.paths) best = Math.min(best, distToPolyline(x, z, p).d);
    return best;
  };
  const streamDistance = (x, z) => distToPolyline(x, z, L.stream).d;

  function regionAt(x, z) {
    const h = heightAt(x, z);
    if (h <= SEA_LEVEL) return 'sea';
    const near = (p, r) => Math.hypot(x - p.x, z - p.z) < r;
    for (const it of config.islets) if (it.shrine && Math.hypot(x - it.x, z - it.z) < it.r) return 'shrine';
    if (near(L.cave, L.cave.r)) return 'cave';
    if (near(L.lighthouse, L.lighthouse.r + 4)) return 'lighthouse';
    if (near(L.village, L.village.r + 3)) return 'village';
    if (near(L.cove, L.cove.r)) return 'cove';
    if (near(L.wetland, L.wetland.r + 5) || streamDistance(x, z) < 4) return 'wetland';
    if (h > 11) return 'ridge';
    if (near(L.forest, L.forest.r)) return 'forest';
    if (h < 1.5) return 'beach';
    return 'meadow';
  }

  /** Surface material used by trails, footsteps and placement. */
  function groundTypeAt(x, z) {
    const h = heightAt(x, z);
    if (h <= SEA_LEVEL + 0.05) return 'water';
    if (Math.hypot(x - L.village.x, z - L.village.z) < 9) return 'path';
    if (pathDistance(x, z) < 1.4) return 'path';
    const slope = slopeAt(x, z);
    if (slope > 0.32 || h > 15) return 'rock';
    if (h < 1.4) return 'sand';
    return 'grass';
  }

  return {
    config,
    layout,
    seaLevel: SEA_LEVEL,
    grid: { N, size, half, cell, heights },
    heightAt,
    normalAt,
    slopeAt,
    isLandAt,
    regionAt,
    groundTypeAt,
    pathDistance,
    streamDistance,
    streamBedAt: bedAt,
  };
}
