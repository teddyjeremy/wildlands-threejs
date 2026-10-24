import * as THREE from 'three';
import { paint, perturb, merge, faceJitter, place } from './geo.js';

// Rocks are perturbed polyhedra. The perturbation is bounded and seeded, so
// shapes stay chunky and readable rather than spiky.

const STONE = ['#8d8478', '#9b9284', '#7c756b', '#a89c88'];

export function makeRock(rng, kind = 'boulder') {
  let geo;
  if (kind === 'pebble') {
    geo = perturb(new THREE.IcosahedronGeometry(0.35, 0), rng, 0.08);
    place(geo, { sy: 0.6 });
  } else if (kind === 'flat') {
    geo = perturb(new THREE.CylinderGeometry(0.9, 1.0, 0.35, 7), rng, 0.08);
  } else if (kind === 'cliff') {
    geo = perturb(new THREE.DodecahedronGeometry(2.2, 0), rng, 0.45);
    place(geo, { sy: 1.5, sx: 0.9 });
  } else {
    geo = perturb(new THREE.DodecahedronGeometry(1, 0), rng, 0.22);
    place(geo, { sy: rng.range(0.6, 0.85) });
  }
  const g = paint(geo, rng.pick(STONE));
  g.computeVertexNormals();
  faceJitter(g, rng, 0.08);
  // A hint of moss on the upward faces of big rocks.
  if (kind === 'boulder' || kind === 'cliff') {
    const pos = g.attributes.position;
    const nrm = g.attributes.normal;
    const col = g.attributes.color;
    for (let f = 0; f < pos.count; f += 3) {
      if (nrm.getY(f) > 0.75 && rng.chance(0.6)) {
        for (let v = 0; v < 3; v++) col.setXYZ(f + v, 0.42, 0.52, 0.3);
      }
    }
  }
  g.computeBoundingSphere();
  return g;
}

export { merge };
