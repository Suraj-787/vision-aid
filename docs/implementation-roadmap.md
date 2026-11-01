# Implementation roadmap

Complete one milestone at a time. Stop for user approval after each milestone.

## Milestone 0 — Project foundation
- Inspect environment and existing files.
- Create a clean Next.js App Router + TypeScript + Tailwind project if needed.
- Add accessible mobile-first landing/session shell.
- Add clear product description, privacy notice, and safety disclaimer.
- Add `.env.example`, `.gitignore`, and scripts.
- No camera/microphone activation and no Gemini integration yet.
- Run lint, type-check, and production build.

**Acceptance:** App starts locally, responsive UI renders, accessibility basics are present, no secrets are committed.

## Milestone 1 — Camera preview
- Add explicit Start Camera / Stop Camera.
- Request video only; do not request microphone yet.
- Show preview, permission status, and error handling.
- Release tracks on stop/unmount.
- Do not transmit frames.

**Acceptance:** Works on localhost and HTTPS mobile browser; stop releases camera.

## Milestone 2 — Microphone and audio primitives
- Add explicit microphone permission control.
- Validate browser audio capture and playback.
- Build reusable audio capture/playback modules only after verifying selected API protocol.
- No Live API connection yet.

**Acceptance:** Permission/error states and cleanup work; no raw audio persistence.

## Milestone 3 — Secure Live token endpoint
- Verify exact model API ID and current ephemeral token flow.
- Add server-only token creation route.
- Validate request origin/input and return only short-lived credentials.
- Do not expose permanent API key.

**Acceptance:** Browser can request a short-lived token; secrets remain server-side.

## Milestone 4 — Minimal Live audio conversation
- Connect using the current official SDK/protocol.
- Send user audio and play model audio.
- Add connection states and robust teardown.
- Test one language first.

**Acceptance:** User can ask a spoken question and hear a response.

## Milestone 5 — Camera frame context
- Add frame sampler capped at about 1 FPS.
- Send frames according to official Live API format.
- Ensure camera transmission happens only during active AI session.
- Show when camera context is paused/stale.

**Acceptance:** Model can answer simple questions about a controlled scene.

## Milestone 6 — Interruptions and scene behavior
- Implement barge-in and playback cancellation.
- Add concise scene narration, repetition suppression, and session-only context.
- Add OCR/read-aloud prompts and approximate spatial language only when grounded.

**Acceptance:** User can interrupt narration and ask a question; no unsafe mobility claims.

## Milestone 7 — Multilingual quality and evaluation
- Evaluate English, Hindi, Kannada with a fixed test set.
- Measure latency, transcription quality, OCR quality, hallucinations, interruption response.
- Improve prompts and UX based on results.
- Document known limitations.

**Acceptance:** Evaluation results are recorded; safety-critical prompts are handled conservatively.

## Milestone 8 — Final polish and demo
- Improve onboarding and accessibility.
- Add privacy/session explanation.
- Test mobile browsers, network failures, permission denial, and cleanup.
- Prepare a demo script and project report.

**Acceptance:** Reproducible supervised demo with known limitations clearly explained.
