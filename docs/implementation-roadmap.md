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

## Milestone 5 — Gemini image understanding ✅ (implemented 2026-11-04; awaiting review)
- User confirms the exact `GEMINI_MODEL`, tier and quota in Google AI Studio;
  re-verify structured-output field names and image limits in current docs.
- Integrate with `models.generateContent` (planned initial API).
- `POST /api/ask` with validation, rate limit, in-flight guard, safe errors.
- One multimodal request: image + question + server-side system instruction +
  JSON schema.
- Server-side schema validation; a controlled error on invalid output.
- Answer shown as text in an `aria-live`-announced region; Ask-flow states
  `sending`, `answered`, `send-failed`, with Try again and Ask another question.
- 429 / quota handling with **no automatic retries** (changed from "at most one
  retry": a retry could silently use extra quota, so the user chooses Try again).
- **Not in this milestone, by decision:** spoken answers (`speechSynthesis`). They
  remain designed in `docs/architecture.md` and need to be scheduled (proposal:
  with the Milestone 7 voice evaluation, or earlier if you prefer).

**Acceptance:** A user asks about a staged scene and reads a short,
uncertain-where-appropriate answer; malformed model output never reaches the
user; no key or media in logs/bundles.

**As built:** `/api/ask` and `src/lib/server/ask/*` (see `docs/ask-api.md`), the
shared contract in `src/lib/ask/`, the answer, loading and error views, and
tests: `npm test` (244 unit and API tests, including the real SDK against a fake
Gemini server) plus mocked-API browser tests. The answer has five fields
(`answer`, `details`, `uncertainty`, `printed_text`, `printed_instructions`);
the richer intent/confidence schema is deferred to Milestone 6. Testing against
the real Gemini API with your chosen `GEMINI_MODEL` is still outstanding.

## Milestone 6 — Structured response processing and deterministic tools ✅ (implemented 2026-11-06; awaiting review)
- One request now also returns an `intent` (7 allowed values), a qualitative
  `confidence`, and structured `expiry` and `currency` blocks; everything is
  validated on the server and again in the browser.
- **Deterministic expiry checking** in TypeScript (`src/lib/ask/{dates,expiry}.ts`):
  `expired` / `not_expired` / `unclear`, date-only comparison, MFG never treated as
  expiry, month/year and ambiguous formats handled with stated assumptions,
  nothing invented.
- **Banknote handling** (`currency.ts`): ₹10–₹500 only, value shown only when
  supported by evidence, otherwise uncertain; never an authenticity claim.
- **Printed text and medicine labels**: printed text and instructions are copied
  as printed and shown separately from the AI's own words; advice, dosing and
  suitability claims are removed deterministically.
- **Deterministic safety guards and post-processing** (`safety.ts`,
  `postprocess.ts`), with every removal disclosed to the user.
- Answer view extended with an expiry card, a banknote card, an intent and
  confidence line, a low-confidence banner and a "changes VisionAid made" note.
- Requests carry the user's local date (`local_date`) so "today" is right near
  midnight in any time zone.

**Acceptance:** Controlled tests for each tool pass (automated, plus the manual
checks in `docs/testing-checklist.md` on real items); the model's wrong or
forbidden claims never appear as confirmed results; the 5 Milestone 5 fields are
unchanged.

**As built / deviations:** details in `docs/ask-api.md`. Not built: the optional
quick-action shortcuts ("Read text", "Check expiry", "Identify note"), because the
single free-form question already covers them and they add UI without adding
capability; they can be added later if wanted. Text reading has no dedicated
retake-guidance logic beyond the model's own wording and the advisory image
checks. Spoken answers remain unscheduled. Real-device and real-item accuracy is
not yet measured (Milestone 8).

## Milestone 7 — Voice interaction and multilingual accessibility ✅ (implemented 2026-11-06; awaiting review)

Delivered:
- **Spoken answers** with `speechSynthesis`: Listen to answer, Pause/Resume (where
  the device honours pause), Stop speaking. Never automatic. Spoken text is built
  from the validated result only (answer, what is unclear, the app's own expiry or
  banknote statement), not from metadata or UI text. One playback at a time; speech
  stops on Cancel/Done, Retake, a new question or request, hidden page, `pagehide`
  and unmount; recognition and synthesis never run together.
- **Languages** English (India), Hindi, Kannada: one accessible selector drives the
  recognition `lang`, the new optional allow-listed `response_language` request
  field (same single Gemini call, no translation call; older clients unaffected),
  and voice-availability messages. A missing voice or an answer in a different
  language than requested is stated plainly; nothing is silently switched and
  Hindi/Kannada text is never given to an English voice.
- **Multilingual printed text**: instructions to copy Devanagari/Kannada print in
  its original script (no transliteration, translation or correction,
  `[unreadable]` for gaps), shown unchanged with the right `lang` attribute; same
  request, no OCR service. Conservative Hindi/Kannada versions of the safety guards.
- **Sarvam decision**: evaluated, **not integrated** (no key, no route, no new
  dependency); documented as a future option in `docs/architecture.md`.
- Privacy notice, page footer, README, API/architecture/testing docs updated.
- Fix found by the new browser tests: a double tap on Start speaking started
  recognition twice (`useSpeechInput.start` is now idempotent).

Known gaps: see `docs/testing-checklist.md` ("Milestone 7") and "Known
limitations" in the final report. In short: real Hindi/Kannada recognition,
voices and printed-text reading are **not verified on any physical device**;
VisionAid's own notices stay English; Indic dates are `unclear`; the Hindi and
Kannada guard word lists are unreviewed by native speakers.

**Acceptance (automated, met):** unit tests for spoken text, language validation,
voice selection, playback lifecycle, response-language handling and multilingual
text preservation; browser tests with mocked speech APIs. **Acceptance (physical,
open):** the manual language/device matrix in the checklist has not been run.

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
