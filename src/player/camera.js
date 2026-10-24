import * as THREE from 'three';

// Third-person follow camera.
// Yaw/pitch come from the mouse (pointer lock or drag), distance from the
// wheel. Each frame we raycast from the player's head towards the desired
// camera position and pull the camera in if something is in the way, then
// keep it above the terrain. Position is damped so it never snaps.

export class ThirdPersonCamera {
  constructor(camera, terrain) {
    this.camera = camera;
    this.terrain = terrain;
    this.yaw = Math.PI; // looking north from the cove
    this.pitch = 0.32;
    this.distance = 7.5;
    this.targetDistance = 7.5;
    this.minDistance = 2.5;
    this.maxDistance = 14;
    this.sensitivity = 1;
    this.invertY = false;
    this.obstacles = [];
    this.raycaster = new THREE.Raycaster();
    this.raycaster.firstHitOnly = true;
    this._head = new THREE.Vector3();
    this._dir = new THREE.Vector3();
    this._want = new THREE.Vector3();
    this.current = new THREE.Vector3();
    this.initialized = false;
    this.lookAhead = new THREE.Vector3();
    this.response = 1; // <1 while easing in from the title shot
  }

  rotate(dx, dy) {
    const s = 0.0024 * this.sensitivity;
    this.yaw -= dx * s;
    this.pitch += (this.invertY ? -dy : dy) * s;
    this.pitch = Math.max(-0.35, Math.min(1.25, this.pitch));
  }

  zoom(delta) {
    this.targetDistance = Math.max(this.minDistance, Math.min(this.maxDistance, this.targetDistance + delta * 0.01));
  }

  update(dt, target) {
    this._head.set(target.x, target.y + 1.6, target.z);
    this.distance += (this.targetDistance - this.distance) * Math.min(1, dt * 6);
    // Direction from head to camera.
    const cp = Math.cos(this.pitch);
    this._dir.set(Math.sin(this.yaw) * cp, Math.sin(this.pitch), Math.cos(this.yaw) * cp).normalize();
    let dist = this.distance;
    if (this.obstacles.length) {
      this.raycaster.set(this._head, this._dir);
      this.raycaster.far = dist + 0.3;
      const hits = this.raycaster.intersectObjects(this.obstacles, false);
      if (hits.length) dist = Math.max(0.8, hits[0].distance - 0.35);
    }
    this._want.copy(this._head).addScaledVector(this._dir, dist);
    // Keep the lens above the ground along the way.
    const ground = this.terrain.heightAt(this._want.x, this._want.z) + 0.5;
    if (this._want.y < ground) this._want.y = ground;
    if (!this.initialized) {
      this.current.copy(this._want);
      this.initialized = true;
    }
    // Damped follow; faster when pulled in so walls don't clip.
    this.response = Math.min(1, this.response + dt * 0.45);
    const rate = (dist < this.distance - 0.5 ? 20 : 9) * this.response * this.response;
    const k = 1 - Math.exp(-dt * Math.max(rate, 0.8));
    this.current.lerp(this._want, k);
    this.camera.position.copy(this.current);
    this.camera.lookAt(this._head);
  }

  snap() {
    this.initialized = false;
    this.response = 1;
  }

  /** Start from an arbitrary camera position and glide in. */
  easeFrom(position) {
    this.current.copy(position);
    this.initialized = true;
    this.response = 0.15;
  }
}
