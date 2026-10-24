// Crossing puzzles as small state machines, independent of rendering.
// Each element reads the season field at its anchor and latches once
// complete, so a grown bridge stays grown even after you walk away.

const GROW_TIME = { vine: 2.4, hedge: 1.6, drawbridge: 3.5 };

export class PuzzleElement {
  /**
   * @param {object} seg {id, type, a, b}
   * @param {boolean} solved restored from a save
   */
  constructor(seg, solved = false) {
    this.id = seg.id;
    this.type = seg.type;
    this.seg = seg;
    this.progress = solved ? 1 : 0;
    this.solved = solved || seg.type === 'ice'; // ice is solved moment-to-moment by frost
    this.justSolved = false;
    // Where the lantern has to be: hedge and vine at the shore end, the windmill beside it.
    const a = seg.a;
    const b = seg.b;
    if (seg.anchor) {
      this.anchor = { x: seg.anchor.x, z: seg.anchor.z };
    } else if (seg.type === 'drawbridge') {
      const nx = -(b.z - a.z);
      const nz = b.x - a.x;
      const len = Math.hypot(nx, nz) || 1;
      this.anchor = { x: a.x + (nx / len) * 5 - ((b.x - a.x) / len) * 2, z: a.z + (nz / len) * 5 - ((b.z - a.z) / len) * 2 };
    } else if (seg.type === 'vine') {
      this.anchor = { x: a.x + (b.x - a.x) * 0.15, z: a.z + (b.z - a.z) * 0.15 };
    } else {
      this.anchor = { x: a.x, z: a.z };
    }
    this.season = { vine: 'spring', hedge: 'autumn', drawbridge: 'storm', ice: 'winter' }[seg.type];
    this.activity = 0; // 0..1 how strongly the field is acting on it right now (for visuals/audio)
  }

  update(dt, field) {
    this.justSolved = false;
    const w = field.seasonWeight(this.season, this.anchor.x, this.anchor.z);
    this.activity = w;
    if (this.solved || this.type === 'ice') return;
    const t = GROW_TIME[this.type];
    if (w > 0.4) this.progress = Math.min(1, this.progress + (dt / t) * w);
    else if (this.type === 'drawbridge') this.progress = Math.max(0, this.progress - dt * 0.08); // windmill spins down
    else this.progress = Math.max(0, this.progress - dt * 0.25); // half-grown vines wilt back
    if (this.progress >= 1) {
      this.solved = true;
      this.justSolved = true;
    }
  }
}

export class PuzzleSet {
  constructor(segments, solvedIds = []) {
    const solved = new Set(solvedIds);
    this.elements = segments.map((s) => new PuzzleElement(s, solved.has(s.id)));
  }

  update(dt, field) {
    const events = [];
    for (const e of this.elements) {
      e.update(dt, field);
      if (e.justSolved) events.push(e);
    }
    return events;
  }

  solvedIds() {
    return this.elements.filter((e) => e.solved && e.type !== 'ice').map((e) => e.id);
  }

  get(id) {
    return this.elements.find((e) => e.id === id);
  }
}
