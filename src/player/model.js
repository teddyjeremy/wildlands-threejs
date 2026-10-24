import * as THREE from 'three';
import { paint, place, merge, box, cyl, cone } from '../procedural/geo.js';

// Low-poly explorer built from primitives. Limbs hang from pivot groups at
// the shoulders and hips so they swing around believable joints.
// Accessory: a wide-brimmed field hat and a rolled map on the backpack.

const COL = {
  skin: '#d9a77c',
  shirt: '#d9673b', // warm orange, reads against green and grey
  trousers: '#4b5a6b',
  boots: '#4a3326',
  pack: '#7a6a3c',
  hat: '#c9a45c',
  band: '#5b3d2a',
  scarf: '#2f7f86',
};

export function buildExplorer() {
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  const root = new THREE.Group();
  const body = new THREE.Group(); // bobs and leans as a unit
  body.position.y = 0.95;
  root.add(body);

  const torso = new THREE.Mesh(merge([
    box(0.5, 0.6, 0.3, COL.shirt, { y: 0.3 }),
    box(0.52, 0.12, 0.32, COL.band, { y: 0.02 }), // belt
    cyl(0.17, 0.2, 0.12, 6, COL.scarf, { y: 0.62 }),
    box(0.36, 0.44, 0.2, COL.pack, { y: 0.32, z: -0.24 }), // backpack
    box(0.3, 0.12, 0.08, '#5f522e', { y: 0.2, z: -0.36 }),
    cyl(0.07, 0.07, 0.42, 6, '#efe6d0', { y: 0.6, z: -0.26, rz: Math.PI / 2 }), // rolled map
  ]), mat);
  body.add(torso);

  const neck = new THREE.Group();
  neck.position.y = 0.66;
  body.add(neck);
  const head = new THREE.Mesh(merge([
    place(paint(new THREE.IcosahedronGeometry(0.17, 1), COL.skin), { y: 0.17, sy: 1.08 }),
    box(0.035, 0.035, 0.02, '#2a2420', { x: 0.065, y: 0.19, z: 0.155 }),
    box(0.035, 0.035, 0.02, '#2a2420', { x: -0.065, y: 0.19, z: 0.155 }),
    cyl(0.34, 0.34, 0.03, 10, COL.hat, { y: 0.31 }), // brim
    cyl(0.15, 0.18, 0.16, 8, COL.hat, { y: 0.39 }),
    cyl(0.181, 0.181, 0.04, 8, COL.band, { y: 0.34 }),
  ]), mat);
  neck.add(head);

  const limb = (len, w, color, foot) => {
    const parts = [box(w, len, w, color, { y: -len / 2 })];
    if (foot) parts.push(box(w + 0.03, 0.12, w + 0.12, COL.boots, { y: -len + 0.02, z: 0.05 }));
    else parts.push(box(w * 0.85, 0.1, w * 0.85, COL.skin, { y: -len - 0.03 })); // hand
    return merge(parts);
  };
  const armGeo = limb(0.5, 0.13, COL.shirt, false);
  const legGeo = limb(0.86, 0.16, COL.trousers, true);
  const mk = (geo, x, y) => {
    const pivot = new THREE.Group();
    pivot.position.set(x, y, 0);
    pivot.add(new THREE.Mesh(geo, mat));
    return pivot;
  };
  const armL = mk(armGeo, 0.33, 0.56);
  const armR = mk(armGeo, -0.33, 0.56);
  body.add(armL, armR);
  const legL = mk(legGeo, 0.13, 0.02);
  const legR = mk(legGeo, -0.13, 0.02);
  body.add(legL, legR);
  root.traverse((o) => {
    if (o.isMesh) o.castShadow = true;
  });

  // Lantern, hung from the right hand on its own pivot so it can swing.
  const lantern = new THREE.Group();
  lantern.position.set(0, -0.6, 0.06);
  armR.add(lantern);
  const lanternSwing = new THREE.Group();
  lantern.add(lanternSwing);
  const frame = new THREE.Mesh(merge([
    cyl(0.012, 0.012, 0.14, 4, '#3a3026', { y: -0.07 }), // handle wire
    cyl(0.1, 0.12, 0.04, 6, '#4a3a2a', { y: -0.16 }), // cap
    cyl(0.03, 0.06, 0.05, 6, '#6b5536', { y: -0.13 }),
    cyl(0.11, 0.1, 0.04, 6, '#4a3a2a', { y: -0.4 }), // base
    ...[0, 1, 2, 3, 4, 5].map((i) => box(0.016, 0.22, 0.016, '#3a3026', { x: Math.cos((i / 6) * Math.PI * 2) * 0.095, z: Math.sin((i / 6) * Math.PI * 2) * 0.095, y: -0.28 })),
  ]), mat);
  lanternSwing.add(frame);
  const glassMat = new THREE.MeshBasicMaterial({ color: '#ffe7a8', transparent: true, opacity: 0.85 });
  const glass = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.085, 0.22, 6), glassMat);
  glass.position.y = -0.28;
  lanternSwing.add(glass);
  const flame = new THREE.Mesh(new THREE.OctahedronGeometry(0.045, 0), new THREE.MeshBasicMaterial({ color: '#ffffff' }));
  flame.position.y = -0.29;
  lanternSwing.add(flame);
  const light = new THREE.PointLight('#ffcf80', 0, 11, 1.6);
  light.position.y = -0.28;
  lanternSwing.add(light);
  lantern.visible = false;
  return { root, body, neck, armL, armR, legL, legR, mat, lantern, lanternSwing, glassMat, flame, light, swingV: 0, swingA: 0 };
}

/** Pose the rig for the current movement state. `phase` advances with distance walked. */
export function animateExplorer(rig, state, phase, dt, reduced = false) {
  const k = Math.min(1, dt * 12);
  let swing = 0;
  let bob = 0;
  let lean = 0;
  let armUp = 0;
  if (state === 'walk' || state === 'run') {
    const amp = state === 'run' ? 0.9 : 0.55;
    swing = Math.sin(phase) * amp;
    bob = reduced ? 0 : Math.abs(Math.cos(phase)) * (state === 'run' ? 0.07 : 0.035);
    lean = state === 'run' ? 0.14 : 0.04;
  } else if (state === 'jump' || state === 'fall') {
    armUp = -0.9;
    swing = 0.3;
  } else if (state === 'interact') {
    armUp = -1.2;
  }
  const lerp = (o, key, v) => (o[key] += (v - o[key]) * k);
  lerp(rig.legL.rotation, 'x', state === 'jump' || state === 'fall' ? -0.5 : swing);
  lerp(rig.legR.rotation, 'x', state === 'jump' || state === 'fall' ? 0.25 : -swing);
  lerp(rig.armL.rotation, 'x', armUp ? armUp : -swing * 0.9);
  const holding = rig.lantern.visible;
  const armRTarget = state === 'interact' ? -0.6 : holding ? -0.45 + swing * 0.25 : armUp ? armUp : swing * 0.9;
  lerp(rig.armR.rotation, 'x', armRTarget);
  lerp(rig.body.rotation, 'x', lean);
  // Counter-twist of the torso against the stride.
  lerp(rig.body.rotation, 'y', reduced ? 0 : swing * 0.1);
  lerp(rig.neck.rotation, 'y', reduced ? 0 : -swing * 0.08);
  rig.body.position.y = 0.95 + bob;
  if (holding) {
    // Damped pendulum: the lantern lags behind the arm and settles.
    const want = -rig.armR.rotation.x - rig.body.rotation.x;
    const dtc = Math.min(dt, 0.05);
    rig.swingV += ((want - rig.swingA) * 40 - rig.swingV * 4.5) * dtc;
    rig.swingA += rig.swingV * dtc;
    rig.lanternSwing.rotation.x = reduced ? want : rig.swingA;
    rig.lanternSwing.rotation.z = reduced ? 0 : Math.sin(phase * 0.5) * 0.08;
  }
  // Idle breathing.
  if (state === 'idle' && !reduced) rig.body.scale.y = 1 + Math.sin(performance.now() * 0.002) * 0.008;
  else rig.body.scale.y = 1;
}
