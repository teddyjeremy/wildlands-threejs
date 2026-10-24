import { createRandom } from './random.js';

// Hand-authored island plan. The procedural generators fill in the detail,
// but where the village or the lighthouse sits is a design decision, so the
// anchors live here and only get a small seeded nudge.

export const SEA_LEVEL = 0;

export const DEFAULT_CONFIG = Object.freeze({
  seed: 'wildlands',
  vegetationSeed: null, // falls back to `${seed}:veg`
  size: 240, // extent of the height grid in world units (~metres)
  resolution: 180, // grid cells per side
  radius: 92, // nominal island radius before the coastline wobble
  maxHeight: 24, // height of the central ridge above the base land
  coastIrregularity: 0.16,
  noiseAmplitude: 2.0,
  mountain: { x: 2, z: -16 },
});

export function createLayout(config) {
  const rng = createRandom(`${config.seed}:layout`);
  const j = (v, amt = 2.5) => v + rng.range(-amt, amt);
  const m = config.mountain;

  const layout = {
    cove: { x: j(8), z: j(62, 1.5), r: 20 },
    village: { x: j(-38), z: j(28), r: 19, height: 3.4 },
    forest: { x: j(40), z: j(10), r: 27 },
    peak: { x: m.x, z: m.z, sigma: 21 },
    wetland: { x: j(-54, 2), z: j(-14, 2), r: 15, height: 1.9 },
    lighthouse: { x: 60, z: -58, r: 12 },
    cave: { x: j(-24, 1.5), z: j(-44, 1.5), r: 9 },
  };

  // Stream: from a spring on the mountain's western flank, through the
  // wetland, out to the western shore. Ordered downhill.
  layout.stream = [
    [m.x - 15, m.z - 4],
    [-26, -20],
    [-40, -17],
    [layout.wetland.x + 2, layout.wetland.z - 1],
    [-68, -8],
    [-96, -2],
  ];
  layout.spring = { x: layout.stream[0][0], z: layout.stream[0][1] };
  layout.bridge = { x: -40, z: -17.5, angle: 0, length: 9, width: 2.4 };

  // Footpaths between landmarks (waypoints get snapped to terrain later).
  const v = layout.village;
  const c = layout.cove;
  const f = layout.forest;
  layout.paths = [
    [[c.x, c.z - 2], [-8, 52], [-24, 40], [v.x + 6, v.z + 4]],
    [[v.x + 8, v.z - 2], [-10, 30], [16, 24], [f.x - 10, f.z + 4]],
    [[c.x + 4, c.z - 4], [24, 46], [f.x - 4, f.z + 14]],
    [[v.x - 2, v.z - 10], [-44, 4], [-41, -10], [-40, -24], [-34, -36], [layout.cave.x - 2, layout.cave.z + 6]],
    [[f.x + 4, f.z - 8], [54, -14], [58, -36], [layout.lighthouse.x - 4, layout.lighthouse.z + 8]],
    [[-10, 30], [-14, 14], [-6, 2], [-8, -8], [m.x - 2, m.z + 2]],
  ];

  // Wetland depressions where rain collects.
  layout.pools = [0, 1, 2].map((i) => {
    const a = (i / 3) * Math.PI * 2 + rng.range(-0.4, 0.4);
    const d = rng.range(5, 8);
    return {
      id: `pool-${i}`,
      x: layout.wetland.x + Math.cos(a) * d,
      z: layout.wetland.z + Math.sin(a) * d,
      r: rng.range(3.2, 4.4),
    };
  });

  layout.keepOut = config.keepOut || [];
  layout.start = { x: c.x, z: c.z, heading: Math.PI };
  return layout;
}
