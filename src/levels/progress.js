import { LEVELS, SEASON_INFO } from './levels.js';

// Archipelago progression: which islands are open, what has been done on
// each, and the objective list shown in the HUD. Plain data so it can live
// in the save file and be tested without a browser.

export class Progression {
  constructor(data = null) {
    this.unlocked = new Set([0]);
    this.completed = new Set();
    this.embers = new Set(); // level indices whose ember was found
    this.lantern = false;
    this.puzzles = {}; // levelIndex -> solved puzzle ids
    this.reachedShrine = new Set();
    if (data) this.load(data);
  }

  load(d) {
    const ints = (a) => (Array.isArray(a) ? a.filter((n) => Number.isInteger(n) && n >= 0 && n < LEVELS.length) : []);
    this.unlocked = new Set([0, ...ints(d.unlocked)]);
    this.completed = new Set(ints(d.completed));
    this.embers = new Set(ints(d.embers));
    this.reachedShrine = new Set(ints(d.reachedShrine));
    this.lantern = d.lantern === true;
    this.puzzles = {};
    if (d.puzzles && typeof d.puzzles === 'object') {
      for (const [k, v] of Object.entries(d.puzzles)) {
        const i = Number(k);
        if (Number.isInteger(i) && i >= 0 && i < LEVELS.length && Array.isArray(v)) this.puzzles[i] = v.filter((s) => typeof s === 'string');
      }
    }
    // Completing a level always unlocks the next, even in a hand-edited save.
    for (const c of this.completed) if (c + 1 < LEVELS.length) this.unlocked.add(c + 1);
  }

  toJSON() {
    return {
      unlocked: [...this.unlocked],
      completed: [...this.completed],
      embers: [...this.embers],
      reachedShrine: [...this.reachedShrine],
      lantern: this.lantern,
      puzzles: this.puzzles,
    };
  }

  isUnlocked(i) {
    return this.unlocked.has(i);
  }

  /** Seasons the lantern can produce on level i. */
  seasons(i) {
    const out = [];
    LEVELS.forEach((l, k) => {
      if (l.season && (k < i ? this.completed.has(k) || this.embers.has(k) : k === i && this.embers.has(k))) out.push(l.season);
    });
    return out;
  }

  findEmber(i) {
    this.embers.add(i);
  }

  setPuzzles(i, ids) {
    this.puzzles[i] = [...ids];
  }

  complete(i) {
    this.completed.add(i);
    if (i + 1 < LEVELS.length) this.unlocked.add(i + 1);
  }

  get finished() {
    return this.completed.has(LEVELS.length - 1);
  }

  /** Objective list for the HUD. */
  objectives(i, { crossed = false } = {}) {
    const L = LEVELS[i];
    const list = [];
    if (i === 0) list.push({ id: 'lantern', text: 'Pick up the lantern on the dock', done: this.lantern });
    if (L.season) {
      const info = SEASON_INFO[L.season];
      list.push({ id: 'ember', text: `Find the ${info.label} ember - ${L.emberHint.toLowerCase()}`, done: this.embers.has(i) });
    }
    const solved = new Set(this.puzzles[i] || []);
    const types = L.segments.filter((t) => t !== 'ice');
    const label = { vine: 'Grow the vine bridge (Spring)', hedge: 'Strip the thornwall (Autumn)', drawbridge: 'Spin up the windmill to lower the drawbridge (Storm)' };
    types.forEach((t, k) => {
      const idx = L.segments.indexOf(t, k === 0 ? 0 : L.segments.indexOf(types[k - 1]) + 1);
      list.push({ id: `seg-${idx}`, text: label[t], done: solved.has(`${L.id}-seg-${idx}`) });
    });
    if (L.segments.includes('ice')) list.push({ id: 'ice', text: 'Freeze the lagoon and walk across (Winter)', done: crossed || this.reachedShrine.has(i) });
    list.push({ id: 'shrine', text: `Awaken the shrine of ${L.name}`, done: this.completed.has(i) });
    return list;
  }
}
