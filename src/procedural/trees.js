import * as THREE from 'three';
import { paint, place, merge, faceJitter, perturb, cyl, cone } from './geo.js';

// Three tree families with genuinely different silhouettes, plus a large
// one-off "old tree" used as a landmark. All geometry is built around the
// origin with the base at y = 0 so instances can be dropped onto terrain.

const PALETTE = {
  bark: '#6b4a32',
  barkLight: '#9a7a5a',
  pine: ['#2f5a3a', '#3a6b43', '#2b4f36'],
  broad: ['#5f8f3e', '#6f9a44', '#7da34c'],
  birchLeaf: ['#a8b84e', '#c0b850', '#93a945'],
};

/** Stacked faceted cones: tall and narrow. Forest edge and ridge. */
export function makePine(rng) {
  const parts = [cyl(0.18, 0.28, 2.2, 5, PALETTE.bark, { y: 1.1 })];
  const tiers = rng.int(3, 4);
  let y = 1.4;
  let r = rng.range(1.5, 1.8);
  for (let i = 0; i < tiers; i++) {
    const h = rng.range(1.8, 2.2);
    const c = cone(r, h, 7, PALETTE.pine[i % 3], { y: y + h / 2, ry: rng.range(0, 1) });
    parts.push(c);
    y += h * 0.55;
    r *= 0.74;
  }
  const g = merge(parts);
  return faceJitter(g, rng, 0.07);
}

/** Round, lumpy canopy made of a few perturbed icosahedra. */
export function makeBroadleaf(rng) {
  const h = rng.range(2.0, 2.6);
  const parts = [cyl(0.2, 0.34, h, 6, PALETTE.bark, { y: h / 2 })];
  // A branch stub gives the trunk some character.
  parts.push(cyl(0.08, 0.12, 1.1, 5, PALETTE.bark, { x: 0.35, y: h * 0.7, rz: -0.8 }));
  const blobs = rng.int(3, 4);
  for (let i = 0; i < blobs; i++) {
    const a = (i / blobs) * Math.PI * 2 + rng.range(-0.3, 0.3);
    const r = rng.range(1.0, 1.4);
    const geo = perturb(new THREE.IcosahedronGeometry(r, 0), rng, 0.18);
    parts.push(place(paint(geo, PALETTE.broad[i % 3]), {
      x: Math.cos(a) * 0.7,
      y: h + 0.6 + rng.range(0, 0.6),
      z: Math.sin(a) * 0.7,
    }));
  }
  parts.push(place(paint(perturb(new THREE.IcosahedronGeometry(1.3, 0), rng, 0.2), PALETTE.broad[1]), { y: h + 1.4 }));
  return faceJitter(merge(parts), rng, 0.08);
}

/** Slim pale trunk with an offset, tilted crown. Reads well in meadows. */
export function makeBirch(rng) {
  const h = rng.range(3.4, 4.2);
  const lean = rng.range(-0.12, 0.12);
  const parts = [cyl(0.1, 0.16, h, 5, '#d9d2c3', { y: h / 2, rz: lean })];
  // Dark bark bands.
  for (let i = 0; i < 3; i++) parts.push(cyl(0.125, 0.135, 0.08, 5, '#3d3a35', { y: 0.7 + i * 0.9, rz: lean }));
  const crowns = rng.int(2, 3);
  for (let i = 0; i < crowns; i++) {
    const geo = perturb(new THREE.OctahedronGeometry(rng.range(0.8, 1.05), 0), rng, 0.12);
    parts.push(place(paint(geo, PALETTE.birchLeaf[i % 3]), {
      x: lean * -h + rng.range(-0.4, 0.4),
      y: h + i * 0.7 - 0.2,
      z: rng.range(-0.4, 0.4),
      sy: 1.4,
    }));
  }
  return faceJitter(merge(parts), rng, 0.06);
}

/** The forest's landmark tree: broad, gnarled, twisted. */
export function makeOldTree(rng) {
  const parts = [];
  parts.push(cyl(0.7, 1.3, 4.5, 7, PALETTE.bark, { y: 2.25, ry: 0.3 }));
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    parts.push(cyl(0.18, 0.4, 3.2, 5, PALETTE.bark, { x: Math.cos(a) * 1.2, y: 4.6, z: Math.sin(a) * 1.2, rx: Math.sin(a) * 0.7, rz: -Math.cos(a) * 0.7 }));
    // Roots
    parts.push(cyl(0.15, 0.4, 2.2, 4, PALETTE.barkLight, { x: Math.cos(a + 0.6) * 1.3, y: 0.3, z: Math.sin(a + 0.6) * 1.3, rx: Math.sin(a + 0.6) * 1.2, rz: -Math.cos(a + 0.6) * 1.2 }));
  }
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2;
    const geo = perturb(new THREE.IcosahedronGeometry(2.2, 0), rng, 0.4);
    parts.push(place(paint(geo, i % 2 ? '#8a6fa8' : '#9c7cb8'), { x: Math.cos(a) * 2.8, y: 6.6 + rng.range(-0.4, 0.8), z: Math.sin(a) * 2.8 }));
  }
  parts.push(place(paint(perturb(new THREE.IcosahedronGeometry(2.8, 0), rng, 0.4), '#b090c8'), { y: 8 }));
  return faceJitter(merge(parts), rng, 0.08);
}

export const TREE_KINDS = ['pine', 'broadleaf', 'birch'];
export const TREE_BUILDERS = { pine: makePine, broadleaf: makeBroadleaf, birch: makeBirch };
