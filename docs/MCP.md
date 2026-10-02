# ona-motion MCP server

The local MCP server gives a coding agent tools to create and author projects, render previews, export videos and inspect encoded output. Consumers use public resources and tools without access to the server repository. The CLI and MCP server use the same operations in `lib/`.

## Start here

Install the Node dependencies in this checkout:

```bash
npm install
```

Connect your MCP client by having it launch:

```bash
node /absolute/path/to/ona-motion/ona-mcp.mjs
```

The server defaults to the checkout containing its executable. To select another ona-motion checkout:

```bash
node /absolute/path/to/ona-motion/ona-mcp.mjs --workspace /absolute/path/to/checkout
```

A workspace must contain `engine/`, `templates/`, and the project dependencies. Configure one server per workspace. The server remains attached to its client's stdin/stdout; it closes its browser, encoder and queue when the client disconnects or sends a termination signal.

For clients accepting a `mcpServers` JSON configuration, adapt [client-config.example.json](../mcp/client-config.example.json):

```json
{
  "mcpServers": {
    "ona-motion": {
      "command": "node",
      "args": ["/absolute/path/to/ona-motion/ona-mcp.mjs"]
    }
  }
}
```

Use an absolute Node executable path if the desktop client's PATH does not include Node. Launch the script directly: `npm run mcp` prints npm's own startup text, so it is intended for manual use rather than as a client's protocol command. The executable sends protocol messages to stdout and diagnostics to stderr.

## First session together

1. Call `check_environment` with `{}`. It reports the configured workspace, browser, fonts, Node dependencies, ffmpeg, ffprobe, Python and Python audio libraries.
2. Call `inspect_project` with `{"project":"examples/hello"}`.
3. Call `render_frames` with `{"project":"examples/hello","count":4,"subframes":1}`. Inspect the returned contact sheet. The client must support image content to show the preview.
4. Read `ona-motion://scene-guide`, then create a project with `create_project`, for example `{"name":"launch-teaser","duration":15,"width":1080,"height":1080}`. Use `read_scene` and submit the approved scene source with `update_scene` and its returned revision, then render another contact sheet.
5. Existing `out/audio.wav` is used automatically. MCP audio generation is not available; missing audio produces a silent video.
6. With ffmpeg available, call `render_video` with `{"project":"examples/hello","subframes":1}`. Save the returned `result.id` and call `get_job` with `{"jobId":"<returned UUID>"}` until the job reaches a terminal state.
7. Call `inspect_video` with `{"jobId":"<completed UUID>","countFrames":true,"verifyDecode":true}` to measure the encoded file. Call `extract_video_frames` with the same job ID and `count: 6`, then inspect the returned contact sheet.

A scene is authored in code supplied by the consumer. The MCP interface supports reading and updating scenes and project configuration; consumers do not need the server repository or local filesystem tools. It does not generate audio or run Python sound scripts.

## Authoring through MCP

Read `ona-motion://scene-guide` for the scene contract, timing semantics, example source and authoring sequence. Helper module sources are public resources at `ona-motion://engine/core`, `ona-motion://engine/fx` and `ona-motion://engine/recipes`.

`read_scene` returns the current `source` and SHA-256 `revision`. Send the complete replacement module to `update_scene` with `expectedRevision`. Updates parse JavaScript without executing it, then atomically replace the source. This is syntax validation only: render previews to verify imports, runtime behavior and visuals. Source is limited to 256 KiB. Authoring files must remain inside their own project, including through symlinks.

`inspect_project` returns `configRevision`. Use it as `expectedRevision` in `update_project` to change timing, size, subframes or fonts. The `fonts` object is replaced in full. Scene/audio paths and project identity cannot be changed through this tool.

Stale revisions return `REVISION_CONFLICT`. Read the current file/config and reconcile changes before retrying. After an uncertain response, read back before resubmitting. Updates return the stored source/config and new revision. `PROJECT_BUSY` prevents edits while a frame request or queued/running video job uses that project.

## LOR consumer skills

Four global LOR skills guide agents consuming the public MCP interface:

| Skill | Purpose |
|---|---|
| `ona-motion-consumer` | Discover capabilities, check readiness, inspect projects, and coordinate the requested workflow |
| `ona-motion-storyboard` | Turn a brief into a timed storyboard with exact copy for approval |
| `ona-motion-visual-review` | Inspect contact sheets and selected stills; report issues with playback timestamps |
| `ona-motion-export` | Track export jobs, handle cancellation and reconnection, and deliver artifacts with accurate verification status |

Use LOR's matching workflow with the consumer's current workspace, then load the relevant entry with `get_skill_detail`. Exact lookup uses the canonical name above and `scope: "global"`. Full instructions are stored in LOR; consumers do not need this checkout or an installed local skill to read them through LOR.

The skills discover live tool schemas and report missing capabilities. A consumer can plan, author scenes, inspect, preview and export through MCP. Audio generation remains outside the public interface.

Maintainers can find versioned sources under [`skills/`](../skills/) and registration metadata in [`skills/lor-catalog.json`](../skills/lor-catalog.json). Populate each entry's `skillContext.usageNotes` from its source when registering, and review stored instructions when public capabilities change. Companion relationships can be added after all referenced entries exist.

## Tools

| Tool | Inputs | Result |
|---|---|---|
| `check_environment` | none | Dependency availability and frame/video readiness |
| `create_project` | `name`, optional size, timing, `subframes`, `fonts` | New `examples/<name>` project; existing projects are never overwritten |
| `inspect_project` | `project` | Config and `configRevision`, timing, font and soundtrack availability |
| `read_scene` | `project` | Scene source and revision |
| `update_scene` | `project`, `source`, `expectedRevision` | Stored source and new revision after syntax validation |
| `update_project` | `project`, `config`, `expectedRevision` | Stored config and new revision |
| `render_frames` | `project`, optional `frames` or `times`, `count`, `sheet`, `lang`, `subframes` | PNG previews, frame times, local paths and artifact resources |
| `render_video` | `project`, optional `lang`, `subframes`, `crf` | Durable job ID and initial state |
| `get_job` | `jobId` | State, progress, error or completed video artifact |
| `list_jobs` | optional `limit` (1–20, default 10) | Recent jobs, including records from previous sessions |
| `cancel_job` | `jobId` | Updated state; terminal jobs keep their state |
| `inspect_video` | `jobId` or `project` + `video`; optional `countFrames`, `verifyDecode` | Encoded dimensions, duration, frame rates/count provenance, audio streams and decode status |
| `extract_video_frames` | Same video reference; optional `frames` or `times`, `count`, `sheet` | Encoded PNG stills/contact sheet, actual timestamps and artifact resources |

Project paths are relative to the server's configured workspace. Tools cannot select another workspace or escape it with traversal or external symlinks.

`frames` contains integer frame indices; `times` contains playback seconds. For example:

```json
{"project":"examples/hello","times":[1.25,3.75,8.75],"sheet":false,"subframes":1}
```

Choose either `frames` or `times`. Without either, `count` evenly spaced frames are selected (default 12, maximum 12). `sheet` defaults to true. Images embedded in the tool result are previews, at most 1024 pixels on their longest side. The full-resolution files remain available through paths and resources. Inline image content is capped at 6 MiB per response; additional images are returned as links. Frame requests have a two-minute deadline. Reduce frame count/subframes for heavy 3D scenes, particularly when the client has a shorter timeout.

## Review the encoded video

Both media tools accept **either** a completed `jobId` **or** `project` and `video`. The latter identifies an existing MP4 relative to the project's `out/` folder:

```json
{"project":"examples/motion-in-code","video":"motion-in-code-en.mp4","countFrames":true,"verifyDecode":true}
```

Paths cannot escape the project output folder, including through symlinks. The tools do not open arbitrary server files or remote media URLs. Encoded review does not require Chrome.

`inspect_video` defaults to metadata inspection. `video.frames` includes `frameCountSource`: `container`, `decoded` or `unavailable`. Set `countFrames: true` for a decoded frame count. `verifyDecode: true` runs FFmpeg through the selected video stream with error checking; it does not verify audible quality or audio synchronization. `hasAudio` and `audio` report encoded audio streams, not sound quality. `avgFrameRate` and `rFrameRate` are encoded metadata; they do not independently establish constant frame timing.

`extract_video_frames` defaults to six evenly spaced playback times and a contact sheet. Supply up to twelve explicit `frames` (zero-based indices) or `times`, not both. Time requests select the first encoded frame at or after each requested time; results contain both `requestedTime` and the actual `time`. Near the exclusive end boundary, a request after the final encoded frame returns `FRAME_NOT_FOUND`; use the last frame index when known. Samples remain in request order, including duplicate requests. The source manifest identifies `kind: "encoded-video"`, the source file and its job ID when supplied.

Stills preserve full resolution. Embedded previews fit within 1024 pixels; contact sheets use smaller tiles with separate full-size still resources. Only the contact sheet is embedded when `sheet: true`. Review outputs share the existing frame resource namespace and persist across reconnects. Failed extraction removes its unregistered output directory.

One encoded review runs at a time; overlapping requests return `MEDIA_BUSY`. Each request has a two-minute deadline and honors MCP cancellation and server shutdown. Reduce sample count or omit decoding/counting for long videos. File inspection and sampled stills cannot establish smooth motion through playback.

## Results and artifacts

Successful tool calls include both a text JSON result and `structuredContent`:

```json
{"ok":true,"result":{"project":"examples/hello"}}
```

Operation failures use `isError: true` and an actionable error:

```json
{"ok":false,"error":{"code":"MISSING_BROWSER","message":"...","details":{}}}
```

Malformed arguments are rejected by the MCP SDK's schema validation. `get_job` returns a successful status lookup even when the underlying render failed; inspect `result.status` and `result.error`.

Resources:

- `ona-motion://guide`: compact workflow guidance.
- `ona-motion://scene-guide`: authoring contract, timing and example source.
- `ona-motion://engine/{module}`: helper sources (`core`, `fx`, `recipes`).
- `ona-motion://frames/<renderId>/<filename>`: full PNG stills and contact sheets.
- `ona-motion://jobs/<jobId>/video`: a completed MP4.

Artifact reads are capped at 6 MiB of binary data to fit the stdio message buffer after base64 encoding. Larger artifacts can be opened directly using the returned local file path. A video resource provides bytes; playback/display depends on the client.

Each operation writes unique output folders:

```text
<project>/out/mcp/frames/<renderId>/
<project>/out/mcp/jobs/<jobId>/video.mp4
<workspace>/out/.ona-motion/frames/       persisted artifact manifests
<workspace>/out/.ona-motion/jobs/         persisted job records
<workspace>/out/.ona-motion/server.lock  active server ownership
```

These files are git-ignored. Video encoding uses a temporary MP4 and publishes the final path only after ffmpeg succeeds. Failed/cancelled exports remove their temporary MP4. Frame requests can leave partial stills if interrupted; such files are not registered as completed artifacts.

## Job lifecycle

Exports run sequentially: `queued → running → completed | failed`. Cancelling a queued job changes it to `cancelled`; cancelling active work changes it to `cancelling`, then `cancelled` after browser/encoder cleanup. Exports have a 30-minute deadline; a deadline produces a `failed` job with `TIMEOUT`.

Records survive server restarts. Unfinished jobs become `failed` with `INTERRUPTED`; they are never silently replayed. Completed jobs and frame resources remain accessible while their local artifacts exist. Use `list_jobs` to rediscover IDs. Keep project files unchanged while an export is queued or running.

The queue retains at most 200 job records. Once full, stop the server and archive old generated job records/artifacts before submitting more work. No automatic deletion or expiration is performed. A second server using the same workspace receives `WORKSPACE_BUSY`; use the existing connection or close it first.

This version uses ordinary MCP tools for job submission, polling and cancellation. It does not require experimental/native MCP Tasks support.

## Prerequisites and overrides

### Persistent encoder setup

Administrators can copy existing FFmpeg and FFprobe executables into ignored workspace storage:

```bash
node ona-setup.mjs --ffmpeg /path/to/ffmpeg --ffprobe /path/to/ffprobe
```

The setup command validates both copied executables, then atomically publishes `.ona-motion.local.json`. Binaries live in `.ona-motion/bin/<installationId>/`; these machine-specific files are never committed. It does not download binaries. On Windows, keep any required adjacent DLLs available or use an external installation through the configuration below. Reinstalling preserves earlier installations for in-flight processes.

Alternatively, create `.ona-motion.local.json` with absolute executable paths or paths relative to the workspace:

```json
{"ffmpeg":"/persistent/path/to/ffmpeg","ffprobe":"/persistent/path/to/ffprobe"}
```

Resolution order is `FFMPEG_PATH` / `FFPROBE_PATH`, workspace configuration, then PATH. CLI exports, MCP exports and media review use the same resolver. No temporary shell environment is needed. After a server code update, reconnect the MCP client to load new tools. Call `check_environment` to see executable paths, their resolution source and readiness; `render_video` rejects a missing encoder before submitting a job.

`canRenderVideo` covers browser rendering and FFmpeg availability. `canInspectVideo` requires FFprobe; `canExtractVideoFrames` requires both media executables. These flags report prerequisite availability, not a completed render or successful media review.

- Node 18+ and `npm install` in the checkout.
- Chrome, Chromium, Edge, or Brave on macOS; browser paths for Windows/Linux follow the existing Chrome/Chromium/Edge discovery. Override with `CHROME_PATH`.
- ffmpeg for MP4 export; ffprobe for checking encoded output. Overrides: `FFMPEG_PATH`, `FFPROBE_PATH`.
- Python 3.10+ with `numpy` and `scipy` for sound scripts (`pip install -r requirements.txt`). Override the environment check's Python executable with `PYTHON_PATH`.

MCP clients can provide these variables in their server environment configuration. Paths should name executables, not shell command strings. Contact sheets are assembled in the browser and do not require ffmpeg.

The server is intended for trusted local projects. Scene JavaScript runs in the browser and can access the network. Remote hosting and isolated execution workers are outside this version.

## Implementation checks

```bash
npm test

# Optional: uses the real browser and writes ignored artifacts in examples/hello/out/
ONA_RENDER_CHECK=1 node --test tests/render-integration.test.mjs
```

The default checks cover workspace containment, project validation, frame selection, job ordering/cancellation/deadlines/recovery, artifact access, and the actual stdio MCP handshake/tool/resource contracts. The opt-in check renders images through MCP. These checks do not establish that an MP4 export or a soundtrack works on a machine without those prerequisites.

The server uses the [official MCP TypeScript SDK](https://ts.sdk.modelcontextprotocol.io/), its [stdio server transport](https://raw.githubusercontent.com/modelcontextprotocol/typescript-sdk/v1.x/docs/server.md), and standard tool image/resource results.
