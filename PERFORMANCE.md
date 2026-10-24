# Performance notes

Everything below was measured, and I've written down where. I don't have a
GPU-backed browser available for this round of testing, so there is **no
real-hardware FPS figure here yet**. Please don't read the numbers below as one.

## Test setup

- Machine: 8-core Intel Xeon (cloud VM), no GPU
- Browser: headless Chrome 156 with WebGL via ANGLE + SwiftShader (software rasteriser)
- Viewport 1280x720, scene: clear weather, player standing in the meadow north of the village (0, 40) looking north, camera distance 8
- Script: `npm run build && npm run measure` (`tests/smoke/measure.mjs`), counters read from `renderer.info` after ~8 s

## Results (24 Oct 2026)

| Preset | Draw calls | Triangles | Geometries | Shader programs | Frame time (SwiftShader) |
| --- | --- | --- | --- | --- | --- |
| low | 34 | 125.5k | 79 | 17 | ~101 ms (~10 fps) |
| medium | 34 | 177.1k | 85 | 20 | ~244 ms (~4 fps) |
| high | 34 | 254.0k | 91 | 20 | ~352 ms (~3 fps) |

The frame times are the CPU rasteriser's cost, so they mostly show how the
presets *scale* relative to each other. Triangle count and draw calls are the
same on any device.

Other measured numbers (Node 20 on the same VM):

- Terrain generation (180x180 grid, all shaping passes): ~60 ms
- Placement (houses, trees, rocks, 26k grass, flowers): ~175 ms
- Load to title screen in the production build: 0.5-1.2 s depending on preset
- Production bundle: app 119.5 kB (43.5 kB gzip), three.js chunk 514.6 kB (130.7 kB gzip), CSS 7.2 kB

## Why the draw-call count stays low

- Trees: 3 families x 3 geometric variants, each an `InstancedMesh` (243 trees in 9 draw calls).
- Rocks: 4 kinds x 3 variants, instanced. Flowers: one instanced mesh with per-instance colour.
- Grass: a single `InstancedMesh` of crossed-blade clumps (7k / 15k / 26k by preset). The trail
  flattening is a per-instance float attribute; wind is done in the vertex shader.
- Houses, lighthouse, cave, dock: each prop is built from primitives and merged into **one**
  vertex-coloured geometry, so a house is one draw call instead of ~20.
- One shared flat-shaded Lambert material for nearly all props.

## What the presets change

| Knob | low | medium | high |
| --- | --- | --- | --- |
| Pixel ratio cap | 1 | 1.5 | 2 |
| Sun shadows | off | 1024 map | 2048 map |
| Grass clumps | 7,000 | 15,000 | 26,000 |
| Rain streaks (max) | 500 | 1,200 | 2,400 |
| Flowers | 300 | 600 | 900 |
| Active hares | 2 | 3 | 4 |
| Fog far plane | 190 | 240 | 280 |
| MSAA | off | on | on (only applied at page load) |

## Bounded work per frame

- The trail grid is 320x320 cells, but regrowth only visits cells in the *active list*
  (cells with any disturbance), capped at 4,000 per frame. Grass instances are refreshed only
  in a ~26 m radius around the player, at most 10 times a second.
- Wildlife decisions run at a fixed 20 Hz and only within 70 m of the player.
- Rain is a fixed pool of line segments that gets recycled. Nothing is allocated while it runs.
- The simulation step is fixed at 60 Hz and the frame delta is capped at 100 ms, so a slow frame
  makes the game run slower instead of making things jump.

## Known caveats

- Shadow-casting grass is off on purpose. Grass only receives shadows.
- Toggling shadows at runtime forces every material to recompile, which causes a one-off hitch.
- I haven't profiled on a mobile GPU. Low is the suggested default for touch devices and
  machines with 4 or fewer cores.
- Next thing to measure on real hardware: how the grass vertex shader cost scales with clump
  count at a pixel ratio of 2. It's the obvious suspect for the high preset.
