---
name: ona-motion-export
description: Export an approved ona-motion project through MCP, track durable render jobs, handle cancellation and reconnection, and deliver the completed artifact with accurate verification status. Apply to video delivery rather than hosting deployments or scene authoring.
---

# ona-motion export

Carry an authorized export from a known project to a completed video artifact. Use the public MCP interface; server repository access and local encoding commands are not prerequisites for this skill.

## Prepare the export

Discover the live tools and guidance. Inspect the selected project and use `check_environment` to confirm video readiness. Preserve the user's format, language, quality, and sound choices. If a requested visual approval stage remains pending, obtain it before exporting; do not ask again when the user already approved export.

The current `render_video` tool accepts `project`, optional `lang`, `subframes`, and `crf`. Dimensions, timing, and frame rate come from the project. Authorized setting changes use `update_project` with the `configRevision` from `inspect_project`; do not invent render arguments to change them. Existing audio is included automatically; no soundtrack produces a silent export. A consumer cannot currently generate audio or explicitly disable an existing soundtrack through this tool.

`check_environment` distinguishes render readiness, encoded inspection (`canInspectVideo`) and frame extraction (`canExtractVideoFrames`). Missing executables require administrator setup on the server. Report the gap; do not download temporary binaries, change server configuration or silently export via a local CLI. Administrator paths can persist in server workspace configuration, but managing those paths is outside this consumer skill.

## Submit and track

Submit `render_video` once and retain the returned job ID and settings. A queued response is acceptance, not completion. Poll `get_job` at sensible intervals, keeping the user informed during long work; avoid a tight polling loop.

States are currently `queued`, `running`, `cancelling`, `completed`, `failed`, and `cancelled`. Only the final three are terminal. A successful status lookup may report a failed render, so inspect the job state and error as well as the tool response.

If submission or the connection becomes uncertain, inspect the known ID or use `list_jobs` to find a matching recent job before submitting another export. Compare project, options, and submission time; ask when multiple jobs are indistinguishable. Do not cancel unrelated work. Reconnection does not automatically resume interrupted exports; a failed job with `INTERRUPTED` needs a new authorized submission after explaining the failure.

When cancellation is requested, call `cancel_job` for that ID and inspect its resulting state. `cancelling` means cleanup is pending; report cancellation as complete only at a terminal state. On failure, return the actual code and message, identify the relevant remedy, and stop unchanged retries. Missing dependencies require server-side setup; this skill does not grant permission to install them.

## Deliver and verify

For a completed job, return its job ID, project, artifact URI, and available path, size, and render settings. Paths belong to the server's machine and may not be accessible to a remote consumer. Large video resources may exceed the server's read limit; provide the returned reference and explain the access limitation instead of repeatedly reading it.

Use `inspect_video` with the completed `jobId` to measure duration, dimensions, frame rates and audio streams. `countFrames: true` requests a decoded frame count; otherwise the count may come from container metadata or be unavailable. `verifyDecode: true` verifies decoding of the selected video stream. Report its scope accurately; it does not assess sound quality. These operations have a bounded deadline, so omit expensive checks for long videos when needed and state what remains unverified.

Use `extract_video_frames` with the same job ID for a representative encoded contact sheet and targeted transitions or ending frames, and actually inspect the returned images. Preserve actual sample timestamps and artifact resources. If the connection lacks encoded tools or the client cannot inspect images, report that limitation. Source previews do not prove the delivered MP4 is visually correct; successful decoding does not establish smooth playback or sound synchronization.
