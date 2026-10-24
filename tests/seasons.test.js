import { describe, it, expect } from 'vitest';
import { SeasonField } from '../src/simulation/seasonField.js';
import { PuzzleSet } from '../src/simulation/puzzles.js';
import { TrailGrid } from '../src/simulation/trailGrid.js';

const run = (f, secs, step = 1 / 30) => {
  for (let t = 0; t < secs; t += step) f.update(step);
};

describe('season field', () => {
  it('is zero when unlit and fades in when a season is chosen', () => {
    const f = new SeasonField({ radius: 8 });
    expect(f.weightAt(0, 0)).toBe(0);
    f.select('spring');
    f.update(0.05);
    expect(f.weightAt(0, 0)).toBeGreaterThan(0);
    expect(f.weightAt(0, 0)).toBeLessThan(1);
    run(f, 2);
    expect(f.weightAt(0, 0)).toBeCloseTo(1, 3);
  });

  it('falls off smoothly towards the edge of the disc', () => {
    const f = new SeasonField({ radius: 8 });
    f.select('winter');
    run(f, 3);
    const a = f.weightAt(3, 0);
    const b = f.weightAt(7, 0);
    expect(a).toBeGreaterThan(b);
    expect(b).toBeGreaterThan(0);
    expect(f.weightAt(9, 0)).toBe(0);
  });

  it('follows the lantern', () => {
    const f = new SeasonField({ radius: 8 });
    f.select('autumn');
    run(f, 2);
    f.setPosition(40, 0, 40);
    expect(f.weightAt(0, 0)).toBe(0);
    expect(f.weightAt(40, 40)).toBeCloseTo(1, 3);
  });

  it('cross-fades instead of popping between seasons', () => {
    const f = new SeasonField({ radius: 8 });
    f.select('spring');
    run(f, 2);
    f.select('storm');
    f.update(1 / 30);
    expect(f.season).toBe('spring'); // still fading the old one out
    expect(f.seasonWeight('storm', 0, 0)).toBe(0);
    run(f, 2);
    expect(f.season).toBe('storm');
    expect(f.seasonWeight('storm', 0, 0)).toBeCloseTo(1, 3);
    expect(f.seasonWeight('spring', 0, 0)).toBe(0);
  });

  it('rejects unknown seasons', () => {
    expect(() => new SeasonField().select('monsoon')).toThrow();
  });
});

const seg = (type, id = type) => ({ id, type, a: { x: 0, z: 0, y: 1 }, b: { x: 12, z: 0, y: 1 } });

describe('puzzle state', () => {
  it('grows a vine bridge only under spring and latches it', () => {
    const f = new SeasonField({ radius: 8 });
    const p = new PuzzleSet([seg('vine')]);
    f.select('winter');
    for (let i = 0; i < 200; i++) { f.update(1 / 30); p.update(1 / 30, f); }
    expect(p.elements[0].solved).toBe(false);
    f.select('spring');
    let events = [];
    for (let i = 0; i < 300; i++) { f.update(1 / 30); events = events.concat(p.update(1 / 30, f)); }
    expect(p.elements[0].solved).toBe(true);
    expect(events.length).toBe(1);
    // Walk away: stays grown.
    f.setPosition(100, 0, 100);
    for (let i = 0; i < 300; i++) { f.update(1 / 30); p.update(1 / 30, f); }
    expect(p.elements[0].solved).toBe(true);
  });

  it('half-grown vines wilt back if the lantern leaves', () => {
    const f = new SeasonField({ radius: 8 });
    const p = new PuzzleSet([seg('vine')]);
    f.select('spring');
    for (let i = 0; i < 45; i++) { f.update(1 / 30); p.update(1 / 30, f); }
    const mid = p.elements[0].progress;
    expect(mid).toBeGreaterThan(0);
    f.setPosition(100, 0, 100);
    for (let i = 0; i < 300; i++) { f.update(1 / 30); p.update(1 / 30, f); }
    expect(p.elements[0].progress).toBeLessThan(mid);
  });

  it('hedge answers autumn, drawbridge answers storm', () => {
    const f = new SeasonField({ radius: 10 });
    const p = new PuzzleSet([seg('hedge', 'h'), seg('drawbridge', 'd')]);
    f.select('autumn');
    for (let i = 0; i < 200; i++) { f.update(1 / 30); p.update(1 / 30, f); }
    expect(p.get('h').solved).toBe(true);
    expect(p.get('d').solved).toBe(false);
    f.select('storm');
    for (let i = 0; i < 400; i++) { f.update(1 / 30); p.update(1 / 30, f); }
    expect(p.get('d').solved).toBe(true);
    expect(p.solvedIds().sort()).toEqual(['d', 'h']);
  });

  it('restores solved state from a save', () => {
    const p = new PuzzleSet([seg('vine', 'v1'), seg('hedge', 'h1')], ['v1']);
    expect(p.get('v1').solved).toBe(true);
    expect(p.get('h1').solved).toBe(false);
  });
});

describe('frost grid', () => {
  it('stamps only freezable surfaces and melts over time', () => {
    const g = new TrailGrid({
      size: 40,
      cellSize: 1,
      surfaceAt: (x) => (x > 0 ? 'water' : 'rock'),
      response: { grass: { gain: 0, regrow: 1 }, path: { gain: 0, regrow: 1 }, sand: { gain: 0, regrow: 1 }, rock: { gain: 0, regrow: 1 }, water: { gain: 1, regrow: 1 / 10 } },
    });
    g.stampAt(0, 0, 4, 1);
    expect(g.valueAt(2, 0)).toBeCloseTo(1);
    expect(g.valueAt(-2, 0)).toBe(0);
    for (let i = 0; i < 60 * 5; i++) g.update(1 / 60);
    expect(g.valueAt(2, 0)).toBeGreaterThan(0.3);
    expect(g.valueAt(2, 0)).toBeLessThan(0.7);
    for (let i = 0; i < 60 * 6; i++) g.update(1 / 60);
    expect(g.valueAt(2, 0)).toBe(0);
  });
});

describe('spring lure', () => {
  it('draws a foraging hare towards a calm lantern instead of scaring it', async () => {
    const { WildlifeBrain } = await import('../src/simulation/wildlifeBrain.js');
    const { createRandom } = await import('../src/procedural/random.js');
    const b = new WildlifeBrain({ home: { x: 0, z: 0 }, habitatRadius: 20, rng: createRandom('lure') });
    const self = { x: 0, z: 0 };
    const player = { x: 6, z: 0, running: false, visible: true, lure: true };
    for (let i = 0; i < 40; i++) b.tick(0.05, self, player);
    expect(b.state).toBe('forage');
    expect(Math.hypot(b.target.x - player.x, b.target.z - player.z)).toBeCloseTo(2.2, 1);
    // Without the lure the same approach makes it wary.
    const c = new WildlifeBrain({ home: { x: 0, z: 0 }, habitatRadius: 20, rng: createRandom('lure') });
    for (let i = 0; i < 40; i++) c.tick(0.05, self, { ...player, lure: false });
    expect(c.state).not.toBe('forage');
  });
});
