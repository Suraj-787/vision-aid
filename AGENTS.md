# Instructions for the coding agent

You are implementing VisionAid, an experimental browser-based multimodal accessibility assistant. Follow these instructions strictly.

## Before coding

1. Read `README.md`, `plan.md`, and every file in `docs/`.
2. Inspect the existing directory and package manager state before changing anything.
3. Check current official documentation for Next.js, `@google/genai`, and Gemini Live API. Do not rely on remembered SDK method names or old examples.
4. Verify the exact API model ID corresponding to the user's AI Studio dashboard entry **Gemini 3.8 Live**. The dashboard label is not proof that `gemini-3.8-live` is a valid API ID. Record the verified ID and source in your implementation notes. Keep it configurable through `GEMINI_LIVE_MODEL`.
5. Explain the implementation approach, then implement **Milestone 0 only** from `docs/implementation-roadmap.md`.
6. Run lint, type-check, and build where available. Report exact commands and results. Stop and wait for approval before starting Milestone 1.

## General engineering requirements

- Use Next.js App Router and TypeScript.
- Build mobile-first, with accessible semantic HTML, keyboard support, visible focus, and screen-reader labels.
- Keep components small and responsibilities clear.
- Do not add a database, Redis, queues, authentication, analytics, or multi-agent orchestration to the MVP unless explicitly approved.
- Do not add dependencies without explaining why they are needed.
- Keep secrets on the server. Never expose a permanent Gemini API key in browser code, client bundles, logs, or `NEXT_PUBLIC_*` variables.
- Use the current official ephemeral-token flow for browser Live API connections if supported. The backend may hold the permanent API key and create a short-lived client token.
- If ephemeral tokens or the intended SDK flow are not supported for the verified model, stop and explain the documented alternative before implementing a less secure design.
- Never invent API methods, model IDs, event names, MIME types, sample rates, or payload shapes. Verify them in current official docs.
- Keep model ID and other environment-dependent values configurable.

## Camera and microphone

- Camera and microphone must remain off until explicit user action.
- Show clear permission and active-state feedback.
- Start with a camera preview only; do not transmit frames until the user explicitly starts the AI session.
- Initial frame sampling target: at most 1 frame per second. Avoid sending unchanged frames when practical.
- Scale/compress frames before transmission according to current API requirements.
- Stop every `MediaStreamTrack` on stop, error, component unmount, and session teardown.
- Do not persist raw audio/video or write it to logs.
- Do not assume a mobile browser can keep camera/microphone running in the background or with the screen locked.

## Audio and interruption

- Follow the current Live API protocol exactly for input audio encoding, sample rate, output audio decoding, and playback.
- Prioritize user speech over assistant narration.
- Implement barge-in/interruption by stopping queued playback and sending the documented interruption signal if required.
- Do not claim low latency or reliable voice activity detection until measured on target devices.

## Safety and product language

- VisionAid is not a navigation or obstacle-avoidance system.
- Never make claims that a road, crossing, stairway, doorway, or route is safe or clear.
- Do not provide turn-by-turn directions or mobility instructions in the MVP.
- Use uncertainty language: “I can see…”, “It appears…”, “I may be mistaken…”.
- For potentially safety-critical questions, say that the system cannot reliably assess safety and recommend using established mobility aids and trusted assistance.
- Spatial language such as left/right/ahead must be used only when supported by the frame and phrased as approximate.
- Do not imply continuous awareness when the camera is paused, the tab is inactive, or no recent frame has been processed.

## Privacy and testing

- Show a concise notice explaining that camera frames and microphone audio are sent to the configured AI service during an active session.
- Use consent-based testing in controlled environments.
- Avoid recording identifiable people, private documents, screens, addresses, or other sensitive material.
- Do not store transcripts or media by default.
- Include a clear way to stop the session and release devices.

## Working style

- Work one milestone at a time.
- Before each milestone, state the scope and files expected to change.
- After each milestone, report files changed, behavior implemented, tests run, known limitations, and any manual steps.
- Do not silently skip failing tests.
- Do not proceed to the next milestone without the user's approval.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
