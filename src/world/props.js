import * as THREE from 'three';
import { createRandom } from '../procedural/random.js';
import { TREE_BUILDERS, TREE_KINDS, makeOldTree } from '../procedural/trees.js';
import { makeRock } from '../procedural/rocks.js';
import {
  makeHouse, makeLighthouse, makeDock, makeBridgeParts, makeNoticeBoard, makeLampPost,
  makeCairn, makeCave, makeCrystal, makeSpring, makeDriftwood,
} from '../procedural/buildings.js';
import { placeHouses, placeTrees, placeRocks, placeFlowers } from '../procedural/placement.js';

// Turns placement data into scene objects and collision proxies.
// Repeated things (trees, rocks, flowers, bridge planks, lamps) are
// InstancedMeshes; one-off landmarks are single merged meshes.

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();
const _e = new THREE.Euler();
const _c = new THREE.Color();

function setInstance(mesh, i, x, y, z, ry, s, sy = s) {
  _q.setFromEuler(_e.set(0, ry, 0));
  _m.compose(_p.set(x, y, z), _q, _s.set(s, sy, s));
  mesh.setMatrixAt(i, _m);
}

export function buildProps({ scene, terrain, collisions, seed, quality }) {
  const vegSeed = terrain.config.vegetationSeed || `${seed}:veg`;
  const L = terrain.layout;
  const material = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  const out = { meshes: [], lamps: [], data: {}, materials: [material] };
  const add = (m, shadow = true) => {
    m.castShadow = shadow;
    m.receiveShadow = true;
    scene.add(m);
    out.meshes.push(m);
    return m;
  };
  const rng = createRandom(`${seed}:props`);

  // ---- Village -------------------------------------------------------------
  const houses = placeHouses(terrain, seed);
  out.data.houses = houses;
  houses.forEach((h, i) => {
    const hr = createRandom(`${seed}:house:${i}`);
    const styles = ['gable', 'hip', 'gable', 'shed', 'gable', 'hip', 'gable'];
    const house = makeHouse(hr, { roofStyle: styles[i % styles.length] });
    const mesh = new THREE.Mesh(house.geometry, material);
    mesh.position.set(h.x, h.y, h.z);
    mesh.rotation.y = h.ry;
    mesh.name = h.id;
    add(mesh);
    for (const c of house.colliders) collisions.add({ ...c, x: h.x, z: h.z, ry: h.ry });
  });

  const board = makeNoticeBoard(rng);
  const boardPos = { x: L.village.x + 2.5, z: L.village.z + 2.5 };
  const boardMesh = new THREE.Mesh(board.geometry, material);
  boardMesh.position.set(boardPos.x, terrain.heightAt(boardPos.x, boardPos.z), boardPos.z);
  boardMesh.rotation.y = Math.atan2(L.cove.x - boardPos.x, L.cove.z - boardPos.z);
  add(boardMesh);
  collisions.add({ type: 'box', x: boardPos.x, z: boardPos.z, hw: 1.0, hd: 0.25, ry: boardMesh.rotation.y });
  out.data.noticeBoard = boardPos;

  // Village well in the middle of the clearing.
  const well = new THREE.Mesh(makeSpring(createRandom(`${seed}:well`)), material);
  well.position.set(L.village.x - 1.5, L.village.height, L.village.z - 1.5);
  well.scale.setScalar(0.75);
  add(well);
  collisions.add({ type: 'circle', x: well.position.x, z: well.position.z, r: 1.6 });

  // ---- Lamps (village + paths near it) -----------------------------------
  const lampSpots = [];
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + 0.3;
    lampSpots.push([L.village.x + Math.cos(a) * 7.5, L.village.z + Math.sin(a) * 7.5]);
  }
  lampSpots.push([L.cove.x - 2, L.cove.z + 6], [L.bridge.x + 2, L.bridge.z - 5.5]);
  const lampGeo = makeLampPost();
  const lampMesh = new THREE.InstancedMesh(lampGeo, material, lampSpots.length);
  const glowMat = new THREE.MeshBasicMaterial({ color: '#ffd38a' });
  out.materials.push(glowMat);
  const glowMesh = new THREE.InstancedMesh(new THREE.OctahedronGeometry(0.17, 0), glowMat, lampSpots.length);
  lampSpots.forEach(([x, z], i) => {
    const y = terrain.heightAt(x, z);
    setInstance(lampMesh, i, x, y, z, 0, 1);
    setInstance(glowMesh, i, x, y + 2.85, z, 0, 1);
    collisions.add({ type: 'circle', x, z, r: 0.2 });
    out.lamps.push(new THREE.Vector3(x, y + 2.85, z));
  });
  add(lampMesh);
  add(glowMesh, false);
  out.lampGlow = glowMat;

  // ---- Trees -----------------------------------------------------------------
  const trees = placeTrees(terrain, vegSeed, houses);
  out.data.trees = trees;
  const variants = 3; // geometric variants per family
  for (const kind of TREE_KINDS) {
    for (let v = 0; v < variants; v++) {
      const list = trees.filter((t, idx) => t.kind === kind && idx % variants === v);
      if (!list.length) continue;
      const geo = TREE_BUILDERS[kind](createRandom(`${vegSeed}:${kind}:${v}`));
      const mesh = new THREE.InstancedMesh(geo, material, list.length);
      list.forEach((t, i) => {
        setInstance(mesh, i, t.x, t.y - 0.1, t.z, t.ry, t.scale);
        // Gentle per-instance tint keeps the forest from looking cloned.
        mesh.setColorAt(i, _c.setHSL(0, 0, 0.9 + ((i * 37) % 20) / 100));
        collisions.add({ type: 'circle', x: t.x, z: t.z, r: (kind === 'birch' ? 0.25 : 0.4) * t.scale, top: t.y + 6 });
      });
      mesh.name = `trees-${kind}-${v}`;
      add(mesh);
    }
  }
  // Landmark tree.
  const oldPos = { x: L.forest.x - 6, z: L.forest.z - 4 };
  const oldTree = new THREE.Mesh(makeOldTree(createRandom(`${seed}:oldtree`)), material);
  oldTree.position.set(oldPos.x, terrain.heightAt(oldPos.x, oldPos.z) - 0.2, oldPos.z);
  add(oldTree);
  collisions.add({ type: 'circle', x: oldPos.x, z: oldPos.z, r: 1.4 });
  out.data.oldTree = oldPos;

  // ---- Rocks -----------------------------------------------------------------
  const rocks = placeRocks(terrain, vegSeed, trees);
  out.data.rocks = rocks;
  for (const kind of ['boulder', 'pebble', 'cliff', 'flat']) {
    for (let v = 0; v < 3; v++) {
      const list = rocks.filter((r, idx) => r.kind === kind && idx % 3 === v);
      if (!list.length) continue;
      const geo = makeRock(createRandom(`${vegSeed}:rock:${kind}:${v}`), kind);
      const mesh = new THREE.InstancedMesh(geo, material, list.length);
      list.forEach((r, i) => {
        setInstance(mesh, i, r.x, r.y - 0.15 * r.scale, r.z, r.ry, r.scale);
        if (r.radius > 0.4) collisions.add({ type: 'circle', x: r.x, z: r.z, r: r.radius * 0.85, top: r.y + r.scale * 1.2 });
      });
      add(mesh);
    }
  }

  // ---- Flowers (one instanced mesh, colour per instance) ---------------------
  const flowers = placeFlowers(terrain, vegSeed, 900);
  const petal = new THREE.ConeGeometry(0.12, 0.3, 5);
  petal.translate(0, 0.25, 0);
  const flowerMat = new THREE.MeshLambertMaterial({ flatShading: true });
  out.materials.push(flowerMat);
  const flowerMesh = new THREE.InstancedMesh(petal, flowerMat, flowers.length);
  const fcols = ['#f2e15c', '#e98aa8', '#f4f1ea', '#9f8ce0'].map((c) => new THREE.Color(c));
  flowers.forEach((f, i) => {
    setInstance(flowerMesh, i, f.x, f.y, f.z, 0, f.scale);
    flowerMesh.setColorAt(i, fcols[f.colour]);
  });
  flowerMesh.count = Math.min(flowers.length, quality.flowers);
  add(flowerMesh, false);
  out.flowerMesh = flowerMesh;

  // ---- Cove: dock, driftwood --------------------------------------------------
  const dock = makeDock(rng, 16, 2.6);
  const dockStart = { x: L.cove.x + 2, z: L.cove.z + 7 };
  const deckY = 1.15;
  const dockMesh = new THREE.Mesh(dock.geometry, material);
  dockMesh.position.set(dockStart.x, deckY, dockStart.z);
  add(dockMesh);
  collisions.addDeck({ x: dockStart.x, z: dockStart.z + dock.length / 2, hw: dock.width / 2, hd: dock.length / 2, y: deckY + 0.06 });
  // Invisible rails keep you from walking off the sides into the sea.
  for (const sx of [-1, 1]) collisions.add({ type: 'box', x: dockStart.x + sx * (dock.width / 2 + 0.15), z: dockStart.z + dock.length / 2 + 2, hw: 0.15, hd: dock.length / 2 - 2, bottom: deckY - 0.5 });
  collisions.add({ type: 'box', x: dockStart.x, z: dockStart.z + dock.length + 0.15, hw: dock.width / 2 + 0.3, hd: 0.15 });
  out.data.dockEnd = { x: dockStart.x + 0.6, z: dockStart.z + dock.length - 1.5, y: deckY };
  out.data.dockNote = { x: dockStart.x - 0.6, z: dockStart.z + 3, y: deckY };
  for (let i = 0; i < 4; i++) {
    const a = rng.range(-1.2, 1.2);
    const x = L.cove.x + Math.cos(a) * rng.range(6, 10) - 3;
    const z = L.cove.z + 5 + Math.sin(a) * 3;
    const m = new THREE.Mesh(makeDriftwood(createRandom(`${seed}:drift:${i}`)), material);
    m.position.set(x, terrain.heightAt(x, z), z);
    add(m);
  }

  // ---- Bridge over the stream (instanced planks + walkable deck) -------------
  {
    const b = L.bridge;
    // The stream runs roughly east-west here and the path crosses it
    // north-south, so the bridge's long axis is world Z.
    const len = b.length;
    const width = b.width;
    const parts = makeBridgeParts(len, width);
    const plankCount = Math.floor(len / 0.44);
    const planks = new THREE.InstancedMesh(parts.plank, material, plankCount);
    const base = Math.max(terrain.heightAt(b.x, b.z - len / 2), terrain.heightAt(b.x, b.z + len / 2)) + 0.05;
    const arch = (lz) => base + 0.6 * (1 - (2 * lz / len) ** 2);
    for (let i = 0; i < plankCount; i++) {
      const lz = -len / 2 + (i + 0.5) * (len / plankCount);
      const slope = (-8 * 0.6 * lz) / (len * len);
      _q.setFromEuler(_e.set(-Math.atan(slope), 0, 0));
      _m.compose(_p.set(b.x, arch(lz), b.z + lz), _q, _s.set(1, 1, 1));
      planks.setMatrixAt(i, _m);
    }
    const rails = new THREE.Mesh(parts.rails, material);
    rails.position.set(b.x, base + 0.35, b.z);
    add(planks);
    add(rails);
    collisions.addDeck({ x: b.x, z: b.z, hw: width / 2, hd: len / 2 + 0.3, heightAt: (lz) => arch(lz) + 0.07 });
    for (const sx of [-1, 1]) {
      collisions.add({ type: 'box', x: b.x + sx * (width / 2 + 0.1), z: b.z, hw: 0.1, hd: len / 2 - 0.4, bottom: base - 0.2 });
    }
    out.data.bridge = { x: b.x, z: b.z, y: arch(0) };
  }

  // ---- Lighthouse --------------------------------------------------------------
  const lh = makeLighthouse(rng);
  const lhPos = L.lighthouse;
  const lhY = terrain.heightAt(lhPos.x, lhPos.z);
  const lhMesh = new THREE.Mesh(lh.geometry, material);
  lhMesh.position.set(lhPos.x, lhY - 0.3, lhPos.z);
  lhMesh.rotation.y = Math.atan2(-lhPos.x, -lhPos.z); // door faces the island centre
  add(lhMesh);
  for (const c of lh.colliders) {
    const cos = Math.cos(lhMesh.rotation.y);
    const sin = Math.sin(lhMesh.rotation.y);
    collisions.add({ ...c, x: lhPos.x + c.x * cos + c.z * sin, z: lhPos.z - c.x * sin + c.z * cos, ry: lhMesh.rotation.y });
  }
  // Beacon: emissive lantern + a rotating stylised beam (two additive cones).
  const beaconY = lhY - 0.3 + lh.lanternHeight;
  const lanternMat = new THREE.MeshBasicMaterial({ color: '#fff2c0' });
  const lantern = new THREE.Mesh(new THREE.IcosahedronGeometry(0.55, 0), lanternMat);
  lantern.position.set(lhPos.x, beaconY, lhPos.z);
  scene.add(lantern);
  const beamMat = new THREE.MeshBasicMaterial({ color: '#fff0b8', transparent: true, opacity: 0.0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false });
  const beamGeo = new THREE.ConeGeometry(4, 60, 16, 1, true);
  beamGeo.translate(0, -30, 0);
  beamGeo.rotateZ(Math.PI / 2);
  const beam = new THREE.Group();
  const b1 = new THREE.Mesh(beamGeo, beamMat);
  const b2 = new THREE.Mesh(beamGeo, beamMat);
  b2.rotation.y = Math.PI;
  beam.add(b1, b2);
  beam.position.copy(lantern.position);
  scene.add(beam);
  const beaconLight = new THREE.PointLight('#ffe2a0', 0, 40, 1.5);
  beaconLight.position.copy(lantern.position);
  scene.add(beaconLight);
  out.materials.push(lanternMat, beamMat);
  out.beacon = { lantern, lanternMat, beam, beamMat, light: beaconLight };
  out.data.lighthouseDoor = {
    x: lhPos.x + Math.sin(lhMesh.rotation.y) * 3.4,
    z: lhPos.z + Math.cos(lhMesh.rotation.y) * 3.4,
  };

  // ---- Summit cairn ------------------------------------------------------------
  // Find the actual highest grid point near the peak anchor.
  let peak = { x: L.peak.x, z: L.peak.z, y: -Infinity };
  for (let dz = -8; dz <= 8; dz += 1) for (let dx = -8; dx <= 8; dx += 1) {
    const y = terrain.heightAt(L.peak.x + dx, L.peak.z + dz);
    if (y > peak.y) peak = { x: L.peak.x + dx, z: L.peak.z + dz, y };
  }
  const cairn = new THREE.Mesh(makeCairn(rng), material);
  cairn.position.set(peak.x + 1.5, terrain.heightAt(peak.x + 1.5, peak.z), peak.z);
  add(cairn);
  collisions.add({ type: 'circle', x: cairn.position.x, z: cairn.position.z, r: 0.7 });
  out.data.summit = { x: cairn.position.x, z: cairn.position.z, y: cairn.position.y };

  // ---- Spring (stream source) ----------------------------------------------------
  const spring = new THREE.Mesh(makeSpring(createRandom(`${seed}:spring`)), material);
  spring.position.set(L.spring.x, terrain.heightAt(L.spring.x, L.spring.z), L.spring.z);
  add(spring);
  out.data.spring = { x: L.spring.x, z: L.spring.z };

  // ---- Cave ------------------------------------------------------------------------
  const cave = makeCave(createRandom(`${seed}:cave`));
  const cavePos = L.cave;
  const caveY = terrain.heightAt(cavePos.x, cavePos.z);
  // Open towards the path that comes up from the south.
  const caveRy = 0;
  const caveMesh = new THREE.Mesh(cave.geometry, material);
  caveMesh.position.set(cavePos.x, caveY - 0.1, cavePos.z);
  caveMesh.rotation.y = caveRy;
  add(caveMesh);
  for (const c of cave.colliders) collisions.add({ ...c, x: cavePos.x + c.x, z: cavePos.z + c.z });
  const crystalMat = new THREE.MeshLambertMaterial({ vertexColors: true, emissive: '#6a5cff', emissiveIntensity: 0.9, flatShading: true });
  out.materials.push(crystalMat);
  const crystalGeo = makeCrystal(createRandom(`${seed}:crystal`));
  const crystals = new THREE.InstancedMesh(crystalGeo, crystalMat, 6);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + 0.4;
    if (Math.sin(a) > 0.75) { setInstance(crystals, i, cavePos.x - 3, caveY, cavePos.z - 2, a, 0.8); continue; }
    setInstance(crystals, i, cavePos.x + Math.cos(a) * 3.6, caveY, cavePos.z + Math.sin(a) * 3.6 * 0.9 - 0.3, a, 0.7 + (i % 3) * 0.25);
  }
  scene.add(crystals);
  out.meshes.push(crystals);
  const caveLight = new THREE.PointLight('#8f7cff', 6, 11, 1.6);
  caveLight.position.set(cavePos.x, caveY + 2, cavePos.z - 0.5);
  scene.add(caveLight);
  out.cave = { x: cavePos.x, z: cavePos.z, y: caveY, radius: cave.radius, light: caveLight };
  out.data.caveRelic = { x: cavePos.x + 1.6, z: cavePos.z - 1.6 };

  out.dispose = () => {
    for (const m of out.meshes) m.geometry?.dispose();
    for (const m of out.materials) m.dispose();
  };
  return out;
}
