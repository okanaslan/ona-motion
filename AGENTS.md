# ona-motion: notes for coding agents

Motion graphics videos written as code. A **project** is a folder with `project.json`, `scene.js` and optionally `sound.py`. The output goes to `<project>/out/` (git-ignored).

## Commands

```bash
node ona.mjs new <name>                     # scaffold examples/<name> from templates/blank
node ona.mjs preview examples/<name>        # live player (space, ←/→, shift, b = motion blur)
node ona.mjs sheet examples/<name> 16       # contact sheet → out/sheet.png   ← look at it
node ona.mjs stills examples/<name> 1.5s,4s # full-size stills → out/stills/
python examples/<name>/sound.py            # → out/audio.wav (prints LUFS / true peak)
node ona.mjs render examples/<name> [--lang en]   # → out/<name>[-en].mp4
node ona-mcp.mjs [--workspace /path/to/checkout] # local MCP server (stdio)
npm test                                  # project, job and MCP contract checks
```

Requirements: Node 18+, Python 3.10+ with numpy and scipy, ffmpeg on PATH, and Chrome, Chromium, Edge or Brave on macOS installed (or `CHROME_PATH`).

## Scene contract

- `export default { setup?(api), draw(ctx, t, api), post?(ctx, t, api) }`.
- `draw` paints the **entire** frame at scene time `t` and must be a pure function of `t`. No `Math.random`, `Date`, timers or accumulated state; use `hash()` and `noise1()`.
- `api`: `W, H, fps, duration, lang, bpm, beat, bar, step, at(bar, step), frameT`. `frameT` is the un-blurred time of the frame being rendered: use it (not `t`) for counters and anything that must stay sharp under motion blur; `post()` receives it as `t`.
- Import helpers from `../../engine/core.js`. Don't copy them into scenes.
- Put all copy in a per-language dictionary at the top of `scene.js`, keyed by `api.lang`.
- Put time constants on the beat grid (`api.at(bar, step)` or multiples of `api.step`).

## Working agreement

- Before building a video from a brief, follow `prompts/VIDEO_BRIEF.md`: research → concepts → storyboard, then **wait for approval**.
- After every meaningful change, render a sheet or stills and **look at them** before moving on. Check text clipping (descenders and diacritics), overlaps, legibility at phone size and logo fidelity.
- Don't invent claims, metrics or testimonials. List every placeholder (names, prices) in your report.
- Sound: every visual event gets a sound on the same timeline; aim for about -14 LUFS and ≤ -1 dBFS.
- When retiming or restyling an existing example, look for what the change does not reach on its own: absolute seconds in `sound.py`, numbers quoted in copy (frame counts, durations, BPM labels), helper defaults such as `accent`. Render a sheet and read the end card. `examples/edit-demo` shows one such round with its real diff.
- Never commit anything under `out/`, rendered media or `node_modules/`.
- MCP setup and the first connected session are documented in `docs/MCP.md`. Launch `ona-mcp.mjs` directly from MCP clients so stdout contains only protocol messages.
- Keep CLI and MCP operations in the shared `lib/` modules. MCP callers use project paths relative to the configured workspace; validate traversal and symlinks before reading or writing.
- Video jobs have durable IDs and unique output directories. Preserve cancellation cleanup and terminal states; do not silently restart interrupted renders.

## Map

- `engine/core.js`: math, easing, springs, type layout, shapes, dot fields, 3D projection, morphing, particles, glass, chromatic split, the motion-blur runtime (`boot`).
- `engine/fx.js`: transitions (`transition`: skew / bars / disc wipes), `flash`, `shockRing`, `glitch`, `aberrate`, `bloom`, `hud`, `windowFrame`, `typeCode`, `fitFont`. Draw transitions after the scene; call `glitch` last in `draw`; call `hud`, `bloom` and `aberrate` from `post`.
- `engine/recipes.js`: `tunnel` + `surge`, `dotSphere`, `easingGraph`, `rippleDots`.
- `engine/three.js`: three.js bridge (`createGL`, `toon`, `ink`, `Sweep`). 3D scenes build the world in `setup` and re-pose every object from `t` in `draw`; `three` and `three/addons/` resolve through the import map in `player.html`.
- `engine/brand.js`: brand kit for brandable scenes (`brandApi`: palette from three colours with contrast-picked text, safe area per aspect ratio, `fit` / `fitLines`, logo or monogram, `samplePoints`, `drawAsset`).
- `engine/player.html`: loads a project's fonts and scene; used by both preview and render.
- `ona.mjs`: CLI adapter for shared project and rendering operations.
- `lib/`: project validation, workspace containment, environment checks, preview server, frame rendering and video encoding.
- `ona-mcp.mjs`: stdio MCP entry point; defaults to this checkout, with an optional `--workspace`.
- `mcp/`: validated tools, artifact resources, durable render queue and cancellation.
- `docs/MCP.md`: setup, tool contracts, resources, job lifecycle and the first connected session.
- `tests/`: focused project, job, artifact and stdio contract checks; real MCP rendering is opt-in with `ONA_RENDER_CHECK=1`.
- `audio/onasynth.py`: synthesis, timeline mixer, reverb, sidechain, mastering.
- `audio/onaextras.py`: `stamp`, `counter_ticks`, `echo`, `glitch_burst`, `tick`, `tom`.
- `examples/hello/`: reference scene using most techniques.
- `examples/reel/`: 15 s, 128 BPM showcase of `fx.js` and `recipes.js` (wipes, glitch, tunnel, dot sphere, easing graph, typed code with a preview inside a preview), `sound.py` with `onaextras`; TR / EN.
- `examples/edit-demo/`: 30 s, 4:5 side-by-side of an edit request, its real `git diff` (`case/change.patch`) and the BEFORE / AFTER renders of `examples/reel`. `scene.js` draws the panel from `case/`, `compose.mjs` overlays the two videos, `sound.py` scores the panel.
- `examples/cat-crossing/`: three.js cartoon short (cel shading, ink lines, character rig, traffic, shot list).
- `examples/chat-commerce/`, `examples/motion-principles/`: brandable 20 s promos (ported from ft-studio templates): copy in `COPY`, brand in `BRAND`, layout against `brandApi().fmt.safe`, 15 s choreography played at `speed` 0.75.
- `docs/TECHNIQUES.md`: recipes, with pointers into the example.
- `docs/sound-and-tempo.html`: standalone interactive explainer (EN default, TR toggle) of how `onasynth` builds each sound and how scenes lock to the beat grid. Copy lives in the `I` dictionary; the DSP mirrors `audio/onasynth.py`, so change both together.
