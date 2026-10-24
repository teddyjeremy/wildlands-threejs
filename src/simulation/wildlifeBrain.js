// Finite-state machine for a small, shy animal.
//
// The brain is pure logic: it receives distances and noise levels and
// decides a state and a target point. Movement/steering lives elsewhere.
// It runs on a fixed tick (see Wildlife) so behaviour is identical at any
// frame rate.
//
//  forage --(player within notice range)--> notice
//  notice --(still close after a beat)----> alert   | --(player left)--> forage
//  alert  --(player within flee range)-----> flee   | --(player left, cooldown)--> forage
//  flee   --(far enough / fled long enough)-> return
//  return --(reached home)------------------> forage | --(player close again)--> flee

export const STATES = ['forage', 'notice', 'alert', 'flee', 'return'];

export const DEFAULT_TUNING = {
  noticeRange: 14,
  fleeRange: 7,
  calmRange: 22, // player must be this far for things to settle
  noticeTime: 0.8,
  alertMin: 1.2,
  fleeMinTime: 2.5,
  fleeMaxTime: 7,
  quietTime: 4, // time the player must stay far/quiet before returning
  runningNoiseScale: 1.6, // running makes you easier to hear
};

export class WildlifeBrain {
  constructor({ home, habitatRadius = 18, rng, tuning = {} }) {
    this.home = { x: home.x, z: home.z };
    this.habitatRadius = habitatRadius;
    this.rng = rng;
    this.t = { ...DEFAULT_TUNING, ...tuning };
    this.state = 'forage';
    this.stateTime = 0;
    this.quiet = 0;
    this.target = { x: home.x, z: home.z };
    this.transitions = 0;
    this._pickForageTarget();
  }

  _set(state) {
    if (state !== this.state) {
      this.state = state;
      this.stateTime = 0;
      this.transitions++;
    }
  }

  _pickForageTarget() {
    const a = this.rng.range(0, Math.PI * 2);
    const r = this.rng.range(0, this.habitatRadius * 0.6);
    this.target.x = this.home.x + Math.cos(a) * r;
    this.target.z = this.home.z + Math.sin(a) * r;
    this.forageWait = this.rng.range(1.5, 4);
  }

  /** Clamp a point to the habitat disc. */
  clampToHabitat(p) {
    const dx = p.x - this.home.x;
    const dz = p.z - this.home.z;
    const d = Math.hypot(dx, dz);
    const max = this.habitatRadius;
    if (d > max) {
      p.x = this.home.x + (dx / d) * max;
      p.z = this.home.z + (dz / d) * max;
    }
    return p;
  }

  /**
   * @param {number} dt fixed tick
   * @param {{x,z}} self animal position
   * @param {{x,z,running:boolean,visible:boolean}} player
   */
  tick(dt, self, player) {
    const t = this.t;
    this.stateTime += dt;
    const dist = Math.hypot(player.x - self.x, player.z - self.z);
    const noise = player.running ? t.runningNoiseScale : 1;
    const heard = player.visible !== false && dist < t.noticeRange * noise;
    const close = dist < t.fleeRange * noise;
    if (dist > t.calmRange || !heard) this.quiet += dt;
    else this.quiet = 0;

    switch (this.state) {
      case 'forage': {
        if (close) this._set('flee');
        else if (heard) this._set('notice');
        else if (Math.hypot(self.x - this.target.x, self.z - this.target.z) < 0.6) {
          this.forageWait -= dt;
          if (this.forageWait <= 0) this._pickForageTarget();
        }
        break;
      }
      case 'notice':
        if (close) this._set('flee');
        else if (!heard && this.stateTime > t.noticeTime) this._set('forage');
        else if (this.stateTime > t.noticeTime) this._set('alert');
        break;
      case 'alert':
        if (close) this._set('flee');
        else if (this.quiet > t.quietTime && this.stateTime > t.alertMin) {
          // Settle down: walk home first if the chase pushed us away from it.
          const away = Math.hypot(self.x - this.home.x, self.z - this.home.z) > 4;
          this._set(away ? 'return' : 'forage');
          if (!away) this._pickForageTarget();
        }
        break;
      case 'flee': {
        // Run directly away from the player, but stay inside the habitat.
        const dx = self.x - player.x;
        const dz = self.z - player.z;
        const d = Math.hypot(dx, dz) || 1;
        this.target.x = self.x + (dx / d) * 8;
        this.target.z = self.z + (dz / d) * 8;
        this.clampToHabitat(this.target);
        const longEnough = this.stateTime > t.fleeMinTime;
        if ((longEnough && dist > t.noticeRange * noise) || this.stateTime > t.fleeMaxTime) {
          this._set('alert');
          this.quiet = 0;
        }
        break;
      }
      case 'return':
        if (close) this._set('flee');
        else if (Math.hypot(self.x - this.home.x, self.z - this.home.z) < 2) {
          this._set('forage');
          this._pickForageTarget();
        }
        break;
      default:
        this._set('forage');
    }

    if (this.state === 'return') {
      this.target.x = this.home.x;
      this.target.z = this.home.z;
    }
    return this.state;
  }

  /** Desired movement speed for the current state (m/s). */
  speed() {
    switch (this.state) {
      case 'flee': return 6.5;
      case 'return': return 2.2;
      case 'forage': return 1.0;
      default: return 0;
    }
  }
}
