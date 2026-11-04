# Instructions for the coding agent

You are implementing VisionAid, an experimental browser-based **Tap-to-Ask**
multimodal accessibility assistant: one captured image plus one question, one
server-side Gemini request, a validated structured answer shown and spoken.
Follow these instructions strictly.

## Before each milestone

1. Read `README.md`, `plan.md`, and every file in `docs/`.
2. Inspect the existing code, git status and package state before changing anything.
3. Check current official documentation for Next.js (`node_modules/next/dist/docs/`),
   `@google/genai`, the Gemini API, and any browser API used. Do not rely on
   remembered SDK method names, model IDs or old examples.
4. Re-verify the model ID, structured-output support and image limits for the
   configured model (`docs/model-and-quota-notes.md`). Never assume a model is
   free or has quota: the user confirms the exact model, tier and limits for
   their project in Google AI Studio. Record sources and dates in the docs.
5. State the scope and files expected to change, then implement **only** the
   current milestone from `docs/implementation-roadmap.md`.
6. Run lint, type-check, build and unit tests (`npm test`). Report exact commands
   and results. Stop and wait for approval before the next milestone.

## General engineering requirements

- Next.js App Router and TypeScript; mobile-first, semantic HTML, keyboard
  support, visible focus, screen-reader labels, large tap targets.
- Small components, clear responsibilities; reuse existing hooks and server modules.
- No database, Redis, queues, authentication, analytics or multi-agent
  orchestration in the MVP unless explicitly approved.
- Do not add dependencies without explaining why they are needed.
- Never invent API methods, model IDs, event names, MIME types, sample rates,
  schema keywords or payload shapes. Verify them in current official docs.
- Keep model IDs and other environment-dependent values configurable via
  server-side environment variables.
- Do not delete working code because the primary architecture no longer needs
  it (Live token endpoint, PCM16 pipeline); mark it as optional instead.

## Secrets

- Keep `GEMINI_API_KEY` (and any `SARVAM_API_KEY`) on the server only, in
  `server-only` modules. Never in browser code, client bundles, responses, logs,
  or `NEXT_PUBLIC_*` variables.
- Tap-to-Ask calls Gemini from the server; the browser never receives a Gemini
  credential. Ephemeral tokens are only for the optional Live Mode.

## Tap-to-Ask request rules

- Intended flow: camera preview → capture one image → speak or type a question
  → process image and question together → display and speak the answer.
- One Gemini multimodal request per user question (image + question), using
  `models.generateContent` as the planned initial integration; model ID from
  `GEMINI_MODEL`. No separate LLM calls for intent detection, OCR or routing.
- Validate request size, content type, image format and question length on the
  server; apply rate limits and an in-flight guard.
- Use the model's structured output; validate every response against the schema
  on the server before sending anything to the client. Invalid output becomes a
  generic retake message.
- Do not blindly trust model confidence; downgrade it when evidence is missing.
- Handle HTTP 429 / quota exhaustion gracefully; no indefinite or automatic
  retries on 429; at most one retry for transient failures.
- Keep answers short and speakable.

## Deterministic logic (never delegated to the LLM)

- Expiry-date parsing, validation and comparison; never treat manufacturing or
  packed-on dates as expiry; ambiguous dates are reported as unclear.
- Currency allow-list (₹10, ₹20, ₹50, ₹100, ₹200, ₹500).
- Response validation and task-specific safety checks.
- Duplicate-submission prevention and input quality checks.
- Implement these as pure, unit-testable TypeScript.

## Camera, image and microphone

- Camera and microphone stay off until explicit user action; show clear
  permission and active-state feedback and clear stop controls.
- Capture one still per question; no periodic frame sampling in Tap-to-Ask.
- Downscale and JPEG-encode before sending; run advisory brightness/blur checks;
  do not send images a reliable check marks as unusable.
- Stop every `MediaStreamTrack` on stop, error, hidden page, unmount and teardown.
- Never persist or log images, audio, questions, transcripts or answers.
- Do not assume a mobile browser can keep the camera or microphone running in
  the background or with the screen locked.

## Speech

- Speech input goes through a provider interface: Web Speech API by default,
  text input always available. Sarvam STT is optional for Milestone 7
  (server-side only, requires approval); do not integrate it earlier.
- Do not assume browsers support English, Hindi and Kannada equally; detect and
  fall back. Set the recognition language explicitly.
- Browser speech recognition may process audio through an external
  browser/provider service; say so in the privacy notice and keep typed input
  available as an alternative.
- Spoken output uses `speechSynthesis` with a stop control; report a missing
  language voice rather than speaking in the wrong voice; always show text.

## Safety and product language

- VisionAid is not a navigation, obstacle-avoidance, medical or currency-authentication tool.
- Never claim that a road, crossing, stairway, doorway, path or route is safe or
  clear, or that all obstacles were detected. No turn-by-turn or mobility instructions.
- Medicine labels: visible printed text, including printed dosage instructions,
  may be read verbatim and framed as "the label says…". Never recommend a dose,
  prescribe, judge whether a medicine is suitable for someone, or interpret or
  explain instructions; refer those questions to a pharmacist or doctor.
- Never claim a banknote is genuine or counterfeit.
- Use uncertainty language: "I can see…", "It appears…", "I may be mistaken…".
- For safety-critical or medical questions, say the system cannot reliably help
  and recommend established mobility aids, trusted assistance, or a pharmacist/doctor.
- Spatial language (left/right/ahead) only when supported by the image, phrased as approximate.
- An answer describes the captured photo only; never imply continuous awareness.
- These rules live in the server-side system instruction **and** in deterministic post-processing.

## Privacy and testing

- Show a concise notice: the photo and question are sent to Google's Gemini API;
  spoken audio may be processed by an external browser/provider service
  (Sarvam only if approved in Milestone 7); typing is always available.
- Google's Free tier uses content to improve its products: test with staged,
  non-sensitive scenes and consenting participants; avoid bystanders, private
  documents, prescriptions with personal details, addresses, IDs, cards and screens.
- Do not store media, transcripts or answers by default.

## Optional Live Mode (not the default)

The server-side flag `ENABLE_LIVE_MODE` (default `false`; only the exact value
`true` enables it) gates `POST /api/live-token`; when disabled it mints nothing.
Keep the existing Live Mode code and do not enable it without explicit approval.
When approved: follow the current Live API protocol exactly
(`docs/audio-pipeline.md`, `docs/live-token.md`), sample frames at ≤ 1 FPS,
implement barge-in by clearing queued playback, keep the safety system
instruction in the server-locked token config, and do not claim low latency or
reliable voice activity detection until measured on target devices.

## Working style

- Work one milestone at a time.
- Before each milestone, state the scope and files expected to change.
- After each milestone, report files changed, behaviour implemented, tests run,
  known limitations and manual steps.
- Do not silently skip failing tests.
- Do not proceed to the next milestone without the user's approval.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
