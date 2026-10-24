// Collision proxies, kept completely separate from the visual meshes.
//
// Solids are vertical circles (trunks, rocks, towers) and oriented boxes
// (buildings, boards). The player and animals are treated as circles on the
// XZ plane with a height check, which is plenty for a walking game.
// Walkable decks (dock, bridge) are extra surfaces above the terrain.

export class CollisionWorld {
  constructor(cellSize = 8) {
    this.cell = cellSize;
    this.cells = new Map();
    this.solids = [];
    this.decks = [];
  }

  _key(i, j) {
    return i * 73856093 ^ j * 19349663;
  }

  /** shape: {type:'circle',x,z,r} | {type:'box',x,z,hw,hd,ry}; optional top (y) above which it is ignored. */
  add(shape) {
    const s = { top: Infinity, bottom: -Infinity, ry: 0, ...shape };
    if (s.type === 'box') {
      s.cos = Math.cos(s.ry);
      s.sin = Math.sin(s.ry);
      s.bound = Math.hypot(s.hw, s.hd);
    } else {
      s.bound = s.r;
    }
    this.solids.push(s);
    const i0 = Math.floor((s.x - s.bound) / this.cell);
    const i1 = Math.floor((s.x + s.bound) / this.cell);
    const j0 = Math.floor((s.z - s.bound) / this.cell);
    const j1 = Math.floor((s.z + s.bound) / this.cell);
    for (let i = i0; i <= i1; i++) {
      for (let j = j0; j <= j1; j++) {
        const k = this._key(i, j);
        if (!this.cells.has(k)) this.cells.set(k, []);
        this.cells.get(k).push(s);
      }
    }
    return s;
  }

  /**
   * Walkable rectangle: centre, half sizes, rotation and a height function
   * of the local z coordinate (lets the bridge arch).
   */
  addDeck(deck) {
    const d = { ry: 0, ...deck };
    d.cos = Math.cos(d.ry);
    d.sin = Math.sin(d.ry);
    this.decks.push(d);
    return d;
  }

  /** Highest deck surface under (x,z) that is not far above `y`, or -Infinity. */
  deckHeightAt(x, z, y = Infinity) {
    let best = -Infinity;
    for (const d of this.decks) {
      const dx = x - d.x;
      const dz = z - d.z;
      const lx = dx * d.cos - dz * d.sin;
      const lz = dx * d.sin + dz * d.cos;
      if (Math.abs(lx) <= d.hw && Math.abs(lz) <= d.hd) {
        const h = d.heightAt ? d.heightAt(lz) : d.y;
        if (h <= y + 0.6 && h > best) best = h;
      }
    }
    return best;
  }

  /**
   * Push a circle (x,z,r) out of every overlapping solid. Mutates and returns
   * `pos`. `y` lets you walk over low things (e.g. on top of the dock).
   */
  resolve(pos, r, y = 0) {
    const i = Math.floor(pos.x / this.cell);
    const j = Math.floor(pos.z / this.cell);
    let hit = false;
    for (let di = -1; di <= 1; di++) {
      for (let dj = -1; dj <= 1; dj++) {
        const list = this.cells.get(this._key(i + di, j + dj));
        if (!list) continue;
        for (const s of list) {
          if (y > s.top || y + 1.6 < s.bottom) continue;
          if (s.type === 'circle') {
            const dx = pos.x - s.x;
            const dz = pos.z - s.z;
            const min = s.r + r;
            const d2 = dx * dx + dz * dz;
            if (d2 < min * min) {
              const d = Math.sqrt(d2) || 1e-4;
              pos.x = s.x + (dx / d) * min;
              pos.z = s.z + (dz / d) * min;
              hit = true;
            }
          } else {
            // Into box space.
            const dx = pos.x - s.x;
            const dz = pos.z - s.z;
            const lx = dx * s.cos - dz * s.sin;
            const lz = dx * s.sin + dz * s.cos;
            const cx = Math.max(-s.hw, Math.min(s.hw, lx));
            const cz = Math.max(-s.hd, Math.min(s.hd, lz));
            let ox = lx - cx;
            let oz = lz - cz;
            const d2 = ox * ox + oz * oz;
            let nlx = lx;
            let nlz = lz;
            if (d2 < r * r) {
              if (d2 > 1e-8) {
                const d = Math.sqrt(d2);
                nlx = cx + (ox / d) * r;
                nlz = cz + (oz / d) * r;
              } else {
                // Centre inside the box: exit through the nearest face.
                const px = s.hw - Math.abs(lx);
                const pz = s.hd - Math.abs(lz);
                if (px < pz) nlx = Math.sign(lx || 1) * (s.hw + r);
                else nlz = Math.sign(lz || 1) * (s.hd + r);
              }
              // Back to world space (inverse rotation).
              pos.x = s.x + nlx * s.cos + nlz * s.sin;
              pos.z = s.z - nlx * s.sin + nlz * s.cos;
              hit = true;
            }
          }
        }
      }
    }
    return hit;
  }

  /** True if a circle at (x,z) overlaps any solid. */
  blocked(x, z, r, y = 0) {
    const p = { x, z };
    return this.resolve(p, r, y);
  }
}
