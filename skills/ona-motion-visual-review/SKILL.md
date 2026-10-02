---
name: ona-motion-visual-review
description: Inspect ona-motion contact sheets and selected rendered frames for readability, layout, transitions, and brand fidelity. Apply to visual animation review; Figma layout repair, server debugging, and scene editing are separate workflows.
---

# ona-motion visual review

Review observable rendered output and return actionable findings with playback timestamps. Use the connected MCP interface and the user's supplied references; no server repository access is required.

## Select useful frames

Discover current tool schemas and inspect the requested project. Use `render_frames` for a quick evenly spaced contact sheet, usually four to six frames with `subframes: 1`. This gives an inexpensive overview; it does not establish final motion-blur quality.

Follow the overview with targeted frames around text reveals, transitions, dense layouts, and the ending. The current tool supports either playback `times` or integer `frames`, not both, with at most twelve samples per request. Use the inspected duration and frame count to select valid positions; avoid sampling exactly at an exclusive end boundary. Render additional batches only when they answer a concrete review question.

Embedded images are previews. Use returned full-resolution resources for fine text and edge inspection if the client supports reading and displaying them. A contact sheet is one overview; full stills remain separate artifacts. Render requests can fail or exceed client timeouts for heavy scenes; reduce sample count or subframes and explain the tradeoff rather than repeatedly retrying unchanged requests.

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

Do not claim to apply a fix unless an advertised authoring operation was used successfully. The current server has no MCP scene-editing tool. After a revision is supplied, request new renders of affected moments and compare them with the earlier output. Finish with reviewed samples, findings, and limits of the review; user approval remains the user's decision.
