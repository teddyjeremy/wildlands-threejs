import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// Helpers for building low-poly props as single vertex-coloured geometries.
// Each prop ends up as one non-indexed BufferGeometry (flat shading, one
// draw call) that can be shared by many instances.

const tmpColor = new THREE.Color();

/** Convert to non-indexed, give every vertex the same colour. */
export function paint(geometry, color) {
  const g = geometry.index ? geometry.toNonIndexed() : geometry;
  tmpColor.set(color);
  const count = g.attributes.position.count;
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    colors[i * 3] = tmpColor.r;
    colors[i * 3 + 1] = tmpColor.g;
    colors[i * 3 + 2] = tmpColor.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  if (g.attributes.uv) g.deleteAttribute('uv');
  return g;
}

/** Shade each face slightly differently so facets read without noise. */
export function faceJitter(geometry, rng, amount = 0.06) {
  const col = geometry.attributes.color;
  for (let f = 0; f < col.count; f += 3) {
    const k = 1 + rng.range(-amount, amount);
    for (let v = 0; v < 3; v++) {
      col.setXYZ(f + v, col.getX(f + v) * k, col.getY(f + v) * k, col.getZ(f + v) * k);
    }
  }
  return geometry;
}

export function place(geometry, { x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1 } = {}) {
  const m = new THREE.Matrix4().compose(
    new THREE.Vector3(x, y, z),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)),
    new THREE.Vector3(sx, sy, sz),
  );
  geometry.applyMatrix4(m);
  return geometry;
}

/** Merge painted parts and recompute flat normals. */
export function merge(parts) {
  const g = mergeGeometries(parts, false);
  for (const p of parts) p.dispose();
  g.computeVertexNormals();
  g.computeBoundingSphere();
  g.computeBoundingBox();
  return g;
}

/** Push vertices of a polyhedron around (shared positions move together). */
export function perturb(geometry, rng, amount) {
  const pos = geometry.attributes.position;
  const seen = new Map();
  for (let i = 0; i < pos.count; i++) {
    const key = `${pos.getX(i).toFixed(3)},${pos.getY(i).toFixed(3)},${pos.getZ(i).toFixed(3)}`;
    let off = seen.get(key);
    if (!off) {
      off = [rng.range(-amount, amount), rng.range(-amount, amount), rng.range(-amount, amount)];
      seen.set(key, off);
    }
    pos.setXYZ(i, pos.getX(i) + off[0], pos.getY(i) + off[1], pos.getZ(i) + off[2]);
  }
  pos.needsUpdate = true;
  return geometry;
}

export const box = (w, h, d, color, t) => place(paint(new THREE.BoxGeometry(w, h, d), color), t);
export const cyl = (rt, rb, h, seg, color, t) => place(paint(new THREE.CylinderGeometry(rt, rb, h, seg), color), t);
export const cone = (r, h, seg, color, t) => place(paint(new THREE.ConeGeometry(r, h, seg), color), t);
export const ico = (r, detail, color, t) => place(paint(new THREE.IcosahedronGeometry(r, detail), color), t);
export const dodeca = (r, color, t) => place(paint(new THREE.DodecahedronGeometry(r, 0), color), t);
