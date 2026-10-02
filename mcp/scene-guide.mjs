export const SCENE_GUIDE = `# Author a scene through ona-motion MCP

Create a project, then read_scene to obtain its source and SHA-256 revision.
Submit the complete ES module with update_scene and expectedRevision. Syntax is checked without executing the module. Imports and the scene contract are verified when you render preview frames.
REVISION_CONFLICT means read_scene again and reconcile; do not overwrite newer work blindly. After an uncertain update, read_scene before retrying.
inspect_project returns configRevision; update_project accepts that revision to update size, timing, subframes or fonts. Fonts replaces the full fonts object.
PROJECT_BUSY means a preview or queued/running export uses the project; wait for it to finish or cancel the requested export before editing.

Scene contract: export default { setup?(api), draw(ctx, t, api), post?(ctx, t, api) }.
draw paints the entire Canvas 2D frame as a pure function of scene time t. Avoid random numbers, wall-clock time, timers and accumulated animation state. Use seeded hash/noise helpers.
api: W, H, fps, duration, lang, bpm, beat (60/bpm), bar (240/bpm), step (15/bpm), at(bar, step=0), frameT.
t is scene time: playback seconds multiplied by project speed. API duration is also scaled by speed. Preview requests use playback seconds.
frameT is the unblurred scene time; use it for counters or draw them in post(ctx, frameT, api) so they remain sharp under motion blur.
For examples/<name>/scene.js import helpers from '../../engine/core.js', '../../engine/fx.js' or '../../engine/recipes.js'. For an existing project use the scene path returned by read_scene to determine the relative import depth. Engine module sources are public resources at ona-motion://engine/core, ona-motion://engine/fx and ona-motion://engine/recipes; read only the modules needed.
Keep copy in a language dictionary keyed by api.lang. Keep visual events on the beat grid using api.at or api.step. Fit typography to the canvas and leave safe margins.

Example (replace the placeholder copy with approved copy):
import { rgba, prog, EASE, setFont } from '../../engine/core.js';
const COPY = { en: 'Your approved title' };
export default {
  draw(ctx, t, api) {
    ctx.fillStyle = rgba([16,17,20]); ctx.fillRect(0,0,api.W,api.H);
    const p = EASE.expo(prog(t,0,api.at(0,4)));
    ctx.save(); ctx.globalAlpha = p;
    setFont(ctx,700,api.W * 0.06,'Inter'); ctx.textAlign = 'center';
    ctx.fillStyle = rgba([245,241,232]);
    ctx.fillText(COPY[api.lang] ?? COPY.en,api.W/2,api.H/2 + (1-p)*api.H*0.05);
    ctx.restore();
  }
};

Use render_frames to inspect a contact sheet and targeted transition stills after meaningful changes. Then export the approved scene with render_video and poll get_job.
The server does not generate audio. Existing out/audio.wav is used automatically; otherwise video export is silent.
Scene code runs in the browser and may access the network. Authoring does not run arbitrary server-side commands or Python scripts.`;
