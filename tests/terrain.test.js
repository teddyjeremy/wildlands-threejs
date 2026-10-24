import { describe, it, expect } from 'vitest';
import { generateTerrain } from '../src/procedural/terrain.js';
import { traceDownhill, buildDrainage } from '../src/simulation/runoff.js';

const t = generateTerrain({ seed: 'wildlands' });
const { N, half, cell, heights } = t.grid;

describe('terrain queries', () => {
  it('heightAt matches the grid exactly at vertices', () => {
    for (const [i, j] of [[0, 0], [10, 20], [90, 90], [N - 1, N - 1], [45, 130]]) {
      const x = -half + i * cell;
      const z = -half + j * cell;
      expect(t.heightAt(x, z)).toBeCloseTo(heights[j * (N + 1) + i], 5);
    }
  });

  it('heightAt is continuous between vertices (same triangles as the mesh)', () => {
    let worst = 0;
    for (let k = 0; k < 2000; k++) {
      const x = -80 + (k * 7.31) % 160;
      const z = -80 + (k * 3.17) % 160;
      const a = t.heightAt(x, z);
      const b = t.heightAt(x + 0.01, z + 0.01);
      worst = Math.max(worst, Math.abs(a - b));
    }
    expect(worst).toBeLessThan(0.1);
  });

  it('normals are unit length and point up', () => {
    for (let k = 0; k < 200; k++) {
      const n = t.normalAt(-60 + k * 0.6, 30 - k * 0.4);
      expect(Math.hypot(n.x, n.y, n.z)).toBeCloseTo(1, 5);
      expect(n.y).toBeGreaterThan(0);
    }
  });

  it('island is surrounded by sea and its landmarks are on land', () => {
    expect(t.isLandAt(0, 0)).toBe(true);
    expect(t.isLandAt(110, 0)).toBe(false);
    expect(t.isLandAt(0, -110)).toBe(false);
    expect(t.heightAt(500, 500)).toBeLessThan(t.seaLevel);
    const L = t.layout;
    for (const key of ['cove', 'village', 'forest', 'lighthouse', 'cave', 'spring']) {
      expect(t.isLandAt(L[key].x, L[key].z), key).toBe(true);
    }
  });

  it('island footprint is roughly 150-200 units across', () => {
    let minX = Infinity;
    let maxX = -Infinity;
    for (let x = -120; x <= 120; x += 0.5) {
      if (t.isLandAt(x, 0)) {
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
      }
    }
    expect(maxX - minX).toBeGreaterThan(140);
    expect(maxX - minX).toBeLessThan(210);
  });

  it('regions classify the authored landmarks', () => {
    const L = t.layout;
    expect(t.regionAt(L.village.x, L.village.z)).toBe('village');
    expect(t.regionAt(L.cave.x, L.cave.z)).toBe('cave');
    expect(t.regionAt(L.lighthouse.x, L.lighthouse.z)).toBe('lighthouse');
    expect(t.regionAt(300, 0)).toBe('sea');
    expect(t.heightAt(L.peak.x, L.peak.z)).toBeGreaterThan(15);
  });

  it('stream bed never runs uphill', () => {
    let prev = Infinity;
    for (let k = 0; k <= 100; k++) {
      const h = t.streamBedAt(k / 100);
      expect(h).toBeLessThanOrEqual(prev + 1e-6);
      prev = h;
    }
  });
});

describe('runoff routes', () => {
  it('traceDownhill only descends', () => {
    const pts = traceDownhill(t, t.layout.peak.x + 4, t.layout.peak.z + 3);
    expect(pts.length).toBeGreaterThan(5);
    for (let i = 1; i < pts.length; i++) expect(pts[i][1]).toBeLessThan(pts[i - 1][1]);
  });

  it('drainage builds several deterministic channels ending low', () => {
    const a = buildDrainage(t, 'wildlands', 5);
    const b = buildDrainage(t, 'wildlands', 5);
    expect(a.length).toBeGreaterThanOrEqual(3);
    expect(a).toEqual(b);
    for (const r of a) {
      const start = r.points[0][1];
      const end = r.points[r.points.length - 1][1];
      expect(end).toBeLessThan(start - 3);
    }
  });
});
