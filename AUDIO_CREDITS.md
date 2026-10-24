# Audio credits

WILDLANDS ships **no audio files**. Every sound is synthesised at runtime with
the Web Audio API in [`src/systems/audio.js`](src/systems/audio.js). I wrote all
of it for this project, so there is nothing third-party to attribute and no
license to track. `public/audio/` is intentionally absent.

If recorded sounds are added later, each file gets an entry here with: path,
title, creator, source URL, license and version, required attribution, access
date and any edits.

| Cue | Where it plays | How it's made | Source / license |
| --- | --- | --- | --- |
| Wind bed | Everywhere, louder up high and at the lighthouse | Looped brown noise -> band-pass ~380 Hz | Original, synthesised (MIT with the code) |
| Sea bed | Coast, volume rises with distance from the island centre | Brown noise -> low-pass ~520 Hz, cutoff swept by a 0.12 Hz LFO for a wave swell | Original, synthesised |
| Rain bed | Fades in/out with rain intensity, muffled in the cave | White noise -> high-pass 1.4 kHz | Original, synthesised |
| Forest bed | Forest region, quiet, off during rain | White noise -> narrow band-pass 5.2 kHz (insect hiss) | Original, synthesised |
| Cave bed + drips | Inside the hollow | Brown noise -> low-pass 160 Hz; drips are short sine drops | Original, synthesised |
| Bird calls | Random every 4-13 s, not at night, in rain or in the cave | 2-4 short rising sine chirps | Original, synthesised |
| Footsteps | Each stride; grass / sand / rock / path / wood / water | Short band-passed noise burst, filter and length per surface | Original, synthesised |
| Jump / land | Jump and hard landings | Noise burst | Original, synthesised |
| Hare alarm | When a hare starts to flee, attenuated by distance | Noise rustle + short squeak | Original, synthesised |
| Collect chime | Picking up a trinket | Three stacked triangle/sine tones | Original, synthesised |
| Discovery | New notebook entry | Rising C-E-G sine arpeggio | Original, synthesised |
| UI | Start, pause, notebook open/close | Short triangle sweeps | Original, synthesised |

Notes:

- Noise buffers are generated once on start; loop points are crossfaded so the beds don't click.
- The audio context is created only after the Start button is pressed, and fades in over about a second.
- Master, ambience and effects volumes plus mute live in the pause menu; pausing or hiding the tab ducks the master bus and it fades back in on resume.
