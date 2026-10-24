import { createRandom } from '../procedural/random.js';

// Weather and surface water as a handful of smoothed scalars.
//
//   state      clear | cloudy | rain   (target)
//   cloud      0..1   eases towards the state's cloud cover
//   rain       0..1   rain intensity, lags behind cloud
//   runoff     0..1   how much water is flowing in the channels
//   pool       0..1   water level in the wetland pools (slow fill, slower drain)
//   wetness    0..1   ground darkening, dries over a couple of minutes
//
// Everything is deterministic for a given seed and sequence of dt values,
// which is what the tests rely on.

export const WEATHER_STATES = ['clear', 'cloudy', 'rain'];
const TARGETS = {
  clear: { cloud: 0.05, rain: 0 },
  cloudy: { cloud: 0.6, rain: 0 },
  rain: { cloud: 1, rain: 1 },
};

const approach = (v, target, rate, dt) => v + (target - v) * (1 - Math.exp(-rate * dt));

export class WeatherSim {
  constructor(seed = 'wildlands', { auto = true } = {}) {
    this.rng = createRandom(`${seed}:weather`);
    this.state = 'clear';
    this.auto = auto;
    this.timer = this._duration('clear');
    this.cloud = 0.05;
    this.rain = 0;
    this.runoff = 0;
    this.pool = 0;
    this.wetness = 0;
  }

  _duration(state) {
    if (state === 'rain') return this.rng.range(50, 80);
    if (state === 'cloudy') return this.rng.range(30, 50);
    return this.rng.range(90, 150);
  }

  /** Force a state (debug panel / tests). Auto-cycling resumes after it. */
  setState(state) {
    if (!TARGETS[state]) throw new Error(`unknown weather state ${state}`);
    this.state = state;
    this.timer = this._duration(state);
  }

  _advance() {
    // clear -> cloudy -> rain -> cloudy/clear ...
    if (this.state === 'clear') this.setState('cloudy');
    else if (this.state === 'cloudy') this.setState(this._lastWasRain ? 'clear' : 'rain');
    else this.setState(this.rng.chance(0.5) ? 'cloudy' : 'clear');
    this._lastWasRain = this.state === 'rain' ? true : this.state === 'clear' ? false : this._lastWasRain;
  }

  update(dt) {
    if (this.auto) {
      this.timer -= dt;
      if (this.timer <= 0) this._advance();
    }
    const t = TARGETS[this.state];
    this.cloud = approach(this.cloud, t.cloud, 0.35, dt);
    // Rain starts only once it's properly overcast.
    const rainTarget = t.rain * (this.cloud > 0.75 ? 1 : 0);
    this.rain = approach(this.rain, rainTarget, rainTarget > this.rain ? 0.5 : 0.8, dt);
    // Runoff responds quickly to rain but keeps flowing for a little while.
    this.runoff = approach(this.runoff, this.rain, this.rain > this.runoff ? 0.4 : 0.12, dt);
    // Pools fill from runoff and evaporate slowly.
    const fill = this.runoff * 0.05;
    const drain = (1 - this.runoff) * 0.012;
    this.pool = Math.max(0, Math.min(1, this.pool + (fill - drain * this.pool - drain * 0.2) * dt));
    // Ground wetness: soaks during rain, dries over ~2 minutes.
    this.wetness = this.rain > 0.05 ? approach(this.wetness, 1, 0.3 * this.rain, dt) : Math.max(0, this.wetness - dt / 120);
  }

  snapshot() {
    const { state, cloud, rain, runoff, pool, wetness } = this;
    return { state, cloud, rain, runoff, pool, wetness };
  }
}
