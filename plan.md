# VisionAid — Product and Engineering Plan (Tap-to-Ask)

Revised 2026-11-02: the primary interaction changed from continuous Gemini Live
streaming to **Tap-to-Ask**. The Live design is kept only as an optional future
mode. Architecture: `docs/architecture.md`. Roadmap: `docs/implementation-roadmap.md`.

## 1. Product vision

VisionAid is an experimental, AI-powered accessibility assistant that helps
blind and low-vision users understand visual information through a smartphone
camera and natural voice interaction. It is an information assistant, not a
navigation or safety tool.

## 2. Primary interaction

**Camera preview → capture one image → speak or type a question → process image
and question together → display the answer** (speaking it aloud is planned).

1. The user starts the camera preview.
2. The user taps a large, accessible **Capture photo** button; the app captures **one** image.
3. The user asks a question by speech or by typing (typing is always available).
4. Speech is converted to text.
5. The user taps **Ask**. The captured image and the question are sent together,
   in **one** request, to a server-side Gemini model (`models.generateContent`).
6. Gemini returns a structured JSON response.
7. Application code validates it (Milestone 5); deterministic post-processing such
   as expiry comparison and safety checks follows in Milestone 6.
8. The answer is shown as text in an announced region. Speaking it aloud is
   planned but not built (excluded from Milestone 5).

No continuous audio or video streaming is needed for the primary functionality.

## 3. Core features

### A. Scene description
- Describe visible surroundings, identify common objects, answer contextual
  questions about the captured image.
- Approximate left / right / ahead only when visually supported, phrased as approximate.
- Never claim a path, road, crossing, stairway or doorway is safe or clear;
  never claim every obstacle was detected.

### B. Text and medicine-label reading
- Read printed text, notices, signboards and product labels aloud.
- Extract medicine names and expiry information.
- Visible printed dosage instructions may be read **verbatim**, framed as "the
  label says…".
- Never recommend a dose, prescribe, judge whether a medicine is suitable for
  someone, or interpret or explain instructions; refer such questions to a
  pharmacist or doctor.

### C. Indian currency identification
- Identify ₹10, ₹20, ₹50, ₹100, ₹200 and ₹500 notes.
- Return an uncertain result when visual evidence is insufficient.
- Never claim to authenticate notes or detect counterfeits.

### D. Expiry-date checking
- Extract a possible expiry date from product or medicine packaging into a
  structured form.
- Parse, validate and compare dates in deterministic code, not by LLM reasoning.
- Handle ambiguous, missing and unreadable dates explicitly; never confuse a
  manufacturing date with an expiry date.

## 4. MVP requirements

### Must have
- Responsive, accessible, mobile-first web UI with a large primary Ask button.
- Explicit camera permission and preview (existing), clear stop control.
- Single still capture per question, downscaled JPEG.
- Speech input (Web Speech API where supported) with a text-input fallback.
- Server-side `POST /api/ask` with one Gemini multimodal request per question.
- Structured output, validated server-side; deterministic expiry and currency logic.
- Answers shown as text in an announced region (built). Spoken answers
  (`speechSynthesis`) with a stop control are planned and not yet scheduled.
- Safety, privacy and uncertainty language throughout.
- English, Hindi and Kannada evaluation.

### Should have
- Advisory image-quality checks (brightness, blur) with retake guidance.
- Quick-action shortcuts (Read text, Check expiry, Identify note).
- Optional Sarvam speech-to-text fallback for Indian languages.
- Setting to rely on the screen reader instead of app speech.

### Not in the MVP
- Continuous voice or video streaming (kept as an optional future Live Mode,
  disabled by default via `ENABLE_LIVE_MODE=false`).
- Native apps, background or screen-locked operation, smart glasses.
- Navigation, route planning, obstacle avoidance, crossing guidance, safety guarantees.
- Medical advice of any kind; counterfeit detection.
- Persistent storage of images, audio, questions, transcripts or answers.
- User accounts, database, Redis, queues, analytics, multi-agent orchestration.

## 5. Technology

- Next.js App Router, TypeScript, React, Tailwind CSS (existing).
- Browser MediaDevices (camera), canvas (still capture, downscale, JPEG).
- Web Speech API: `SpeechRecognition` for input, `speechSynthesis` for output.
- Optional Sarvam STT via a server route (Milestone 7, requires approval).
- `@google/genai` on the server for one standard multimodal request per question.
- Existing server modules for env validation, request guarding and rate limiting.

## 6. Model selection and cost strategy

- Use a Gemini **Flash-family** model configured server-side via `GEMINI_MODEL`.
  No model is assumed to be free or to have quota: the exact model, the
  project's tier and its limits must be verified in Google AI Studio before
  Milestone 5. Candidate IDs from the public docs (2026-11-02):
  `gemini-3.8-flash`, `gemini-3.5-flash-lite`. Details:
  `docs/model-and-quota-notes.md`.
- Planned initial API: `models.generateContent` in `@google/genai`.
- One request per question; no separate calls for intent, OCR or routing.
- Downscaled images, short answers, low thinking level where quality allows.
- App-side rate limits; no indefinite retries; graceful 429 / quota handling.
- No caching of images, questions or answers.

## 7. Safety requirements

VisionAid must not:
- Say a road, path, crossing, stairway or doorway is safe or clear, or that all
  obstacles have been detected.
- Give turn-by-turn navigation or mobility instructions.
- Replace a white cane, guide dog, mobility training or human assistance.
- Recommend a medicine dose, prescribe, judge whether a medicine is suitable,
  or interpret instructions (reading printed label text verbatim is allowed).
- Claim a banknote is genuine or counterfeit.
- Present low-confidence readings (text, dates, denominations) as certain.

For safety-critical or medical questions the assistant says it cannot reliably
help with that, and recommends established mobility aids, trusted assistance,
or a pharmacist/doctor as appropriate. These rules live in the server-side
system instruction **and** in deterministic post-processing.

## 8. Privacy principles

- Camera and microphone activate only after explicit user action and have clear stop controls.
- During a question, the captured image and question text are sent to Google's
  Gemini API through VisionAid's server.
- Browser speech recognition may process audio through an external
  browser/provider service (on-device recognition is not available on mobile
  browsers). Typed input is always available as an alternative.
- Sarvam STT is optional for Milestone 7 and is not integrated now; if added,
  audio would be sent to Sarvam.
- Nothing is stored persistently; images, audio, questions and answers are not logged.
- The permanent API keys never reach the browser.
- **Free tier:** Google's pricing page lists Free-tier content as "Used to
  improve our products"; paid tier does not. Do not send sensitive personal,
  medical, financial or bystander information during free-tier testing; use
  staged scenes and consenting participants.

## 9. Success criteria

- A user can capture, ask (voice or text), and hear an answer on a supported mobile browser.
- One Gemini request per question; no streaming in the default flow.
- Devices are released on stop and teardown.
- Expiry results come from deterministic code and never treat MFG dates as expiry.
- Currency answers stay within the six supported notes and never claim authenticity.
- No unsafe navigation or medical claims in the evaluation set.
- No images, audio, transcripts, keys or tokens in logs, bundles or storage.

## 10. Evaluation

Measure: time from question to first spoken word; OCR accuracy on a controlled
set; expiry extraction and comparison accuracy (including MFG-only and ambiguous
cases); currency accuracy by denomination and lighting; scene-answer usefulness
and hallucination rate; speech recognition accuracy per language and browser;
TTS voice availability per language; token usage per question; safety-refusal
correctness. Run tests with informed consent and supervision; never ask
participants to rely on VisionAid for movement or medical decisions.
