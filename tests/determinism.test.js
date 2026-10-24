import { describe, it, expect } from 'vitest';
import { createRandom, hashSeed } from '../src/procedural/random.js';
import { createNoise2D } from '../src/procedural/noise.js';
import { generateTerrain, configKey } from '../src/procedural/terrain.js';
import { placeTrees, placeRocks, placeHouses, placeGrass, placeCollectibles } from '../src/procedural/placement.js';

describe('seeded random', () => {
  it('repeats for the same seed and differs for another', () => {
    const a = createRandom('island');
    const b = createRandom('island');
    const c = createRandom('other');
    const seqA = Array.from({ length: 20 }, () => a.next());
    const seqB = Array.from({ length: 20 }, () => b.next());
    const seqC = Array.from({ length: 20 }, () => c.next());
    expect(seqA).toEqual(seqB);
    expect(seqA).not.toEqual(seqC);
    for (const v of seqA) expect(v).toBeGreaterThanOrEqual(0);
    for (const v of seqA) expect(v).toBeLessThan(1);
  });

  it('forks into independent streams', () => {
    const r = createRandom('x');
    expect(r.fork('a').next()).not.toEqual(r.fork('b').next());
    expect(hashSeed('abc')).toBe(hashSeed('abc'));
  });

  it('noise is deterministic and bounded', () => {
    const n1 = createNoise2D('s');
    const n2 = createNoise2D('s');
    for (let i = 0; i < 200; i++) {
      const x = i * 0.37;
      const y = i * 0.91;
      expect(n1.noise2(x, y)).toBe(n2.noise2(x, y));
      expect(Math.abs(n1.fbm(x, y, 4))).toBeLessThanOrEqual(1.01);
    }
  });
});

describe('world generation', () => {
  const t1 = generateTerrain({ seed: 'wildlands' });
  const t2 = generateTerrain({ seed: 'wildlands' });

  it('same seed + config gives identical heights', () => {
    expect(t1.grid.heights.length).toBe(t2.grid.heights.length);
    let diff = 0;
    for (let i = 0; i < t1.grid.heights.length; i += 97) diff += Math.abs(t1.grid.heights[i] - t2.grid.heights[i]);
    expect(diff).toBe(0);
    expect(configKey(t1.config)).toBe(configKey(t2.config));
  });

  it('a different seed changes the terrain', () => {
    const t3 = generateTerrain({ seed: 'another-island' });
    let diff = 0;
    for (let i = 0; i < t1.grid.heights.length; i += 97) diff += Math.abs(t1.grid.heights[i] - t3.grid.heights[i]);
    expect(diff).toBeGreaterThan(1);
    expect(configKey(t3.config)).not.toBe(configKey(t1.config));
  });

  it('same seed gives identical placements', () => {
    const h1 = placeHouses(t1, 'wildlands');
    const h2 = placeHouses(t2, 'wildlands');
    expect(h1).toEqual(h2);
    const a = placeTrees(t1, 'veg', h1);
    const b = placeTrees(t2, 'veg', h2);
    expect(a.length).toBeGreaterThan(100);
    expect(a).toEqual(b);
    expect(placeRocks(t1, 'veg', a)).toEqual(placeRocks(t2, 'veg', b));
    expect(Array.from(placeGrass(t1, 'veg', 2000))).toEqual(Array.from(placeGrass(t2, 'veg', 2000)));
  });

  it('changing only the vegetation seed keeps the terrain', () => {
    const tv = generateTerrain({ seed: 'wildlands', vegetationSeed: 'spring-planting' });
    expect(tv.heightAt(10, 10)).toBe(t1.heightAt(10, 10));
    const a = placeTrees(t1, 'veg-a');
    const b = placeTrees(tv, 'veg-b');
    expect(a).not.toEqual(b);
  });
});

describe('placement rules', () => {
  const t = generateTerrain({ seed: 'wildlands' });
  const houses = placeHouses(t, 'wildlands');
  const trees = placeTrees(t, 'veg', houses);

  it('trees only grow on land, off paths, on modest slopes', () => {
    for (const tree of trees) {
      expect(t.heightAt(tree.x, tree.z)).toBeGreaterThan(t.seaLevel + 1);
      expect(t.slopeAt(tree.x, tree.z)).toBeLessThanOrEqual(0.33);
      expect(t.pathDistance(tree.x, tree.z)).toBeGreaterThanOrEqual(2.5);
    }
  });

  it('trees keep a minimum spacing', () => {
    for (let i = 0; i < trees.length; i++) {
      for (let j = i + 1; j < trees.length; j++) {
        expect(Math.hypot(trees[i].x - trees[j].x, trees[i].z - trees[j].z)).toBeGreaterThan(1.3);
      }
    }
  });

  it('houses sit on level village ground and face the clearing', () => {
    expect(houses.length).toBeGreaterThanOrEqual(6);
    for (const h of houses) {
      expect(t.regionAt(h.x, h.z)).toBe('village');
      expect(t.slopeAt(h.x, h.z)).toBeLessThan(0.05);
      const toCentre = Math.atan2(t.layout.village.x - h.x, t.layout.village.z - h.z);
      expect(Math.abs(Math.atan2(Math.sin(toCentre - h.ry), Math.cos(toCentre - h.ry)))).toBeLessThan(0.01);
    }
  });

  it('collectibles are on land', () => {
    for (const c of placeCollectibles(t)) expect(t.isLandAt(c.x, c.z)).toBe(true);
  });
});
