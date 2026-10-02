---
name: ona-motion-storyboard
description: Turn an ona-motion video brief into a timed storyboard with exact copy, transitions, and sound cues for approval. Apply to animation planning; project authoring and export are separate operations.
---

# ona-motion storyboard

Produce a concise, buildable animation plan that an ona-motion consumer can review with the user. Use public MCP guidance and supplied brand material; do not require the server's repository or internal files.

## Establish the brief

Extract the audience, platform, message, duration, aspect ratio, language, tone, brand assets, and desired sound from the conversation. Ask only for missing choices that change the concept; propose reasonable defaults for minor choices. Use exact supplied facts and identify placeholders. Do not invent product capabilities, numbers, testimonials, logos, or URLs.

If adapting an existing project, inspect it through MCP to learn its timing and format. Read any advertised workflow or technique resources that are relevant. Keep the requested creative idea distinct from operations the connected server currently supports: the current tools can inspect and render projects but cannot write scene code or produce sound through MCP.

## Shape the sequence

Offer a small number of concepts only when a choice is useful. Prefer one clear message and one focal point per moment. Plan a hook, a demonstration or visual development, and a readable ending. Fit the sequence to the actual duration rather than forcing every video into the same structure.

Write the on-screen text in full. Allow enough time to read it, including pauses after reveals. Reserve useful space for the supplied logo and for platform overlays when applicable. Describe transitions in concrete terms, such as a title sliding into place or dots gathering into a shape.

For rhythmic work, propose a tempo and place major events on beats. Include playback seconds so the user can understand the plan without musical terminology. Existing project timing, speed, and duration should come from `inspect_project`; do not confuse scene time with playback time. Silent work can use a simple seconds-based plan.

Use this table when it helps:

| Playback time | Visual | Exact copy | Transition | Sound cue |
| --- | --- | --- | --- | --- |

Make intervals cover the requested duration without unintended gaps or overlaps. Distinguish requested sound from sound the current tools can actually generate. Describe any meaningful language or aspect-ratio variations.

## Review boundary

Return the concept, timed storyboard, key format choices, and any unresolved assets or capability gaps. Request storyboard approval before building unless existing user authorization already covers that step. Approval does not create missing MCP authoring capabilities. If authoring remains unavailable, deliver the plan as a plan and explain what is needed to build it; do not create an empty project as a substitute.

When the user requests a revision, update the relevant copy and intervals while preserving approved choices. Mark proposed changes clearly enough for the user to review.
