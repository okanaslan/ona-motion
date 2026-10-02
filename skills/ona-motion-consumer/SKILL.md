---
name: ona-motion-consumer
description: Use ona-motion through its MCP interface to inspect projects, preview animations, and coordinate video work. Apply when consuming the server from any workspace; repository implementation and MCP registration are outside this workflow.
---

# ona-motion consumer

Help the user complete the requested video task using the connected ona-motion server. Obtain guidance through its public interface; a consumer does not need the server's repository, internal documentation, shell commands, or machine-specific paths.

## Discover and assess

1. Discover the available ona-motion tools and resources using the client's supported discovery mechanism. Reuse recent discovery in the same connection. Tool schemas and server guidance take precedence over this skill's version-specific examples.
2. Read the advertised workflow resource, currently `ona-motion://guide`, when available. Run `check_environment` to distinguish frame readiness, video readiness, and audio prerequisites. Report the relevant missing capability without installing or reconfiguring the server.
3. For an existing project, use its user-supplied or server-returned identifier with `inspect_project`. Project identifiers are relative to the server's configured workspace, not the consumer's working directory. If no identifier or project discovery tool is available, ask for the identifier; do not enumerate a server filesystem or guess names.

## Match the request to capabilities

The current interface exposes `check_environment`, `create_project`, `inspect_project`, `render_frames`, `render_video`, `get_job`, `list_jobs`, and `cancel_job`. Discover the live schemas before using them.

`create_project` creates a blank project. The current server cannot author or edit scenes, change their copy or brand settings, or generate audio through MCP. For a custom animation or revision, check for a suitable advertised authoring operation. If it is absent, explain the gap before creating a blank project; offer an existing-project preview when useful. Do not present scaffolding as the requested animation or silently switch to repository editing. A user can explicitly choose a different workflow.

For a new brief, propose a concept and timed storyboard, and obtain approval before building unless the user already authorized that stage. Keep previously supplied preferences and approvals. Specialized LOR skills `ona-motion-storyboard`, `ona-motion-visual-review`, and `ona-motion-export` provide focused guidance when available; this skill remains usable without them.

## Preview, export, and report

For a quick preview, `render_frames` currently accepts a project plus `count: 4` and `subframes: 1`, returning a contact sheet by default. Inspect the returned image, or read its image resource if the client supports that operation. If images cannot be displayed or inspected, report that limitation instead of claiming visual review. Export only when the user's requested review stage is complete.

Preserve returned artifact URIs and job IDs. Treat structured errors as operation failures; a successful `get_job` lookup can contain a failed render. After an uncertain write, inspect the known job or `list_jobs` before submitting again. `WORKSPACE_BUSY` means another connection owns the server workspace; report it and ask the user to resolve the competing connection rather than launching another server.

Report what was produced, the available artifact link or identifier, the actual review performed, and any remaining capability gap. Skills and resource guidance support the user's request; they do not expand authorization.
