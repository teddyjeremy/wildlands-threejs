import { buildExplorer, animateExplorer } from './model.js';

// Character controller.
//
// Runs on the game's fixed simulation step. Horizontal movement is relative
// to the camera yaw; vertical motion (gravity, jumping, landing) is handled
// separately from ground snapping, so the character is never glued to the
// terrain while airborne. Collision uses a circle proxy against the
// CollisionWorld, plus slope limits and a no-deep-water rule.

const WALK = 4.2;
const RUN = 7.8;
const ACCEL = 14;
const AIR_CONTROL = 0.35;
const GRAVITY = 24;
const JUMP_V = 8.2;
const RADIUS = 0.4;
const MAX_SLOPE = 0.42; // 1 - normal.y; steeper than this pushes you back
const STEP_UP = 0.45;

export class Player {
  constructor({ scene, terrain, collisions }) {
    this.terrain = terrain;
    this.collisions = collisions;
    this.rig = buildExplorer();
    scene.add(this.rig.root);
    this.pos = { x: 0, y: 0, z: 0 };
    this.prev = { x: 0, y: 0, z: 0 };
    this.vel = { x: 0, y: 0, z: 0 };
    this.heading = 0;
    this.grounded = true;
    this.state = 'idle';
    this.phase = 0;
    this.interactTimer = 0;
    this.surface = 'grass';
    this.onDeck = false;
    this.stepDistance = 0;
    this.onStep = null; // callback(surface)
    this.onLand = null;
    this.onJump = null;
    this._normal = { x: 0, y: 1, z: 0 };
    this.extraSurface = null; // optional (x,z) -> height, e.g. lagoon ice
    this.onIce = false;
  }

  spawn(x, z, heading = 0, y = null) {
    const g = this.groundHeight(x, z, Infinity);
    this.pos.x = x;
    this.pos.z = z;
    this.pos.y = y !== null && y > g ? y : g;
    this.prev.x = x;
    this.prev.y = this.pos.y;
    this.prev.z = z;
    this.vel.x = this.vel.y = this.vel.z = 0;
    this.heading = heading;
    this.grounded = true;
  }

  /** Terrain or deck height, whichever is the floor under the feet. */
  groundHeight(x, z, y) {
    const t = this.terrain.heightAt(x, z);
    const d = this.collisions.deckHeightAt(x, z, y);
    const e = this.extraSurface ? this.extraSurface(x, z) : -Infinity;
    return Math.max(t, d, e);
  }

  /** Is (x,z) somewhere the player may stand (not deep sea, not a cliff)? */
  _walkable(x, z, fromX, fromZ, y) {
    const deck = this.collisions.deckHeightAt(x, z, y);
    if (deck > -Infinity) return true;
    if (this.extraSurface && this.extraSurface(x, z) > -Infinity && y > -1.0) return true; // wading up onto ice is fine
    const h = this.terrain.heightAt(x, z);
    if (h < this.terrain.seaLevel - 0.7) return false; // waist-deep: turn back
    const h0 = this.terrain.heightAt(fromX, fromZ);
    if (h - h0 > STEP_UP && this.terrain.slopeAt(x, z) > MAX_SLOPE) return false;
    return true;
  }

  /**
   * @param {number} dt fixed step
   * @param {{x:number,z:number,run:boolean,jump:boolean}} input  x/z in camera space (-1..1)
   * @param {number} camYaw
   */
  step(dt, input, camYaw) {
    this.prev.x = this.pos.x;
    this.prev.y = this.pos.y;
    this.prev.z = this.pos.z;
    if (this.interactTimer > 0) this.interactTimer -= dt;

    // Desired velocity on the ground plane, relative to camera yaw.
    let ix = input.x;
    let iz = input.z;
    const len = Math.hypot(ix, iz);
    if (len > 1) {
      ix /= len;
      iz /= len;
    }
    const sin = Math.sin(camYaw);
    const cos = Math.cos(camYaw);
    // Camera looks along -Z in its local frame; forward input is -z.
    const wx = ix * cos + iz * sin;
    const wz = -ix * sin + iz * cos;
    const speed = input.run ? RUN : WALK;
    const tx = wx * speed;
    const tz = wz * speed;
    const control = this.grounded ? 1 : AIR_CONTROL;
    const a = Math.min(1, ACCEL * control * dt);
    this.vel.x += (tx - this.vel.x) * a;
    this.vel.z += (tz - this.vel.z) * a;

    // Smoothly face the movement direction.
    const moving = Math.hypot(this.vel.x, this.vel.z);
    if (len > 0.1 && moving > 0.3) {
      const want = Math.atan2(this.vel.x, this.vel.z);
      const diff = Math.atan2(Math.sin(want - this.heading), Math.cos(want - this.heading));
      this.heading += diff * Math.min(1, dt * 10);
    }

    // Jump.
    if (input.jump && this.grounded) {
      this.vel.y = JUMP_V;
      this.grounded = false;
      this.onJump?.();
    }

    // Horizontal move with collision.
    const nx = this.pos.x + this.vel.x * dt;
    const nz = this.pos.z + this.vel.z * dt;
    if (this._walkable(nx, nz, this.pos.x, this.pos.z, this.pos.y)) {
      this.pos.x = nx;
      this.pos.z = nz;
    } else if (this._walkable(nx, this.pos.z, this.pos.x, this.pos.z, this.pos.y)) {
      this.pos.x = nx; // slide along the obstacle
      this.vel.z *= 0.5;
    } else if (this._walkable(this.pos.x, nz, this.pos.x, this.pos.z, this.pos.y)) {
      this.pos.z = nz;
      this.vel.x *= 0.5;
    } else {
      this.vel.x *= 0.2;
      this.vel.z *= 0.2;
    }
    this.collisions.resolve(this.pos, RADIUS, this.pos.y);
    // Island bounds as a last resort.
    const r = Math.hypot(this.pos.x, this.pos.z);
    const lim = (this.terrain.grid.size || 240) / 2 - 10;
    if (r > lim) {
      this.pos.x *= lim / r;
      this.pos.z *= lim / r;
    }

    // Vertical.
    const ground = this.groundHeight(this.pos.x, this.pos.z, this.pos.y);
    this.onDeck = this.collisions.deckHeightAt(this.pos.x, this.pos.z, this.pos.y) >= ground - 0.01 && this.collisions.deckHeightAt(this.pos.x, this.pos.z, this.pos.y) > -Infinity;
    if (this.grounded) {
      // Stick to the ground when walking down gentle slopes; fall off ledges.
      if (this.pos.y - ground > 0.6) {
        this.grounded = false;
        this.vel.y = 0;
      } else {
        this.pos.y = ground;
        this.vel.y = 0;
        // Steep slopes push you back down.
        const n = this.terrain.normalAt(this.pos.x, this.pos.z, this._normal);
        if (!this.onDeck && !this.onIce && 1 - n.y > MAX_SLOPE + 0.12) {
          this.vel.x += n.x * 18 * dt;
          this.vel.z += n.z * 18 * dt;
        }
      }
    }
    if (!this.grounded) {
      this.vel.y -= GRAVITY * dt;
      this.pos.y += this.vel.y * dt;
      if (this.pos.y <= ground) {
        this.pos.y = ground;
        const impact = -this.vel.y;
        this.vel.y = 0;
        this.grounded = true;
        this.onLand?.(impact);
      }
    }

    // Surface + footsteps.
    const ice = this.extraSurface ? this.extraSurface(this.pos.x, this.pos.z) : -Infinity;
    this.onIce = ice > -Infinity && Math.abs(this.pos.y - ice) < 0.05 && this.terrain.heightAt(this.pos.x, this.pos.z) < ice;
    this.surface = this.onDeck ? 'wood' : this.onIce ? 'rock' : this.terrain.groundTypeAt(this.pos.x, this.pos.z);
    if (this.pos.y < this.terrain.seaLevel + 0.05 && !this.onDeck && !this.onIce) this.surface = 'water';
    const horiz = Math.hypot(this.pos.x - this.prev.x, this.pos.z - this.prev.z);
    this.phase += horiz * 2.1;
    if (this.grounded) {
      this.stepDistance += horiz;
      const stride = input.run ? 1.35 : 0.95;
      if (this.stepDistance > stride) {
        this.stepDistance = 0;
        this.onStep?.(this.surface);
      }
    }

    // State machine (explicit transitions).
    const hs = Math.hypot(this.vel.x, this.vel.z);
    if (!this.grounded) this.state = this.vel.y > 0 ? 'jump' : 'fall';
    else if (this.interactTimer > 0) this.state = 'interact';
    else if (hs > 5.5) this.state = 'run';
    else if (hs > 0.4) this.state = 'walk';
    else this.state = 'idle';
  }

  get running() {
    return this.state === 'run';
  }

  interact() {
    this.interactTimer = 0.45;
  }

  /** Interpolate render transform between fixed steps. */
  render(alpha, dt, reducedMotion) {
    const r = this.rig.root;
    r.position.set(
      this.prev.x + (this.pos.x - this.prev.x) * alpha,
      this.prev.y + (this.pos.y - this.prev.y) * alpha,
      this.prev.z + (this.pos.z - this.prev.z) * alpha,
    );
    r.rotation.y = this.heading;
    animateExplorer(this.rig, this.state, this.phase, dt, reducedMotion);
  }
}
