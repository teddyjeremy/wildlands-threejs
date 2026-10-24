import { generateTerrain } from '../procedural/terrain.js';
import { LEVELS } from './levels.js';

// Works out where a level's crossing goes and bakes the islets into the
// terrain. Pure data - shared by the game and the tests.
//
// We generate the island once without islets to find the shoreline along the
// crossing direction, then lay out nodes from the shore outwards: node 0 is
// on land, the last node is the shrine islet, the ones between are small
// stepping-stone islets. Each segment spans node i -> node i+1.

const SEG_LEN = 12;

export function planLevel(index) {
  const level = LEVELS[index];
  if (!level) throw new Error(`no level ${index}`);
  const base = generateTerrain({ seed: level.seed, ...level.terrain });
  const a = level.crossingAngle;
  const dx = Math.cos(a);
  const dz = Math.sin(a);
  let r = 30;
  while (r < 115 && base.isLandAt(dx * r, dz * r)) r += 0.5;
  const coast = r;

  const nodes = [{ x: dx * (coast - 3), z: dz * (coast - 3), r: 0, land: true }];
  const islets = [];
  level.segments.forEach((type, i) => {
    const last = i === level.segments.length - 1;
    const dist = coast + 2 + SEG_LEN * (i + 1) + (last ? 4 : 0);
    const node = { x: dx * dist, z: dz * dist, r: last ? 8 : 4.5, land: false, shrine: last };
    nodes.push(node);
    islets.push({ x: node.x, z: node.z, r: node.r, h: last ? 2.6 : 1.6, shrine: last });
  });

  const keepOut = nodes.map((n) => ({ x: n.x, z: n.z, r: (n.r || 4) + 2 }));
  // Keep the shoreline approach clear too.
  keepOut.push({ x: dx * (coast - 8), z: dz * (coast - 8), r: 4 });

  const terrain = generateTerrain({ seed: level.seed, ...level.terrain, islets, keepOut });

  const segments = level.segments.map((type, i) => {
    const A = nodes[i];
    const B = nodes[i + 1];
    // Bridge ends sit on the edge of each landmass.
    const ax = A.x + dx * (A.land ? 1 : A.r * 0.55);
    const az = A.z + dz * (A.land ? 1 : A.r * 0.55);
    const bx = B.x - dx * B.r * 0.55;
    const bz = B.z - dz * B.r * 0.55;
    // The windmill for a drawbridge stands beside the near end, on dry ground.
    let anchor = null;
    if (type === 'drawbridge') {
      const side = A.land ? 5 : Math.min(2.2, A.r * 0.45);
      const back = A.land ? 3 : 0;
      anchor = { x: A.x - dz * side - dx * back, z: A.z + dx * side - dz * back };
    }
    return {
      id: `${level.id}-seg-${i}`,
      anchor,
      type,
      index: i,
      a: { x: ax, z: az, y: terrain.heightAt(ax, az) },
      b: { x: bx, z: bz, y: terrain.heightAt(bx, bz) },
      from: A,
      to: B,
      angle: a,
    };
  });
  const shrineNode = nodes[nodes.length - 1];
  return {
    index,
    level,
    terrain,
    coast,
    dir: { x: dx, z: dz },
    nodes,
    segments,
    shrine: { x: shrineNode.x, z: shrineNode.z, y: terrain.heightAt(shrineNode.x, shrineNode.z) },
  };
}
