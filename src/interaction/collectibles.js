import * as THREE from 'three';
import { paint, place, merge, box, cyl } from '../procedural/geo.js';
import { placeCollectibles } from '../procedural/placement.js';

// Small procedural trinkets with a distinct silhouette each and a gentle
// glow/bob. A single shared material keeps the glow consistent.

function shape(id) {
  switch (id) {
    case 'sea-glass':
      return merge([place(paint(new THREE.OctahedronGeometry(0.22, 0), '#7fe0c0'), { sy: 0.6 })]);
    case 'heron-feather':
      return merge([
        place(paint(new THREE.OctahedronGeometry(0.2, 0), '#d8dde2'), { sx: 0.35, sy: 2.2, sz: 0.08, rz: 0.4 }),
        cyl(0.012, 0.012, 0.6, 3, '#8a8f94', { rz: 0.4 }),
      ]);
    case 'amber-bead':
      return merge([place(paint(new THREE.DodecahedronGeometry(0.2, 0), '#f0a23a'), {})]);
    case 'brass-compass':
      return merge([
        cyl(0.22, 0.22, 0.07, 10, '#c9a04a', { rx: Math.PI / 2 }),
        box(0.04, 0.3, 0.02, '#b8443a', { z: 0.045 }),
        cyl(0.05, 0.05, 0.08, 6, '#c9a04a', { y: 0.25, rx: Math.PI / 2 }),
      ]);
    case 'cave-crystal':
    default:
      return merge([place(paint(new THREE.OctahedronGeometry(0.16, 0), '#b49cff'), { sy: 2.4 })]);
  }
}

export function createCollectibles(scene, terrain) {
  const material = new THREE.MeshLambertMaterial({ vertexColors: true, emissive: '#ffffff', emissiveIntensity: 0.18, flatShading: true });
  const ringMat = new THREE.MeshBasicMaterial({ color: '#fff3c4', transparent: true, opacity: 0.35, depthWrite: false });
  const ringGeo = new THREE.RingGeometry(0.35, 0.45, 20);
  ringGeo.rotateX(-Math.PI / 2);
  const items = placeCollectibles(terrain).map((c) => {
    const mesh = new THREE.Mesh(shape(c.id), material);
    const ring = new THREE.Mesh(ringGeo, ringMat);
    const group = new THREE.Group();
    group.position.set(c.x, c.y, c.z);
    mesh.position.y = 0.7;
    mesh.castShadow = true;
    ring.position.y = 0.05;
    group.add(mesh, ring);
    scene.add(group);
    return { ...c, group, mesh, collected: false };
  });
  return {
    items,
    markCollected(id) {
      const it = items.find((i) => i.id === id);
      if (it) {
        it.collected = true;
        it.group.visible = false;
      }
    },
    reset() {
      for (const it of items) {
        it.collected = false;
        it.group.visible = true;
      }
    },
    update(time) {
      for (const it of items) {
        if (it.collected) continue;
        it.mesh.rotation.y = time * 1.2;
        it.mesh.position.y = 0.7 + Math.sin(time * 2 + it.x) * 0.08;
      }
      ringMat.opacity = 0.25 + 0.12 * Math.sin(time * 2.5);
    },
    dispose() {
      for (const it of items) {
        scene.remove(it.group);
        it.mesh.geometry.dispose();
      }
      ringGeo.dispose();
      material.dispose();
      ringMat.dispose();
    },
  };
}
