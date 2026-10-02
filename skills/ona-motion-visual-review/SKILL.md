---
name: ona-motion-visual-review
description: Inspect ona-motion source previews and encoded-video frames for readability, layout, transitions, and brand fidelity. Apply to visual animation review; Figma layout repair, server debugging, and scene editing are separate workflows.
---

# ona-motion visual review

Review observable rendered output and return actionable findings with playback timestamps. Use the connected MCP interface and the user's supplied references; no server repository access is required.

## Select useful frames

Discover current tool schemas and inspect the requested project. Use `render_frames` for a quick evenly spaced contact sheet, usually four to six frames with `subframes: 1`. This gives an inexpensive overview; it does not establish final motion-blur quality.

Follow the overview with targeted frames around text reveals, transitions, dense layouts, and the ending. The current tool supports either playback `times` or integer `frames`, not both, with at most twelve samples per request. Use the inspected duration and frame count to select valid positions; avoid sampling exactly at an exclusive end boundary. Render additional batches only when they answer a concrete review question.

Embedded images are previews. Use returned full-resolution resources for fine text and edge inspection if the client supports reading and displaying them. A contact sheet is one overview; full stills remain separate artifacts. Render requests can fail or exceed client timeouts for heavy scenes; reduce sample count or subframes and explain the tradeoff rather than repeatedly retrying unchanged requests.

For a completed MP4, use `extract_video_frames` rather than rerendering the source. Supply the completed `jobId`, or a supplied `project` plus `video` relative to its `out/` folder. Default sampling provides six frames and a sheet. Targeted `times` choose the first encoded frame at or after each request; report the returned actual `time`, which can differ from `requestedTime`. Explicit frame indices identify exact encoded frames. A time after the final encoded frame can return `FRAME_NOT_FOUND` even if it precedes the duration boundary; use the measured last frame index when needed. Preserve the manifest's encoded-video source identity.

Use `inspect_video` when encoded format or frame-count evidence is relevant. It distinguishes container frame counts from decoded counts and can optionally verify the selected video stream decodes. These checks do not establish smooth playback, audio quality or synchronization. If the live server lacks these tools, explain that encoded review is unavailable through this connection.

## Inspect the evidence

Actually view the image content before giving a visual verdict. If the client cannot inspect images, provide the artifact reference and state that visual review is pending.

Look for issues that affect this video's purpose:

- Text clipping, descenders, diacritics, overlap, and inadequate margins.
- Contrast, font size, reading time, and legibility at the intended viewing size.
- Competing focal points or unexplained gaps between scenes.
- Transition states where text or objects become confusing or disappear unexpectedly.
- Logo proportions and brand fidelity compared with supplied reference assets.
- A readable ending and, when requested, a plausible loop connection.

Distinguish direct observations from inferences. Selected stills cannot prove smooth playback or sound synchronization. If those matter, request suitable temporal evidence or playback instead of reporting them as verified. Low-subframe previews cannot establish final blur quality; sample the final settings when that question is relevant.

## Report and revisit

Give each issue a playback time or frame index, the visible problem, and a specific suggested change. Separate blocking readability or identity problems from optional polish. Preserve artifact URIs and render identifiers so findings refer to the correct output.

Do not claim to apply a fix unless an advertised authoring operation was used successfully. Scene edits use revision-checked `read_scene` / `update_scene` when the user's request authorizes them. After a revision, render affected moments and compare them with earlier output. An earlier encoded file remains unchanged; review the newly exported job before claiming its delivery is fixed. Finish with reviewed samples, findings, and limits of the review; user approval remains the user's decision.
