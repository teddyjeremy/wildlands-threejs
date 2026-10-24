import * as THREE from 'three';
import { paint, place, merge, faceJitter, perturb, box, cyl, cone } from './geo.js';
import { makeRock } from './rocks.js';

// Architectural props. Each builder returns a merged, vertex-coloured
// geometry in local space (door/entrance facing +Z, base at y = 0) plus a
// list of simple collision shapes in the same local space.

const WALLS = ['#e7dcc4', '#d9c7a3', '#c9d3c8', '#e2c9b0', '#cfc1d9', '#d8d0b8'];
const ROOFS = ['#9c4b3a', '#5d6f7f', '#7a5a3c', '#a46a3f', '#4f6b52'];
const TRIM = '#5a4636';

function gableRoof(w, d, rise, overhang, color) {
  const shape = new THREE.Shape();
  shape.moveTo(-w / 2 - overhang, 0);
  shape.lineTo(w / 2 + overhang, 0);
  shape.lineTo(0, rise);
  shape.lineTo(-w / 2 - overhang, 0);
  const g = new THREE.ExtrudeGeometry(shape, { depth: d + overhang * 2, bevelEnabled: false });
  g.translate(0, 0, -(d + overhang * 2) / 2);
  return paint(g, color);
}

/**
 * @param {object} p width, depth, height, roofStyle ('gable'|'hip'|'shed'), wall, roof, chimney, porch
 */
export function makeHouse(rng, p = {}) {
  const w = p.width ?? rng.range(4.2, 5.6);
  const d = p.depth ?? rng.range(3.8, 5);
  const h = p.height ?? rng.range(2.6, 3.3);
  const style = p.roofStyle ?? rng.pick(['gable', 'gable', 'hip', 'shed']);
  const wall = p.wall ?? rng.pick(WALLS);
  const roof = p.roof ?? rng.pick(ROOFS);
  const parts = [];

  // Stone foundation runs a little below ground so slopes never show a gap.
  parts.push(box(w + 0.3, 0.9, d + 0.3, '#8a8072', { y: -0.15 }));
  parts.push(box(w, h, d, wall, { y: 0.3 + h / 2 }));
  // Corner posts.
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) parts.push(box(0.2, h, 0.2, TRIM, { x: (sx * w) / 2, y: 0.3 + h / 2, z: (sz * d) / 2 }));

  const top = 0.3 + h;
  if (style === 'gable') {
    parts.push(place(gableRoof(w, d, h * 0.55, 0.35, roof), { y: top }));
  } else if (style === 'hip') {
    const c = new THREE.ConeGeometry(1, 1, 4, 1);
    parts.push(place(paint(c, roof), { y: top + h * 0.3, ry: Math.PI / 4, sx: (w + 0.8) * 0.72, sz: (d + 0.8) * 0.72, sy: h * 0.6 }));
  } else {
    parts.push(box(w + 0.7, 0.22, d + 0.8, roof, { y: top + 0.45, rx: 0.18 }));
    parts.push(box(w, 0.9, 0.1, wall, { y: top + 0.35, z: -d / 2 + 0.05 }));
  }

  // Door on +Z, windows on the sides.
  parts.push(box(0.95, 1.7, 0.12, '#5b3d2a', { y: 0.3 + 0.85, z: d / 2 + 0.03 }));
  parts.push(box(1.15, 0.12, 0.16, TRIM, { y: 0.3 + 1.75, z: d / 2 + 0.04 }));
  const winY = 0.3 + h * 0.58;
  for (const sx of [-1, 1]) {
    parts.push(box(0.8, 0.7, 0.1, '#f2d58a', { x: sx * (w / 2 - 1.0), y: winY, z: d / 2 + 0.03 }));
    parts.push(box(0.1, 0.7, 0.8, '#f2d58a', { x: sx * (w / 2 + 0.03), y: winY, z: 0 }));
    parts.push(box(0.12, 0.85, 0.95, TRIM, { x: sx * (w / 2 + 0.01), y: winY, z: 0, sz: 1 }));
  }
  if (p.chimney ?? rng.chance(0.6)) {
    parts.push(box(0.55, 1.6, 0.55, '#8a6f5d', { x: w * 0.25, y: top + 0.9, z: -d * 0.2 }));
  }
  const hasPorch = p.porch ?? rng.chance(0.5);
  if (hasPorch) {
    parts.push(box(w * 0.7, 0.18, 1.3, '#8b6a4a', { y: 0.38, z: d / 2 + 0.65 }));
    for (const sx of [-1, 1]) parts.push(box(0.14, 2.2, 0.14, TRIM, { x: sx * w * 0.32, y: 1.4, z: d / 2 + 1.2 }));
    parts.push(box(w * 0.78, 0.14, 1.6, roof, { y: 2.5, z: d / 2 + 0.75, rx: 0.2 }));
  }
  const g = faceJitter(merge(parts), rng, 0.03);
  return { geometry: g, colliders: [{ type: 'box', x: 0, z: 0, hw: w / 2 + 0.1, hd: d / 2 + 0.1 }], size: { w, d, h }, style };
}

export function makeLighthouse(rng) {
  const parts = [];
  parts.push(cyl(3.2, 3.6, 1.2, 8, '#8e877a', { y: 0.3 }));
  const bands = 6;
  const towerH = 11;
  for (let i = 0; i < bands; i++) {
    const y0 = 0.9 + (i * towerH) / bands;
    const r0 = 2.2 - (i / bands) * 0.8;
    const r1 = 2.2 - ((i + 1) / bands) * 0.8;
    parts.push(cyl(r1, r0, towerH / bands, 10, i % 2 ? '#b8443a' : '#f1ece1', { y: y0 + towerH / bands / 2 }));
  }
  const top = 0.9 + towerH;
  parts.push(cyl(2.0, 1.6, 0.35, 10, '#3d4044', { y: top + 0.17 })); // balcony
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    parts.push(box(0.07, 0.7, 0.07, '#3d4044', { x: Math.cos(a) * 1.9, y: top + 0.7, z: Math.sin(a) * 1.9 }));
  }
  parts.push(cyl(1.92, 1.92, 0.06, 16, '#3d4044', { y: top + 1.05 }));
  parts.push(cyl(1.05, 1.05, 0.3, 8, '#3d4044', { y: top + 0.5 }));
  parts.push(cyl(1.15, 1.15, 0.22, 8, '#3d4044', { y: top + 2.25 }));
  parts.push(cone(1.45, 1.4, 8, '#b8443a', { y: top + 3.05 }));
  parts.push(cyl(0.08, 0.08, 0.7, 4, '#3d4044', { y: top + 4.0 }));
  // Small windows climbing the tower.
  for (let i = 0; i < 3; i++) {
    const y = 3 + i * 3;
    const r = 2.2 - ((y - 0.9) / towerH) * 0.8;
    const a = 0.6 + i * 2.1;
    parts.push(box(0.45, 0.7, 0.2, '#2e3a46', { x: Math.cos(a) * r, y, z: Math.sin(a) * r, ry: -a + Math.PI / 2 }));
  }
  parts.push(box(1.1, 1.9, 0.3, '#4a3426', { y: 1.9, z: 2.05 })); // door
  // Keeper's hut.
  parts.push(box(3.2, 2.2, 2.6, '#e6dfcf', { x: -3.6, y: 1.1, z: 1.0 }));
  parts.push(place(gableRoof(3.2, 2.6, 1.1, 0.25, '#5d6f7f'), { x: -3.6, y: 2.2, z: 1.0 }));
  return {
    geometry: faceJitter(merge(parts), rng, 0.02),
    colliders: [
      { type: 'circle', x: 0, z: 0, r: 2.6 },
      { type: 'box', x: -3.6, z: 1.0, hw: 1.7, hd: 1.4 },
    ],
    lanternHeight: top + 1.4,
  };
}

/** Wooden dock along +Z. Returns geometry and the walkable deck rectangle. */
export function makeDock(rng, length = 16, width = 2.6) {
  const parts = [];
  const plank = 0.42;
  for (let z = 0; z < length; z += plank + 0.06) {
    parts.push(box(width, 0.12, plank, rng.chance(0.15) ? '#8e6d4c' : '#a27e58', { y: 0, z: z + plank / 2, ry: rng.range(-0.02, 0.02) }));
  }
  for (let z = 0; z <= length; z += 3.2) {
    for (const sx of [-1, 1]) parts.push(cyl(0.13, 0.15, 4.2, 5, '#5e4632', { x: (sx * width) / 2, y: -1.7, z }));
  }
  for (const sx of [-1, 1]) parts.push(box(0.16, 0.16, length, '#6e5238', { x: (sx * width) / 2, y: -0.12, z: length / 2 }));
  // Mooring post with a coil of rope.
  parts.push(cyl(0.18, 0.18, 1.0, 6, '#5e4632', { x: width / 2 - 0.2, y: 0.5, z: length - 0.4 }));
  parts.push(place(paint(new THREE.TorusGeometry(0.25, 0.07, 4, 8), '#c9b48a'), { x: width / 2 - 0.2, y: 0.12, z: length - 1.1, rx: Math.PI / 2 }));
  return { geometry: faceJitter(merge(parts), rng, 0.05), length, width };
}

/** Plank geometry for the bridge (used as an InstancedMesh) and rail geometry. */
export function makeBridgeParts(length, width) {
  const plank = paint(new THREE.BoxGeometry(width, 0.14, 0.38), '#a27e58');
  plank.computeVertexNormals();
  const rails = [];
  for (const sx of [-1, 1]) {
    rails.push(box(0.12, 0.12, length + 0.4, '#6e5238', { x: (sx * width) / 2, y: 0.9, z: 0 }));
    for (let z = -length / 2; z <= length / 2 + 0.01; z += length / 3) rails.push(box(0.12, 1.0, 0.12, '#5e4632', { x: (sx * width) / 2, y: 0.45, z }));
    rails.push(box(0.2, 0.2, length, '#5e4632', { x: (sx * width) / 2, y: -0.1, z: 0 }));
  }
  return { plank, rails: merge(rails) };
}

export function makeNoticeBoard(rng) {
  const parts = [];
  for (const sx of [-1, 1]) parts.push(box(0.15, 2.2, 0.15, '#5e4632', { x: sx * 0.9, y: 1.1 }));
  parts.push(box(2.0, 1.2, 0.1, '#8b6a4a', { y: 1.5 }));
  parts.push(box(0.6, 0.5, 0.02, '#efe6d0', { x: -0.45, y: 1.6, z: 0.06, rz: 0.05 }));
  parts.push(box(0.5, 0.65, 0.02, '#e9dcb8', { x: 0.4, y: 1.5, z: 0.06, rz: -0.08 }));
  parts.push(box(2.3, 0.1, 0.5, '#7a5a3c', { y: 2.2, rx: 0.15 }));
  return { geometry: faceJitter(merge(parts), rng, 0.04), colliders: [{ type: 'box', x: 0, z: 0, hw: 1.0, hd: 0.2 }] };
}

export function makeLampPost() {
  const parts = [
    cyl(0.07, 0.1, 2.6, 5, '#3d4044', { y: 1.3 }),
    box(0.4, 0.06, 0.4, '#3d4044', { y: 2.6 }),
    cone(0.32, 0.25, 4, '#3d4044', { y: 3.2, ry: Math.PI / 4 }),
  ];
  return merge(parts);
}

export function makeCairn(rng) {
  const parts = [];
  let y = 0;
  for (let i = 0; i < 5; i++) {
    const r = 0.7 - i * 0.11;
    const g = perturb(new THREE.CylinderGeometry(r, r * 1.1, 0.32, 7), rng, 0.05);
    parts.push(place(paint(g, i % 2 ? '#9b9284' : '#8d8478'), { y: y + 0.16, ry: rng.range(0, 3) }));
    y += 0.3;
  }
  return faceJitter(merge(parts), rng, 0.06);
}

/**
 * Hollow made from a ring of cliff rocks with a roof slab. The gap faces +Z.
 * Interior floor is darker; crystals are a separate glowing mesh.
 */
export function makeCave(rng) {
  const parts = [];
  const colliders = [];
  const ringR = 5.2;
  const count = 11;
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2 + Math.PI / 2;
    // Skip the two stones in front so there is a doorway on +Z.
    const fwd = Math.cos(a - Math.PI / 2);
    if (fwd > 0.93) continue;
    const g = makeRock(rng, 'cliff');
    const x = Math.cos(a) * ringR;
    const z = Math.sin(a) * ringR;
    place(g, { x, y: 1.6, z, ry: rng.range(0, 6), sx: 1.15, sz: 1.15 });
    parts.push(g);
    colliders.push({ type: 'circle', x: x * 1.08, z: z * 1.08, r: 1.9 });
  }
  // Entrance pillars, slightly darker.
  for (const sx of [-1, 1]) {
    const g = makeRock(rng, 'cliff');
    place(g, { x: sx * 2.6, y: 1.8, z: ringR + 0.3, sx: 0.7, sz: 0.7, sy: 1.1 });
    parts.push(g);
    colliders.push({ type: 'circle', x: sx * 2.75, z: ringR + 0.3, r: 1.2 });
  }
  // Roof: a heavy flattened rock plus a lintel over the doorway.
  const roof = paint(perturb(new THREE.DodecahedronGeometry(1, 1), rng, 0.08), '#6f685f');
  place(roof, { y: 5.6, sx: 7.2, sy: 1.8, sz: 7.2 });
  parts.push(roof);
  const lintel = makeRock(rng, 'boulder');
  place(lintel, { y: 4.6, z: ringR + 0.2, sx: 3.2, sy: 1.0, sz: 1.4 });
  parts.push(lintel);
  // Dark interior floor so the passage reads as shadowed even without shadows.
  parts.push(place(paint(new THREE.CircleGeometry(ringR - 0.4, 10), '#2d2a2f'), { y: 0.06, rx: -Math.PI / 2 }));
  const geo = merge(parts);
  // Darken faces that point inwards/downwards (inner walls and ceiling).
  const pos = geo.attributes.position;
  const nrm = geo.attributes.normal;
  const col = geo.attributes.color;
  for (let i = 0; i < pos.count; i++) {
    const px = pos.getX(i);
    const pz = pos.getZ(i);
    const inward = -(nrm.getX(i) * px + nrm.getZ(i) * pz) / (Math.hypot(px, pz) + 1e-3);
    const down = -nrm.getY(i);
    if (Math.hypot(px, pz) < ringR + 1 && (inward > 0.2 || down > 0.4)) {
      col.setXYZ(i, col.getX(i) * 0.4, col.getY(i) * 0.38, col.getZ(i) * 0.45);
    }
  }
  return { geometry: geo, colliders, radius: ringR };
}

export function makeCrystal(rng) {
  const parts = [];
  for (let i = 0; i < 5; i++) {
    const h = rng.range(0.6, 1.5);
    const g = new THREE.OctahedronGeometry(0.25, 0);
    place(g, { sy: h * 2.2 });
    parts.push(place(paint(g, i % 2 ? '#8fe3ff' : '#b49cff'), { x: rng.range(-0.4, 0.4), y: h * 0.4, z: rng.range(-0.4, 0.4), rx: rng.range(-0.4, 0.4), rz: rng.range(-0.4, 0.4) }));
  }
  return merge(parts);
}

export function makeSpring(rng) {
  const parts = [];
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2;
    const g = makeRock(rng, 'boulder');
    place(g, { x: Math.cos(a) * 1.6, y: 0.2, z: Math.sin(a) * 1.6, sx: 0.7, sy: 0.6, sz: 0.7 });
    parts.push(g);
  }
  return merge(parts);
}

export function makeDriftwood(rng) {
  const parts = [cyl(0.14, 0.2, 3.2, 5, '#b9a588', { y: 0.15, rz: Math.PI / 2, ry: rng.range(0, 3) })];
  parts.push(cyl(0.06, 0.1, 1.0, 4, '#b9a588', { x: 0.6, y: 0.35, z: 0.2, rz: 0.8 }));
  return faceJitter(merge(parts), rng, 0.05);
}
