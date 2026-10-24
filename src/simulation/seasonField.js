// The lantern's season field.
//
// Around the lantern, the world is pushed into the lantern's season. The
// field is a disc with a soft edge; the same weight function drives the
// shaders (via uniforms) and the gameplay checks, so what you see is what the
// puzzles respond to. Switching season fades the old one out and the new one
// in rather than popping.

import { smoothstep } from '../procedural/math.js';

export const FIELD_SEASONS = ['spring', 'winter', 'autumn', 'storm'];

export class SeasonField {
  constructor({ radius = 8.5 } = {}) {
    this.maxRadius = radius;
    this.radius = 0;
    this.season = null; // selected season
    this.intensity = 0; // 0..1, fades on switch
    this.lit = false;
    this.x = 0;
    this.z = 0;
    this.y = 0;
    this._pending = null;
  }

  /** Select a season (or null to dim the lantern). */
  select(season) {
    if (season !== null && !FIELD_SEASONS.includes(season)) throw new Error(`unknown season ${season}`);
    if (season === this.season && this.lit) return;
    if (this.season === null || this.intensity < 0.05) {
      this.season = season;
      this._pending = null;
    } else {
      this._pending = season; // fade the current one out first
    }
    this.lit = season !== null;
  }

  setPosition(x, y, z) {
    this.x = x;
    this.y = y;
    this.z = z;
  }

  update(dt) {
    if (this._pending !== null && this.intensity < 0.05) {
      this.season = this._pending;
      this._pending = null;
    }
    const target = this.lit && this._pending === null ? 1 : 0;
    const rate = target > this.intensity ? 2.2 : 4;
    this.intensity += Math.sign(target - this.intensity) * Math.min(Math.abs(target - this.intensity), rate * dt);
    // The disc breathes open when lit and contracts when dimmed.
    const rTarget = this.maxRadius * (target ? 1 : 0.4);
    this.radius += (rTarget - this.radius) * Math.min(1, dt * 3);
    if (!this.lit && this.intensity === 0) this.season = null;
  }

  /** Strength of the field at (x,z): 0 outside, up to 1 near the lantern. */
  weightAt(x, z) {
    if (!this.season || this.intensity <= 0) return 0;
    const d = Math.hypot(x - this.x, z - this.z);
    return this.intensity * (1 - smoothstep(this.radius * 0.65, this.radius, d));
  }

  /** Weight of a specific season at (x,z). */
  seasonWeight(season, x, z) {
    return this.season === season ? this.weightAt(x, z) : 0;
  }

  snapshot() {
    return { season: this.season, intensity: this.intensity, radius: this.radius, lit: this.lit };
  }
}
