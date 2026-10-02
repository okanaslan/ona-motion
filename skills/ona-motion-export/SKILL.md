---
name: ona-motion-export
description: Export an approved ona-motion project through MCP, track durable render jobs, handle cancellation and reconnection, and deliver the completed artifact with accurate verification status. Apply to video delivery rather than hosting deployments or scene authoring.
---

# ona-motion export

Carry an authorized export from a known project to a completed video artifact. Use the public MCP interface; server repository access and local encoding commands are not prerequisites for this skill.

## Prepare the export

Discover the live tools and guidance. Inspect the selected project and use `check_environment` to confirm video readiness. Preserve the user's format, language, quality, and sound choices. If a requested visual approval stage remains pending, obtain it before exporting; do not ask again when the user already approved export.

The current `render_video` tool accepts `project`, optional `lang`, `subframes`, and `crf`. Dimensions, timing, and frame rate come from the project. Do not invent unsupported render arguments to change them. If the requested configuration or sound is unavailable, report the missing operation. Existing audio is included automatically; no soundtrack produces a silent export. A consumer cannot currently generate audio or explicitly disable an existing soundtrack through this tool.

## Submit and track

Submit `render_video` once and retain the returned job ID and settings. A queued response is acceptance, not completion. Poll `get_job` at sensible intervals, keeping the user informed during long work; avoid a tight polling loop.

States are currently `queued`, `running`, `cancelling`, `completed`, `failed`, and `cancelled`. Only the final three are terminal. A successful status lookup may report a failed render, so inspect the job state and error as well as the tool response.

If submission or the connection becomes uncertain, inspect the known ID or use `list_jobs` to find a matching recent job before submitting another export. Compare project, options, and submission time; ask when multiple jobs are indistinguishable. Do not cancel unrelated work. Reconnection does not automatically resume interrupted exports; a failed job with `INTERRUPTED` needs a new authorized submission after explaining the failure.

When cancellation is requested, call `cancel_job` for that ID and inspect its resulting state. `cancelling` means cleanup is pending; report cancellation as complete only at a terminal state. On failure, return the actual code and message, identify the relevant remedy, and stop unchanged retries. Missing dependencies require server-side setup; this skill does not grant permission to install them.

## Deliver and verify

For a completed job, return its job ID, project, artifact URI, and available path, size, and render settings. Paths belong to the server's machine and may not be accessible to a remote consumer. Large video resources may exceed the server's read limit; provide the returned reference and explain the access limitation instead of repeatedly reading it.

Distinguish configured properties from measured export properties. The current MCP interface has no dedicated encoded-video validation or frame-extraction operation. If an available client capability can inspect the encoded artifact, verify duration, dimensions, frame rate, and requested audio, and visually inspect representative encoded frames. Otherwise report export completion while marking encoded-media checks as unverified. Source-frame previews do not prove the encoded MP4 is visually correct, and an existing audio file does not establish audible quality.
