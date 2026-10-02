---
name: ona-motion-consumer
description: Use ona-motion through MCP to author scenes, inspect projects, preview animations, and coordinate encoded-video delivery from any consumer workspace. Server implementation and MCP registration are separate workflows.
---

# ona-motion consumer

Help the user complete the requested video task using the connected ona-motion server. Obtain guidance through its public interface; a consumer does not need the server's repository, internal documentation, shell commands, or machine-specific paths.

## Discover and assess

1. Discover the available ona-motion tools and resources using the client's supported discovery mechanism. Reuse recent discovery in the same connection. Tool schemas and server guidance take precedence over this skill's version-specific examples.
2. Read the advertised workflow resource, currently `ona-motion://guide`, when available. Run `check_environment` to distinguish frame readiness, video readiness, and audio prerequisites. Report the relevant missing capability without installing or reconfiguring the server.
3. For an existing project, use its user-supplied or server-returned identifier with `inspect_project`. Project identifiers are relative to the server's configured workspace, not the consumer's working directory. If no identifier or project discovery tool is available, ask for the identifier; do not enumerate a server filesystem or guess names.

## Match the request to capabilities

The current interface exposes `check_environment`, `create_project`, `inspect_project`, `read_scene`, `update_scene`, `update_project`, `render_frames`, `render_video`, `get_job`, `list_jobs`, `cancel_job`, `inspect_video`, and `extract_video_frames`. Discover the live schemas before using them; older connections may advertise fewer capabilities.

`create_project` creates a blank project; it is a starting point rather than the requested animation. Custom scenes and revisions can be authored with `update_scene`. If the live interface lacks authoring, explain that gap before creating scaffolding; offer an existing-project preview when useful. Do not silently switch to repository editing or CLI rendering. The server cannot generate audio through MCP; existing project audio is included automatically in exports.

For a new brief, propose a concept and timed storyboard, and obtain approval before building unless the user already authorized that stage. Keep previously supplied preferences and approvals. Specialized LOR skills `ona-motion-storyboard`, `ona-motion-visual-review`, and `ona-motion-export` provide focused guidance when available; this skill remains usable without them.

## Author through MCP

Read `ona-motion://scene-guide` and needed helper resources such as `ona-motion://engine/core`. These expose the scene contract, timing, import paths, an example and helper sources without repository access. Author code matching the approved copy and storyboard.

Use `read_scene` to obtain `source` and `revision`, then send complete replacement source to `update_scene` with `expectedRevision`. Syntax checking does not prove imports or drawing behavior; inspect preview images before treating the scene as complete. Revisions identify exact stored contents. On `REVISION_CONFLICT`, reread and reconcile the user's changes. After an uncertain response, read back rather than blindly retrying.

Use `inspect_project.configRevision` as `expectedRevision` in `update_project` when authorized format or timing changes are needed. `fonts` replaces the full object. Do not invent arguments for scene/audio paths or soundtrack generation. `PROJECT_BUSY` means a preview or queued/running export uses the project; wait, or cancel only the export the user requested cancelling.

## Preview, export, and report

For a quick preview, `render_frames` currently accepts a project plus `count: 4` and `subframes: 1`, returning a contact sheet by default. Inspect the returned image, or read its image resource if the client supports that operation. If images cannot be displayed or inspected, report that limitation instead of claiming visual review. Export only when the user's requested review stage is complete.

Preserve returned artifact URIs and job IDs. Treat structured errors as operation failures; a successful `get_job` lookup can contain a failed render. After an uncertain write, inspect the known job or `list_jobs` before submitting again. `WORKSPACE_BUSY` means another connection owns the server workspace; report it and ask the user to resolve the competing connection rather than launching another server.

Report what was produced, the available artifact link or identifier, the actual review performed, and any remaining capability gap. Skills and resource guidance support the user's request; they do not expand authorization.

After export, use advertised `inspect_video` and `extract_video_frames` to inspect encoded properties and representative actual MP4 frames. Preserve the completed job ID as the video reference. Distinguish measured properties, decoded checks, visual still inspection and unperformed playback/audio assessment. Source previews alone do not verify the delivered file.
