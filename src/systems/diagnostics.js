import * as THREE from 'three';

// Developer diagnostics: frame timing, renderer counters and overlays.
// Enabled with ?debug=1 or the ` / F3 key. Hidden for normal players.

export class Diagnostics {
  constructor(renderer) {
    this.renderer = renderer;
    this.samples = new Float32Array(120);
    this.i = 0;
    this.filled = 0;
    this.last = performance.now();
  }

  frame() {
    const now = performance.now();
    const ms = now - this.last;
    this.last = now;
    this.samples[this.i] = ms;
    this.i = (this.i + 1) % this.samples.length;
    this.filled = Math.min(this.filled + 1, this.samples.length);
  }

  stats() {
    let sum = 0;
    let worst = 0;
    for (let k = 0; k < this.filled; k++) {
      sum += this.samples[k];
      worst = Math.max(worst, this.samples[k]);
    }
    const avg = this.filled ? sum / this.filled : 0;
    const info = this.renderer.info;
    return {
      fps: avg ? 1000 / avg : 0,
      avgMs: avg,
      worstMs: worst,
      calls: info.render.calls,
      triangles: info.render.triangles,
      geometries: info.memory.geometries,
      textures: info.memory.textures,
      programs: info.programs?.length ?? 0,
    };
  }
}

/** Rings + target markers that visualise each animal's brain. */
export function createWildlifeOverlay(scene, wildlife) {
  const group = new THREE.Group();
  group.visible = false;
  scene.add(group);
  const ringGeo = new THREE.RingGeometry(0.97, 1, 48);
  ringGeo.rotateX(-Math.PI / 2);
  const colors = { forage: '#6fdc6f', notice: '#ffe066', alert: '#ff9f40', flee: '#ff4d4d', return: '#66b3ff' };
  const items = wildlife.animals.map(() => {
    const notice = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: '#ffe066', transparent: true, opacity: 0.6, depthTest: false }));
    const flee = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: '#ff4d4d', transparent: true, opacity: 0.6, depthTest: false }));
    const target = new THREE.Mesh(new THREE.OctahedronGeometry(0.3), new THREE.MeshBasicMaterial({ color: '#ffffff', depthTest: false }));
    const habitat = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: '#66b3ff', transparent: true, opacity: 0.4, depthTest: false }));
    group.add(notice, flee, target, habitat);
    return { notice, flee, target, habitat };
  });
  return {
    group,
    update(terrain) {
      if (!group.visible) return;
      wildlife.animals.forEach((a, i) => {
        const it = items[i];
        const y = terrain.heightAt(a.pos.x, a.pos.z) + 0.15;
        it.notice.position.set(a.pos.x, y, a.pos.z);
        it.notice.scale.setScalar(a.brain.t.noticeRange);
        it.flee.position.set(a.pos.x, y, a.pos.z);
        it.flee.scale.setScalar(a.brain.t.fleeRange);
        it.target.position.set(a.brain.target.x, terrain.heightAt(a.brain.target.x, a.brain.target.z) + 0.6, a.brain.target.z);
        it.target.material.color.set(colors[a.brain.state]);
        const h = wildlife.habitat;
        it.habitat.position.set(h.x, terrain.heightAt(h.x, h.z) + 0.2, h.z);
        it.habitat.scale.setScalar(h.r);
      });
    },
  };
}

/** Coloured points at every generated placement (trees, rocks, houses, items). */
export function createPlacementOverlay(scene, data, collectibles) {
  const pts = [];
  const cols = [];
  const push = (x, y, z, c) => {
    pts.push(x, y + 0.5, z);
    const col = new THREE.Color(c);
    cols.push(col.r, col.g, col.b);
  };
  for (const t of data.trees) push(t.x, t.y, t.z, t.kind === 'pine' ? '#1f7a3a' : t.kind === 'birch' ? '#e0e070' : '#55dd55');
  for (const r of data.rocks) push(r.x, r.y, r.z, '#bbbbbb');
  for (const h of data.houses) push(h.x, h.y + 3, h.z, '#ff5050');
  for (const c of collectibles) push(c.x, c.y + 1, c.z, '#ff40ff');
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
  const mat = new THREE.PointsMaterial({ size: 6, sizeAttenuation: false, vertexColors: true, depthTest: false });
  const points = new THREE.Points(geo, mat);
  points.visible = false;
  points.renderOrder = 10;
  scene.add(points);
  return points;
}
