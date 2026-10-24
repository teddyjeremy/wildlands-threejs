import { describe, it, expect } from 'vitest';
import { LEVELS } from '../src/levels/levels.js';
import { planLevel } from '../src/levels/levelWorld.js';
import { Progression } from '../src/levels/progress.js';
import { validateSave, SAVE_VERSION } from '../src/systems/save.js';

describe('level layout', () => {
  it('has five islands, one per season plus the finale', () => {
    expect(LEVELS.length).toBe(5);
    expect(LEVELS.slice(0, 4).map((l) => l.season)).toEqual(['spring', 'winter', 'autumn', 'storm']);
    expect(new Set(LEVELS[4].segments)).toEqual(new Set(['vine', 'ice', 'hedge', 'drawbridge']));
  });

  for (let i = 0; i < LEVELS.length; i++) {
    it(`${LEVELS[i].id}: crossing spans real water and ends on a dry shrine islet`, () => {
      const p = planLevel(i);
      expect(p.terrain.isLandAt(p.nodes[0].x, p.nodes[0].z)).toBe(true);
      expect(p.terrain.isLandAt(p.shrine.x, p.shrine.z)).toBe(true);
      expect(p.terrain.regionAt(p.shrine.x, p.shrine.z)).toBe('shrine');
      for (const s of p.segments) {
        let min = Infinity;
        for (let k = 0; k <= 20; k++) min = Math.min(min, p.terrain.heightAt(s.a.x + ((s.b.x - s.a.x) * k) / 20, s.a.z + ((s.b.z - s.a.z) * k) / 20));
        expect(min).toBeLessThan(-1.5); // can't wade it
        expect(s.a.y).toBeGreaterThan(0);
        expect(s.b.y).toBeGreaterThan(0);
      }
    });
  }

  it('is deterministic', () => {
    const a = planLevel(1);
    const b = planLevel(1);
    expect(a.shrine).toEqual(b.shrine);
    expect(a.terrain.heightAt(5, 7)).toBe(b.terrain.heightAt(5, 7));
  });
});

describe('progression', () => {
  it('starts with only the first island open', () => {
    const p = new Progression();
    expect(p.isUnlocked(0)).toBe(true);
    expect(p.isUnlocked(1)).toBe(false);
    expect(p.seasons(0)).toEqual([]);
  });

  it('unlocks islands in order and accumulates seasons', () => {
    const p = new Progression();
    p.findEmber(0);
    expect(p.seasons(0)).toEqual(['spring']);
    p.complete(0);
    expect(p.isUnlocked(1)).toBe(true);
    expect(p.seasons(1)).toEqual(['spring']);
    p.findEmber(1);
    p.complete(1);
    p.findEmber(2);
    p.complete(2);
    p.findEmber(3);
    p.complete(3);
    expect(p.seasons(4)).toEqual(['spring', 'winter', 'autumn', 'storm']);
    p.complete(4);
    expect(p.finished).toBe(true);
  });

  it('round-trips through JSON and ignores junk', () => {
    const p = new Progression();
    p.lantern = true;
    p.findEmber(0);
    p.complete(0);
    p.setPuzzles(0, ['verdant-seg-0']);
    const q = new Progression(JSON.parse(JSON.stringify(p)));
    expect(q.toJSON()).toEqual(p.toJSON());
    const bad = new Progression({ unlocked: [99, -1, 'x'], completed: [2], puzzles: { 7: ['a'], 0: [1, 'ok'] } });
    expect(bad.isUnlocked(3)).toBe(true); // completed 2 implies 3 open
    expect(bad.isUnlocked(99)).toBe(false);
    expect(bad.puzzles).toEqual({ 0: ['ok'] });
  });

  it('builds objectives that tick off', () => {
    const p = new Progression();
    let o = p.objectives(0);
    expect(o.map((x) => x.id)).toEqual(['lantern', 'ember', 'seg-0', 'shrine']);
    expect(o.every((x) => !x.done)).toBe(true);
    p.lantern = true;
    p.findEmber(0);
    p.setPuzzles(0, ['verdant-seg-0']);
    o = p.objectives(0);
    expect(o.filter((x) => x.done).length).toBe(3);
    const fin = p.objectives(4).map((x) => x.id);
    expect(fin).toEqual(['seg-0', 'seg-1', 'seg-3', 'ice', 'shrine']);
  });

  it('save v3 keeps progression and migrates older saves', () => {
    const s = validateSave({ version: SAVE_VERSION, seed: 'x', worldKey: 'k', level: 2, progression: { completed: [0, 1] }, levels: { 0: { collected: ['a'] }, bogus: {} } }, 'k');
    expect(s.level).toBe(2);
    expect(new Progression(s.progression).isUnlocked(2)).toBe(true);
    expect(s.levels).toEqual({ 0: { discovered: [], collected: ['a'] } });
    const old = validateSave({ version: 2, seed: 'x', worldKey: 'k', discovered: ['summit'] }, 'k');
    expect(old.level).toBe(0);
    expect(old.progression).toBe(null);
  });
});

describe('windmills', () => {
  it('stand on dry, fairly flat ground', async () => {
    const { PuzzleSet } = await import('../src/simulation/puzzles.js');
    for (let i = 0; i < LEVELS.length; i++) {
      const p = planLevel(i);
      for (const e of new PuzzleSet(p.segments).elements) {
        if (e.type !== 'drawbridge') continue;
        expect(p.terrain.heightAt(e.anchor.x, e.anchor.z)).toBeGreaterThan(0.4);
        expect(p.terrain.slopeAt(e.anchor.x, e.anchor.z)).toBeLessThan(0.35);
      }
    }
  });
});
