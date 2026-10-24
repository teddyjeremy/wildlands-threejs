import { describe, it, expect } from 'vitest';
import { TrailGrid } from '../src/simulation/trailGrid.js';
import { WeatherSim } from '../src/simulation/weather.js';
import { WildlifeBrain } from '../src/simulation/wildlifeBrain.js';
import { createRandom } from '../src/procedural/random.js';
import { CollisionWorld } from '../src/player/collision.js';

describe('trail grid', () => {
  const walk = (g, from, to, steps = 40) => {
    for (let i = 0; i <= steps; i++) g.step(from + ((to - from) * i) / steps, 0);
  };

  it('walking on grass leaves a trail, standing still does not add more', () => {
    const g = new TrailGrid({ size: 40, cellSize: 0.5, surfaceAt: () => 'grass' });
    walk(g, -10, 10);
    const v = g.valueAt(0, 0);
    expect(v).toBeGreaterThan(0.1);
    for (let i = 0; i < 100; i++) g.step(10, 0);
    expect(g.valueAt(0, 0)).toBe(v);
    expect(g.valueAt(0, 5)).toBe(0); // off the path
  });

  it('rock shows no deformation and sand less than grass', () => {
    const surf = (x) => (x < -5 ? 'rock' : x < 5 ? 'sand' : 'grass');
    const g = new TrailGrid({ size: 40, cellSize: 0.5, surfaceAt: surf });
    walk(g, -15, 15, 120);
    expect(g.valueAt(-10, 0)).toBe(0);
    expect(g.valueAt(0, 0)).toBeGreaterThan(0);
    expect(g.valueAt(10, 0)).toBeGreaterThan(g.valueAt(0, 0));
  });

  it('abandoned trails recover and memory stays bounded', () => {
    const g = new TrailGrid({ size: 40, cellSize: 0.5, surfaceAt: () => 'grass', budget: 50 });
    for (let lap = 0; lap < 5; lap++) {
      walk(g, -10, 10);
      walk(g, 10, -10);
    }
    const before = g.valueAt(0, 0);
    const active = g.activeCount;
    expect(active).toBeLessThan(g.res * g.res);
    for (let i = 0; i < 60 * 60; i++) g.update(1 / 60); // one minute
    expect(g.valueAt(0, 0)).toBeLessThan(before);
    for (let i = 0; i < 60 * 120; i++) g.update(1 / 60);
    expect(g.valueAt(0, 0)).toBe(0);
    expect(g.activeCount).toBe(0);
  });

  it('per-frame work is capped by the budget', () => {
    const g = new TrailGrid({ size: 40, cellSize: 0.25, surfaceAt: () => 'grass', budget: 30 });
    walk(g, -15, 15, 200);
    expect(g.activeCount).toBeGreaterThan(30);
    expect(g.update(1 / 60)).toBe(30);
  });

  it('teleports do not draw a line across the map', () => {
    const g = new TrailGrid({ size: 40, cellSize: 0.5, surfaceAt: () => 'grass' });
    g.step(-15, 0);
    g.step(15, 0);
    expect(g.activeCount).toBe(0);
  });

  it('serialises and restores', () => {
    const g = new TrailGrid({ size: 40, cellSize: 0.5, surfaceAt: () => 'grass' });
    walk(g, -10, 10);
    const snap = g.serialize();
    const h = new TrailGrid({ size: 40, cellSize: 0.5, surfaceAt: () => 'grass' });
    expect(h.deserialize(snap)).toBe(true);
    expect(h.valueAt(0, 0)).toBeCloseTo(g.valueAt(0, 0), 1);
    expect(h.deserialize({ res: 1, cellSize: 0.5, data: '' })).toBe(false);
  });
});

describe('weather', () => {
  const run = (w, seconds, dt = 1 / 30) => {
    for (let t = 0; t < seconds; t += dt) w.update(dt);
  };

  it('rain raises runoff and pools, which recede after it stops', () => {
    const w = new WeatherSim('test', { auto: false });
    expect(w.runoff).toBe(0);
    w.setState('rain');
    run(w, 40);
    expect(w.rain).toBeGreaterThan(0.8);
    expect(w.runoff).toBeGreaterThan(0.6);
    expect(w.pool).toBeGreaterThan(0.3);
    expect(w.wetness).toBeGreaterThan(0.5);
    const peakPool = w.pool;
    w.setState('clear');
    run(w, 30);
    expect(w.rain).toBeLessThan(0.05);
    expect(w.pool).toBeLessThan(peakPool);
    run(w, 400);
    expect(w.pool).toBeLessThan(0.02);
    expect(w.wetness).toBe(0);
  });

  it('is deterministic and frame-rate independent enough', () => {
    const a = new WeatherSim('s');
    const b = new WeatherSim('s');
    run(a, 300, 1 / 30);
    run(b, 300, 1 / 30);
    expect(a.snapshot()).toEqual(b.snapshot());
    const c = new WeatherSim('x', { auto: false });
    const d = new WeatherSim('x', { auto: false });
    c.setState('rain');
    d.setState('rain');
    run(c, 30, 1 / 120);
    run(d, 30, 1 / 20);
    expect(Math.abs(c.rain - d.rain)).toBeLessThan(0.05);
  });

  it('auto mode cycles through states', () => {
    const w = new WeatherSim('cycle');
    const seen = new Set();
    for (let t = 0; t < 1500; t += 0.5) {
      w.update(0.5);
      seen.add(w.state);
    }
    expect(seen).toEqual(new Set(['clear', 'cloudy', 'rain']));
  });
});

describe('wildlife state machine', () => {
  const make = () => new WildlifeBrain({ home: { x: 0, z: 0 }, habitatRadius: 15, rng: createRandom('hare') });
  const tickFor = (b, self, player, seconds) => {
    for (let t = 0; t < seconds; t += 0.05) b.tick(0.05, self, player);
  };

  it('forages while the player is far away', () => {
    const b = make();
    tickFor(b, { x: 0, z: 0 }, { x: 60, z: 0 }, 10);
    expect(b.state).toBe('forage');
  });

  it('notices, then alerts, then flees as the player approaches', () => {
    const b = make();
    const self = { x: 0, z: 0 };
    tickFor(b, self, { x: 12, z: 0 }, 0.2);
    expect(b.state).toBe('notice');
    tickFor(b, self, { x: 12, z: 0 }, 1.0);
    expect(b.state).toBe('alert');
    b.tick(0.05, self, { x: 5, z: 0 });
    expect(b.state).toBe('flee');
    // Flee target points away from the player and stays in the habitat.
    expect(b.target.x).toBeLessThan(self.x);
    expect(Math.hypot(b.target.x, b.target.z)).toBeLessThanOrEqual(15 + 1e-6);
  });

  it('running is heard from further away', () => {
    const walkB = make();
    const runB = make();
    walkB.tick(0.05, { x: 0, z: 0 }, { x: 18, z: 0, running: false });
    runB.tick(0.05, { x: 0, z: 0 }, { x: 18, z: 0, running: true });
    expect(walkB.state).toBe('forage');
    expect(runB.state).toBe('notice');
  });

  it('returns home and resumes foraging once things are quiet', () => {
    const b = make();
    const self = { x: 0, z: 0 };
    b.tick(0.05, self, { x: 3, z: 0 });
    expect(b.state).toBe('flee');
    // Simulate having fled to the edge of the habitat.
    self.x = -12;
    tickFor(b, self, { x: 40, z: 0 }, 3);
    expect(['alert', 'return']).toContain(b.state);
    tickFor(b, self, { x: 60, z: 0 }, 6);
    expect(b.state).toBe('return');
    expect(b.target).toEqual({ x: 0, z: 0 });
    self.x = 0.5;
    b.tick(0.05, self, { x: 60, z: 0 });
    expect(b.state).toBe('forage');
  });

  it('gives the same decisions at different tick rates', () => {
    const run = (dt) => {
      const b = make();
      const self = { x: 0, z: 0 };
      const log = [];
      for (let t = 0; t < 6; t += dt) {
        const px = 30 - t * 4; // player walks in from 30 m
        b.tick(dt, self, { x: px, z: 0 });
        log.push([Math.round(t * 10) / 10, b.state]);
      }
      return b.state;
    };
    expect(run(1 / 20)).toBe(run(1 / 60));
  });
});

describe('collision world', () => {
  it('pushes circles out of circles and rotated boxes', () => {
    const c = new CollisionWorld(4);
    c.add({ type: 'circle', x: 0, z: 0, r: 1 });
    c.add({ type: 'box', x: 10, z: 0, hw: 2, hd: 1, ry: Math.PI / 4 });
    const p = { x: 0.5, z: 0 };
    expect(c.resolve(p, 0.4)).toBe(true);
    expect(Math.hypot(p.x, p.z)).toBeCloseTo(1.4, 5);
    const q = { x: 10, z: 0.1 };
    c.resolve(q, 0.4);
    expect(c.blocked(q.x, q.z, 0.39)).toBe(false);
    expect(c.blocked(20, 20, 0.4)).toBe(false);
  });

  it('decks report height only inside their footprint', () => {
    const c = new CollisionWorld();
    c.addDeck({ x: 0, z: 0, hw: 1, hd: 5, y: 2 });
    expect(c.deckHeightAt(0, 4, 2)).toBe(2);
    expect(c.deckHeightAt(3, 0, 2)).toBe(-Infinity);
    expect(c.deckHeightAt(0, 0, -5)).toBe(-Infinity); // far below: walk under it
  });
});
