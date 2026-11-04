# Implementation roadmap — Tap-to-Ask

Complete one milestone at a time. Before each milestone: state scope and files,
re-verify the external facts it depends on. After each: report files, behaviour,
tests, limitations, manual steps. Stop for user approval before the next one.

Architecture: `docs/architecture.md`. Revised from the continuous-Live design on
2026-11-02; Milestones 0–3 were built under the earlier plan and are kept.

## Completed

### Milestone 0 — Project foundation ✅
Next.js 16 App Router, TypeScript, Tailwind 4, accessible mobile-first shell,
safety and privacy notices, lint / type-check / build scripts.

### Milestone 1 — Camera preview ✅
Explicit Start/Stop camera, video-only permission, preview, error handling;
tracks released on stop, error, hidden page, `pagehide` and unmount.
**Reused by Tap-to-Ask** as the source for still capture.

### Milestone 2 — Audio primitives ✅
Explicit Start/Stop microphone, AudioWorklet capture, 16 kHz mono PCM16 LE
conversion (`docs/audio-pipeline.md`). **Not required by Tap-to-Ask**; kept for
optional Live Mode and possible reuse for Sarvam STT clips.

### Milestone 3 — Secure Gemini Live token endpoint ✅
`POST /api/live-token`: single-use, model-locked ephemeral tokens
(`docs/live-token.md`). **Not used by Tap-to-Ask**; kept for optional Live Mode
and disabled unless `ENABLE_LIVE_MODE=true`.
Its server modules (env validation, request guard, rate limiter) are reused by
`/api/ask`.

## Milestone 4 — Tap-to-Ask interface ✅ (implemented 2026-11-03; awaiting review)
Flow: camera preview → capture one image → speak or type a question → (prepared
for) processing image and question together → (later) display and speak the answer.

- Large, accessible primary **Ask** button (big tap target, clear label, keyboard + screen reader).
- Still capture of one frame from the existing camera preview.
- Image preparation: downscale + JPEG encode; design the advisory brightness/blur checks.
- Speech input via the Web Speech API behind a provider interface; explicit
  listening state; language selector (en-IN / hi-IN / kn-IN).
- Text-input fallback, always available; editable question before sending.
- Ask-flow state machine and visible/announced states; duplicate-submission lock.
- Submission state UI, but **no Gemini call yet** (the request is prepared and
  shown as "ready", or sent to a stub that returns a fixed response).
- Privacy notice kept accurate for speech recognition (audio may be processed
  by an external browser/provider service; typing always available).
- No Sarvam integration.

**Acceptance:** On a real phone, a user can capture a still, ask by voice or
text, and reach a "ready to send" state; devices release correctly; nothing is
transmitted to Gemini.

**As built:** pure, unit-tested modules (`src/lib/image/{scale,quality}.ts`,
`src/lib/ask/ask-flow.ts`, `src/lib/speech/{transcript,speech-errors}.ts`, run
with `npm test`), browser modules (`capture.ts`, `web-speech.ts`), hooks
(`useAsk`, `useSpeechInput`) and components (`AskPanel`, `CapturedImageReview`,
`QuestionInput`, `ActionButton`). Images are downscaled to ≤ 768 px JPEG
(quality 0.8); quality checks are advisory only and never block. Real-device
testing on phones is still outstanding.

## Milestone 5 — Gemini image understanding
- User confirms the exact `GEMINI_MODEL`, tier and quota in Google AI Studio;
  re-verify structured-output field names and image limits in current docs.
- Integrate with `models.generateContent` (planned initial API).
- `POST /api/ask` with validation, rate limit, in-flight guard, safe errors.
- One multimodal request: image + question + server-side system instruction +
  JSON schema.
- Server-side schema validation and normalisation; generic retake on invalid output.
- Spoken answers via `speechSynthesis` with Stop speaking; answer also in an
  `aria-live` region.
- 429 / quota handling, at most one retry for transient failures.

**Acceptance:** A user asks about a staged scene and hears a short, uncertain-
where-appropriate answer; malformed model output never reaches the user; no key
or media in logs/bundles.

## Milestone 6 — Accessibility tools
- Text reading (signs, notices, labels) with retake guidance.
- Expiry-date extraction + **deterministic** parsing and comparison (unit-tested
  rules in `docs/architecture.md`; MFG never treated as expiry).
- Indian currency identification (₹10, ₹20, ₹50, ₹100, ₹200, ₹500), uncertain
  result when evidence is insufficient, no authenticity claims.
- Medicine-label reading (name, expiry, and visible printed dosage text read
  verbatim as "the label says…"), with no dose recommendations, prescriptions,
  suitability advice or interpretation.
- Optional quick-action shortcuts ("Read text", "Check expiry", "Identify note").
- Task-specific safety rules applied after the model response.

**Acceptance:** Controlled test sets for each tool pass the checks in
`docs/testing-checklist.md`, including all red-team prompts.

## Milestone 7 — Multilingual support
- English, Hindi, Kannada for questions, answers and UI strings.
- Evaluate Web Speech recognition per language and device; record gaps.
- Evaluate `speechSynthesis` voices per language and device; define the
  no-voice fallback.
- Optional Sarvam STT behind the provider interface via `POST /api/stt`
  (requires approval, `SARVAM_API_KEY`, verified API details, privacy-notice update).

**Acceptance:** A repeatable test set is run in all three languages; results and
known gaps are recorded.

## Milestone 8 — Reliability and evaluation
- Calibrate image-quality checks on real devices; decide block vs warn thresholds.
- Error, network and quota handling review; offline and slow-network behaviour.
- Accuracy evaluation: OCR, expiry extraction, currency, scene answers,
  hallucination rate, safety refusals.
- Real-device testing (iOS Safari, Android Chrome; others as available).
- Accessibility testing with VoiceOver / TalkBack and keyboard; speech vs screen-reader setting.
- Latency and token-usage measurements; image size tuning.
- Final supervised demo script and report with known limitations.

**Acceptance:** Reproducible supervised demo; evaluation results and
limitations documented.

## Optional future extension — Gemini Live Mode
- Continuous voice conversation using the existing ephemeral-token endpoint and
  PCM16 pipeline.
- Optional real-time visual context (≤ 1 FPS frames).
- Needs 24 kHz playback, barge-in, server-locked safety system instruction,
  updated privacy notice, cost review. Off by default (`ENABLE_LIVE_MODE=false`);
  requires explicit approval.
