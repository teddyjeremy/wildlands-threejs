// Drainage routes. Starting from a few seeded points high on the ridge,
// walk steepest-descent over the shared terrain query until reaching the
// sea, the stream, a pool, or a local minimum. The result is a set of
// polylines whose height never increases - water can't run uphill.

import { createRandom } from '../procedural/random.js';

export function traceDownhill(terrain, x, z, { step = 1.0, maxSteps = 400, stopAt } = {}) {
  const pts = [[x, terrain.heightAt(x, z), z]];
  let cx = x;
  let cz = z;
  let ch = terrain.heightAt(x, z);
  const dirs = 16;
  let prevDx = 0;
  let prevDz = 0;
  for (let s = 0; s < maxSteps; s++) {
    let best = null;
    for (let k = 0; k < dirs; k++) {
      const a = (k / dirs) * Math.PI * 2;
      const dx = Math.cos(a);
      const dz = Math.sin(a);
      const nx = cx + dx * step;
      const nz = cz + dz * step;
      const nh = terrain.heightAt(nx, nz);
      // Mild preference for keeping direction avoids zig-zagging on flats.
      const score = nh - (dx * prevDx + dz * prevDz) * 0.02;
      if (nh < ch && (!best || score < best.score)) best = { nx, nz, nh, dx, dz, score };
    }
    if (!best) break; // local minimum: water would pool here
    cx = best.nx;
    cz = best.nz;
    ch = best.nh;
    prevDx = best.dx;
    prevDz = best.dz;
    pts.push([cx, ch, cz]);
    if (ch <= terrain.seaLevel) break;
    if (stopAt && stopAt(cx, cz, ch)) break;
  }
  return pts;
}

export function buildDrainage(terrain, seed, count = 5) {
  const rng = createRandom(`${seed}:runoff`);
  const L = terrain.layout;
  const routes = [];
  const stopAt = (x, z) => terrain.streamDistance(x, z) < 1.5 || L.pools.some((p) => Math.hypot(x - p.x, z - p.z) < p.r * 0.6);
  for (let i = 0, tries = 0; routes.length < count && tries < 60; tries++, i++) {
    // Start points ring the summit, biased to the western (stream) side.
    const a = Math.PI * (0.55 + rng.range(0, 1.0)) + (i % 2 ? 0 : rng.range(-1.2, 0.4));
    const r = rng.range(5, 12);
    const x = L.peak.x + Math.cos(a) * r;
    const z = L.peak.z + Math.sin(a) * r;
    const pts = traceDownhill(terrain, x, z, { step: 1.0, stopAt });
    if (pts.length < 12) continue;
    routes.push({ id: `runoff-${routes.length}`, points: pts });
  }
  return routes;
}
