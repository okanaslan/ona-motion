# ona-motion MCP server

The local MCP server gives a coding agent tools to create projects, inspect their configuration, render images, and export videos. The CLI and MCP server use the same operations in `lib/`.

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
4. Create a project with `create_project`, for example `{"name":"launch-teaser","duration":15,"width":1080,"height":1080}`. Edit `examples/launch-teaser/scene.js` using the client's filesystem tools, then render another contact sheet.
5. For a soundtrack, run the project's `sound.py` locally. It creates `out/audio.wav`, which video exports use automatically. Missing audio produces a silent video.
6. With ffmpeg available, call `render_video` with `{"project":"examples/hello","subframes":1}`. Save the returned `result.id` and call `get_job` with `{"jobId":"<returned UUID>"}` until the job reaches a terminal state.

A scene is authored in code. This version expects the connected coding agent to have local filesystem tools for editing scenes, configuration, and sound scripts. The server supplies project and rendering operations; it does not generate scene code or run Python sound scripts.

## Tools

| Tool | Inputs | Result |
|---|---|---|
| `check_environment` | none | Dependency availability and frame/video readiness |
| `create_project` | `name`, optional `width`, `height`, `fps`, `duration`, `bpm`, `speed` | New `examples/<name>` project; existing projects are never overwritten |
| `inspect_project` | `project` | Config, frame count, playback/scene duration, font and soundtrack availability |
| `render_frames` | `project`, optional `frames` or `times`, `count`, `sheet`, `lang`, `subframes` | PNG previews, frame times, local paths and artifact resources |
| `render_video` | `project`, optional `lang`, `subframes`, `crf` | Durable job ID and initial state |
| `get_job` | `jobId` | State, progress, error or completed video artifact |
| `list_jobs` | optional `limit` (1–20, default 10) | Recent jobs, including records from previous sessions |
| `cancel_job` | `jobId` | Updated state; terminal jobs keep their state |

Project paths are relative to the server's configured workspace. Tools cannot select another workspace or escape it with traversal or external symlinks.

`frames` contains integer frame indices; `times` contains playback seconds. For example:

```json
{"project":"examples/hello","times":[1.25,3.75,8.75],"sheet":false,"subframes":1}
```

Choose either `frames` or `times`. Without either, `count` evenly spaced frames are selected (default 12, maximum 12). `sheet` defaults to true. Images embedded in the tool result are previews, at most 1024 pixels on their longest side. The full-resolution files remain available through paths and resources. Inline image content is capped at 6 MiB per response; additional images are returned as links. Frame requests have a two-minute deadline. Reduce frame count/subframes for heavy 3D scenes, particularly when the client has a shorter timeout.

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
