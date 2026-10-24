// The island's memory of footsteps.
//
// A coarse grid of disturbance values (0 = untouched, 1 = flattened).
// Walking adds disturbance to the cells under the player's footprint,
// scaled by the surface type. Regrowth only touches cells that are
// actually disturbed (tracked in an active list), and is spread across
// frames with a fixed per-step budget, so cost never scales with the
// size of the island.

export const SURFACE_RESPONSE = {
  grass: { gain: 1.0, regrow: 1 / 90 }, // flattens strongly, recovers over ~1.5 min
  path: { gain: 0.25, regrow: 1 / 40 },
  sand: { gain: 0.55, regrow: 1 / 45 }, // subtle tracks that fill in
  rock: { gain: 0.0, regrow: 1 },
  water: { gain: 0.0, regrow: 1 },
};

export class TrailGrid {
  /**
   * @param {object} o size (world units), cellSize, surfaceAt(x,z) -> type
   */
  constructor({ size = 240, cellSize = 0.75, surfaceAt = () => 'grass', budget = 4000 } = {}) {
    this.size = size;
    this.cellSize = cellSize;
    this.res = Math.ceil(size / cellSize);
    this.half = size / 2;
    this.values = new Float32Array(this.res * this.res);
    this.surface = new Uint8Array(this.res * this.res); // index into SURFACE_KEYS, lazily filled
    this.surfaceKnown = new Uint8Array(this.res * this.res);
    this.surfaceAt = surfaceAt;
    this.active = new Int32Array(this.res * this.res); // dense list of disturbed cells
    this.activeFlag = new Uint8Array(this.res * this.res);
    this.activeCount = 0;
    this.sweep = 0;
    this.budget = budget;
    this.dirty = true;
    this.lastX = null;
    this.lastZ = null;
    this.regrowScale = 1;
  }

  static SURFACE_KEYS = ['grass', 'path', 'sand', 'rock', 'water'];

  index(x, z) {
    const i = Math.floor((x + this.half) / this.cellSize);
    const j = Math.floor((z + this.half) / this.cellSize);
    if (i < 0 || j < 0 || i >= this.res || j >= this.res) return -1;
    return j * this.res + i;
  }

  surfaceOf(idx) {
    if (!this.surfaceKnown[idx]) {
      const i = idx % this.res;
      const j = (idx / this.res) | 0;
      const x = -this.half + (i + 0.5) * this.cellSize;
      const z = -this.half + (j + 0.5) * this.cellSize;
      const key = this.surfaceAt(x, z);
      this.surface[idx] = Math.max(0, TrailGrid.SURFACE_KEYS.indexOf(key));
      this.surfaceKnown[idx] = 1;
    }
    return TrailGrid.SURFACE_KEYS[this.surface[idx]];
  }

  valueAt(x, z) {
    const idx = this.index(x, z);
    return idx < 0 ? 0 : this.values[idx];
  }

  _activate(idx) {
    if (!this.activeFlag[idx]) {
      this.activeFlag[idx] = 1;
      this.active[this.activeCount++] = idx;
    }
  }

  /**
   * Record movement from the last stamped position to (x,z).
   * Disturbance is proportional to distance travelled, so standing still adds
   * nothing and running doesn't double-stamp.
   */
  step(x, z, { radius = 0.55, weight = 1 } = {}) {
    if (this.lastX === null) {
      this.lastX = x;
      this.lastZ = z;
      return 0;
    }
    const dist = Math.hypot(x - this.lastX, z - this.lastZ);
    if (dist < 0.15) return 0; // haven't moved enough to stamp
    this.lastX = x;
    this.lastZ = z;
    if (dist > 5) return 0; // teleport / respawn: don't draw a line across the map
    const amount = Math.min(1, dist) * 0.55 * weight;
    const r = Math.ceil(radius / this.cellSize);
    const ci = Math.floor((x + this.half) / this.cellSize);
    const cj = Math.floor((z + this.half) / this.cellSize);
    let touched = 0;
    for (let dj = -r; dj <= r; dj++) {
      for (let di = -r; di <= r; di++) {
        const i = ci + di;
        const j = cj + dj;
        if (i < 0 || j < 0 || i >= this.res || j >= this.res) continue;
        const d = Math.hypot(di, dj) * this.cellSize;
        if (d > radius + this.cellSize * 0.5) continue;
        const idx = j * this.res + i;
        const resp = SURFACE_RESPONSE[this.surfaceOf(idx)];
        if (!resp.gain) continue;
        const falloff = 1 - Math.min(1, d / (radius + this.cellSize));
        const v = this.values[idx] + amount * resp.gain * (0.4 + 0.6 * falloff);
        this.values[idx] = v > 1 ? 1 : v;
        this._activate(idx);
        touched++;
      }
    }
    if (touched) this.dirty = true;
    return touched;
  }

  /**
   * Regrow disturbed cells. Processes at most `budget` cells per call in a
   * round-robin over the active list; each cell receives the elapsed time
   * since it was last visited, so recovery speed doesn't depend on budget.
   */
  update(dt) {
    if (!this.activeCount) return 0;
    this._elapsed = (this._elapsed || 0) + dt;
    const n = Math.min(this.budget, this.activeCount);
    // A full sweep over the list takes ceil(active/budget) calls; scale the
    // per-visit decay by that so long lists still regrow at the right rate.
    const sweeps = Math.ceil(this.activeCount / this.budget);
    const step = dt * sweeps * this.regrowScale;
    let processed = 0;
    for (let k = 0; k < n && this.activeCount; k++) {
      if (this.sweep >= this.activeCount) this.sweep = 0;
      const idx = this.active[this.sweep];
      const resp = SURFACE_RESPONSE[this.surfaceOf(idx)];
      const v = this.values[idx] - resp.regrow * step;
      if (v <= 0.002) {
        this.values[idx] = 0;
        this.activeFlag[idx] = 0;
        // swap-remove
        this.active[this.sweep] = this.active[--this.activeCount];
      } else {
        this.values[idx] = v;
        this.sweep++;
      }
      processed++;
    }
    this.dirty = true;
    return processed;
  }

  /** Compact RLE of quantised values for the save file. */
  serialize() {
    const q = [];
    let i = 0;
    const N = this.values.length;
    while (i < N) {
      if (this.values[i] < 0.02) {
        let run = 0;
        while (i < N && this.values[i] < 0.02) {
          run++;
          i++;
        }
        q.push(-run);
      } else {
        q.push(Math.round(this.values[i] * 99) + 1);
        i++;
      }
    }
    return { res: this.res, cellSize: this.cellSize, data: q.join(',') };
  }

  deserialize(obj) {
    if (!obj || obj.res !== this.res || obj.cellSize !== this.cellSize || typeof obj.data !== 'string') return false;
    this.values.fill(0);
    this.activeFlag.fill(0);
    this.activeCount = 0;
    let i = 0;
    for (const tok of obj.data.split(',')) {
      const n = Number(tok);
      if (!Number.isFinite(n)) return false;
      if (n < 0) i += -n;
      else if (i < this.values.length) {
        this.values[i] = (n - 1) / 99;
        this._activate(i);
        i++;
      }
    }
    this.dirty = true;
    return true;
  }

  clear() {
    this.values.fill(0);
    this.activeFlag.fill(0);
    this.activeCount = 0;
    this.dirty = true;
  }
}
