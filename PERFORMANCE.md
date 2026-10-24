# Performance notes

Everything below was measured, and I've written down where. I still don't have a GPU-backed
browser for testing, so there is **no real-hardware FPS figure here**. The frame times come from
a software rasteriser and only show how the presets scale against each other.

## Test setup

- Machine: 8-core Intel Xeon (cloud VM), no GPU
- Browser: headless Chrome with WebGL via ANGLE + SwiftShader (software rasteriser)
- Viewport 1280x720, Verdant Isle (island 1), clear weather, player standing in the meadow at
  (0, 40) looking north, camera distance 8, lantern unlit
- Script: `npm run build && npm run measure` (`tests/smoke/measure.mjs`), counters read from
  `renderer.info` after ~8 s. `renderer.info` is reset once per frame now, so the counts include
  every pass of the post stack and the shadow map.

## Results (24 Oct 2026, Seasonkeeper / v2)

| Preset | Draw calls | Triangles | Geometries | Shader programs | Frame time (SwiftShader) |
| --- | --- | --- | --- | --- | --- |
| low | 37 | 193.8k | 89 | 24 | ~140 ms (~7 fps) |
| medium | 120 | 480.0k | 96 | 57 | ~403 ms (~2.5 fps) |
| high | 128 | 715.1k | 102 | 57 | ~547 ms (~1.8 fps) |

For comparison, v1 measured 34 / 34 / 34 draw calls and 125k / 177k / 254k triangles, but
v1's counter only saw the last render call of the frame, so the draw calls aren't directly
comparable. Most of the medium/high jump is the post stack (bloom is several small full-screen
passes) and the shadow pass drawing the props a second time. The triangle growth is the
grass: blades are now curved, two-segment strips (12 triangles a clump instead of 3) and there
are more clumps.

Other measured numbers (Node 20 on the same VM):

- Planning an island (two terrain passes on the 225x225 grid, islets baked in): ~120-190 ms
- Grass placement for 48k candidates: ~260 ms
- Load to title in the production build: 0.6-0.75 s
- Rebuilding the world when you sail: same as above plus shader compile, hidden behind the fade
- Production bundle: app 197 kB (68 kB gzip), three.js chunk 515 kB (131 kB gzip), CSS 9.4 kB

## What the presets change

| Knob | low | medium | high |
| --- | --- | --- | --- |
| Pixel ratio cap | 1 | 1.5 | 2 |
| Sun shadows (soft PCF) | off | 1024 map | 2048 map |
| Post stack (bloom, grade, vignette) | off, renders straight to screen | on | on |
| Grass clumps | 5,000 | 24,000 | 48,000 |
| Particles (max) | 250 | 900 | 1,600 |
| Rain streaks (max) | 500 | 1,200 | 2,400 |
| Flowers | 300 | 600 | 900 |
| Active hares | 2 | 3 | 4 |
| Fog far plane | 190 | 240 | 280 |
| MSAA | off | on | on (only applied at page load) |

Low is meant to stay playable on weak machines: no shadows, no post-processing, a fifth of the
high grass, and the same gameplay. The season tint, ice shader and particles still run on low
because the puzzles need you to see them.

## Why the draw-call count stays manageable

- Trees, rocks, flowers, grass, vine planks, causeway stones and thornwall bushes are all
  `InstancedMesh`es. A whole vine bridge is three draw calls however long it is.
- Houses, lighthouse, cave, dock, windmill, shrine stones and the boat are merged into
  vertex-coloured geometry, one draw call per piece.
- Particles are one recycled pool split over two `Points` draws (additive glow and normal).
- The season effect isn't extra geometry: it's a shared GLSL chunk in the existing terrain,
  grass, foliage and prop materials, fed by one set of uniforms.

## Bounded work per frame

- The season field is a few uniforms and an `O(1)` weight function; each puzzle samples it once
  at its anchor.
- Frost uses the trail grid's active list. Only water cells inside an ice crossing's corridor
  can ever freeze (everything else is classed as rock and ignored), and melting is the normal
  budgeted regrowth. The frost texture uploads at most ~12 times a second, and only when it
  changed.
- The trail grid is now 400x400 cells (the islands are bigger), but regrowth still only visits
  active cells, capped at 4,000 a frame. Grass instances are refreshed only in a ~26 m radius.
- Wildlife decisions run at 20 Hz and only within 70 m of the player.
- The simulation step is fixed at 60 Hz and the frame delta is capped at 100 ms.
- Sailing disposes the whole previous island (geometry, materials, textures, shadow map) before
  building the next one, so memory doesn't grow as you travel.

## Known caveats

- The grass vertex shader is the most likely cost on real GPUs at pixel ratio 2 (wind, gusts,
  player push and the season tint all run per vertex). That's the first thing I'd profile.
- Height fog needs the camera-to-world transform per vertex (`inverse(viewMatrix)`), which is
  wasteful. Passing the camera matrix as a uniform would be cheaper.
- Toggling shadows or the quality preset recompiles every material, which causes a one-off
  hitch.
- Not profiled on mobile GPUs. Low is the suggested default for touch devices and machines with
  4 or fewer cores.
