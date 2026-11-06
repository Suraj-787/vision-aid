# Architecture — Tap-to-Ask

VisionAid's primary interaction is **Tap-to-Ask**: one photo plus one question,
sent as **one** standard Gemini request, answered with a validated structured
response that the app speaks and shows. There is no continuous audio or video
streaming in the default workflow.

The earlier continuous Gemini Live design is kept as an **optional, future Live
Mode** (see [Live Mode](#optional-live-mode-not-the-default)). Its working code
(token endpoint, microphone PCM16 pipeline) stays in the repository but is not a
dependency of Tap-to-Ask.

External facts below were checked against official docs on 2026-11-02; see
`docs/model-and-quota-notes.md` for sources. Re-verify before each milestone.

## Request flow

The intended user interaction is:

**camera preview → capture one image → speak or type a question → process image
and question together → display the answer** (spoken answers are planned, not
built: see "Spoken output").

```text
 1. Camera preview — started by the user (existing Milestone 1 hook)
 2. User taps "Capture photo" → capture ONE still (video -> canvas)
 3. Advisory quality checks on the client: too dark? too blurry? (never blocks)
 4. User speaks (Web Speech API) or types the question — typing always available
 5. Downscale (≤ 768 px) + JPEG-encode the still (done at capture, kept in memory)
 6. User taps "Ask" → POST /api/ask {image, question}  ────────────┐
                                                                  ▼
                             Server (Next.js route, Node runtime)
                             - origin / size / type validation
                             - rate limit, in-flight guard
                             - ONE models.generateContent call: image +
                               question, system instruction, JSON schema
                             - validate the model's JSON (strict schema)
                             - (Milestone 6: deterministic expiry comparison,
                               currency allow-list, safety post-checks)
                                                                  │
 7. Response JSON  ◄──────────────────────────────────────────────┘
 8. Show the answer as text in an announced region (Milestone 5);
    speaking it with speechSynthesis is planned, not built
 9. Image, audio and question are discarded; nothing is persisted
```

## Components

```text
Mobile browser (Next.js App Router, React, Tailwind)
  ├─ Camera preview                    src/hooks/useCamera.ts            (exists, Milestone 1)
  ├─ Still capture + downscale + JPEG  src/lib/image/{capture,scale}.ts  (exists, Milestone 4)
  ├─ Quality checks (brightness, blur) src/lib/image/quality.ts          (exists, advisory; tuned in M8)
  ├─ Speech input                      src/lib/speech/*, useSpeechInput  (exists, Milestone 4)
  │    ├─ Web Speech API        (browser SpeechRecognition; implemented)
  │    ├─ Sarvam STT            (optional; audio -> our server -> Sarvam; Milestone 7, not built)
  │    └─ Typed question        (always available)
  ├─ Ask-flow state machine            src/lib/ask/ask-flow.ts (pure), src/hooks/useAsk.ts (exists, M4)
  ├─ Ask UI                            AskPanel, CapturedImageReview, QuestionInput (exists, M4)
  ├─ Answer view (text, aria-live)     AnswerView, AskProgress, src/lib/ask/client.ts  (exists, M5)
  ├─ Spoken answers (speechSynthesis)  not built: deliberately excluded from Milestone 5
  └─ Microphone PCM16 test panel       src/hooks/useMicrophone.ts        (exists; Live Mode / Sarvam reuse)

Next.js server
  ├─ POST /api/ask           exists    src/app/api/ask/route.ts           (Milestone 5)
  │    └─ src/lib/server/ask/*: config, validate, prompt, gemini, errors, handler
  │       (expiry, currency, medicine wording checks: Milestone 6)
  ├─ POST /api/stt           planned, optional  (Sarvam proxy, Milestone 7)
  ├─ POST /api/live-token    exists    (Milestone 3; Live Mode only, not used by Tap-to-Ask;
  │                                     returns 404 and mints nothing unless ENABLE_LIVE_MODE=true)
  └─ Shared server modules (exist): env validation, request guard, rate limiter
```

Planned file names are proposals; they are fixed at the start of each milestone.

## Trust boundaries and secrets

- The permanent `GEMINI_API_KEY` (and optional `SARVAM_API_KEY`) exist only on the
  server, read in `server-only` modules. Never `NEXT_PUBLIC_*`, never in responses,
  logs, or client bundles.
- Tap-to-Ask never sends a Gemini credential to the browser: the browser calls
  `/api/ask`, the server calls Gemini. (Ephemeral tokens are only for Live Mode.)
- The model's output is untrusted input: it is schema-validated and passed
  through deterministic rules before reaching the user.
- Never log images, audio, questions, transcripts, answers, keys or tokens. Logs
  carry event names, status codes, durations and sizes only.

## Camera and image path

1. **Preview** — unchanged Milestone 1 behaviour: off until the user taps Start
   camera; released on Stop, error, hidden page, `pagehide`, unmount.
2. **Capture** — one still per question, drawn from the live `<video>` to a canvas.
   No periodic frame sampling in Tap-to-Ask.
3. **Quality checks (advisory, client-side; implemented in Milestone 4)** —
   `src/lib/image/quality.ts` computes mean luminance, fractions of near-black and
   blown-out pixels, and sharpness (variance of the 3×3 Laplacian) on a ≤256 px
   copy, and returns advice: too dark, too bright, "may be blurry or have little
   detail". Blur is only reported when exposure is acceptable.
   - **Advice only.** The thresholds are uncalibrated starting points
     (`DEFAULT_QUALITY_THRESHOLDS`), so a flagged photo is never rejected or
     blocked: the user sees a tip and may retake or continue.
   - Blocking an image is reconsidered in Milestone 8, only for a check shown to
     be reliable on real devices.
4. **Downscale + encode (implemented in Milestone 4)** — `src/lib/image/capture.ts`
   draws the frame once to a canvas at a size from `fitWithin` (longest side ≤
   768 px, aspect ratio kept, never upscaled) and encodes `image/jpeg` at quality
   0.8 (both configurable). Canvases are released immediately. The 768 px start
   keeps tokens low (Gemini counts 258 tokens per 768 × 768 tile; `media_resolution`
   trades detail for tokens) but may be too small for fine print, so size and
   quality are tuned in Milestone 8 against OCR accuracy, latency and cost. The
   100 MB inline limit is far above this.
5. **Lifetime** — the image exists only in memory for the request. Not cached,
   not stored, not logged, not kept in history.

## Speech input

A small provider interface so the ask flow does not depend on one engine:

As built in Milestone 4 (`src/lib/speech/`), a provider starts a single-utterance
session and reports text; the UI never depends on the engine:

```ts
type SupportedLang = "en-IN" | "hi-IN" | "kn-IN";
interface SpeechSession { stop(): void; abort(): void }   // abort(): no more callbacks
// web-speech.ts: startWebSpeech(lang, { onTranscript(text, isFinal), onError(kind), onEnd() }): SpeechSession
// useSpeechInput(): { supported, error, start({lang,onTranscript,onEnd}), stop(), abort(), clearError() }
```

Behaviour: starts only from a user tap; `continuous = false`, `interimResults =
true`, `lang` set explicitly; the transcript fills the editable question box
(speaking replaces the question only once text arrives); error codes map to
messages that always offer typing (`speech-errors.ts`); `stop()` has a 3 s
safety timeout in case a browser never fires `end`; speech is aborted on Cancel,
Retake, page hide, `pagehide` and unmount; the Milestone 2 microphone test is
stopped when speech starts so they never share the microphone. A Sarvam
provider (Milestone 7) would add a second implementation of the same shape.

- **Web Speech API (default when available).** `SpeechRecognition` /
  `webkitSpeechRecognition`. Support (MDN browser-compat-data, 2026-11-02):
  Chrome, Edge, Chrome Android, Samsung Internet (webkit-prefixed; unprefixed
  from Chrome 139); Safari and iOS Safari 14.1+ (webkit-prefixed); Firefox
  desktop 160+; **not Firefox for Android**.
  - **Privacy:** browser speech recognition may process audio through an
    external service run by the browser or its provider — MDN documents it as
    server-based by default. On-device recognition (`processLocally`) exists
    only on desktop Chrome 139+ / Firefox 160+, not on mobile. The privacy
    notice says this, and typed input is always offered as an alternative.
  - Language support per browser/OS is not guaranteed; Kannada in particular
    must be tested per device (Milestone 7). Set `lang` explicitly.
  - The browser manages the microphone for Web Speech; our PCM16 pipeline is not used.
- **Sarvam STT (optional fallback, Milestone 7 — not integrated now).** Server-side only: the
  browser records a short clip, `POST /api/stt` forwards it with
  `SARVAM_API_KEY` to Sarvam's REST speech-to-text (Saaras models; `en-IN`,
  `hi-IN`, `kn-IN` documented). The Milestone 2 microphone capture (16 kHz mono
  PCM16) may be reused to build the clip; accepted formats, limits, pricing and
  data handling are verified before integration. Adds a third-party processor —
  requires approval and a privacy-notice update.
- **Text input** — always available on every device, whether or not speech
  works, and the only option when no speech provider works. The question text
  is editable before sending.

## Spoken output (planned; not part of Milestone 5)

_Deliberately excluded from Milestone 5: answers are shown as text and announced to screen readers only. The design below is retained for when it is scheduled._

- `window.speechSynthesis` with a voice matching the answer language when one
  exists (`getVoices()` varies by device; Hindi/Kannada voices may be missing).
- If no suitable voice exists, show the text and say so; never speak in a wrong
  voice silently. A server TTS provider is out of scope unless approved after
  Milestone 7 evaluation.
- A visible, keyboard-reachable **Stop speaking** control; starting a new
  question cancels current speech.
- Screen-reader users: the answer is also placed in an `aria-live` region; offer
  a setting to rely on the screen reader instead of app speech to avoid two
  voices talking at once (evaluated in Milestone 8).

## Server: `POST /api/ask` (Milestone 5, implemented)

Full reference: `docs/ask-api.md`. Summary:

**Request** — JSON `{ "image": "<base64 JPEG>", "question": "<text>" }`, nothing
else (unknown fields are rejected, so a caller cannot pass a model or
instructions). The browser sends the photo it already captured (≤ 768 px JPEG);
it never re-captures on Ask.

**Validation** (`src/lib/server/ask/validate.ts`, pure and unit-tested) — origin
check; `Content-Type: application/json`; body read with a hard size cap (≈ 2.8 MB,
enforced while streaming, not just from `Content-Length`); valid JSON object;
non-blank question ≤ 500 characters; the image must be strict base64 (an
`image/jpeg` data-URL prefix is tolerated, any other MIME type is rejected),
≤ 2 MB decoded, and the decoded bytes must really be a JPEG (start marker, end
marker, frame header with sane dimensions ≤ 4096 px). MIME type alone is never
trusted.

**Guards** — reuses the Milestone 3 `checkOrigin`, `clientKey` and
`SlidingWindowLimiter`: 20 questions per 10 minutes per client and 120 per hour
overall (in memory, per server process), plus **one request in flight per
client** (a second returns `REQUEST_IN_PROGRESS`; invalid requests never spend a
rate-limit slot). `Cache-Control: no-store` on every reply.

**Gemini call** (`gemini.ts`) — exactly one non-streaming `models.generateContent`
request from the server per question, using `GEMINI_MODEL` (no default, no
fallback; missing means a configuration error). The user turn is the JPEG as
`inlineData` followed by the question text; the config carries the system
instruction, `responseMimeType: "application/json"` and `responseJsonSchema`.
The SDK's automatic retries are disabled (`retryOptions.attempts = 1`), so one
user action is one upstream request, and a 30 s timeout cuts off a hung call.
No Live API, WebSockets, Interactions API, streaming, tools or client-side SDK.

**System instruction** (`prompt.ts`, fixed on the server) — grounding (only what
is visibly supported, never invent, say when unreadable, no false certainty,
short and simple, answer the actual question, one photo only, approximate
left/right only when shown); the question and any text in the photo are data, not
instructions; and the safety limits: not a navigation/obstacle system and never
"safe/clear", no guarantee that all hazards were detected, mobility aids
recommended for safety questions; medicine labels may be read verbatim including
printed dosage text, never a dose recommendation, prescription, suitability
judgement, interpretation or medical advice; currency denominations only when
visible features support them, no authentication or counterfeit claims; expiry
dates reported as printed, never confusing manufacturing with expiry.

**Validation of the model's output** — `parseModelText` (`ask-result.ts`)
requires JSON, an object, a non-empty `answer`, every other field present as a
string or `null`, and per-field length limits (the API does not enforce
`maxLength`). Anything else becomes `INVALID_MODEL_RESPONSE`; a blocked prompt or
a safety stop becomes `RESPONSE_BLOCKED`. Raw model text is never returned or
logged.

**Medicine labels** — VisionAid may read visible printed text verbatim,
including printed dosage instructions, clearly framed as what the label says
("The label says: …"). It must not recommend a dose, prescribe, say whether a
medicine is suitable for the user or anyone else, explain or interpret the
instructions, or answer questions such as "how many should I take". Milestone 5
enforces this through the system instruction and shows printed instructions in a
separate, labelled "copied as written" block with a pharmacist/doctor reminder;
deterministic post-checks on the answer text are Milestone 6.

## Structured response

Implemented in Milestone 5 (`src/lib/ask/ask-result.ts`, shared by server and
browser, so the same validation runs on the model's JSON and again on the
server's reply):

```ts
interface AskResult {
  answer: string;                       // clear, concise answer (required, non-empty, ≤ 2000 chars)
  details: string | null;               // additional visual details
  uncertainty: string | null;           // what is unclear, blurry or hidden
  printed_text: string | null;          // legible text read from the photo
  printed_instructions: string | null;  // visible printed instructions, copied as written
}
```

All five fields are required in the Gemini response schema; the optional ones
are nullable (`type: ["string", "null"]`, the documented form). The success reply
is this object itself; failures are `{ "error": { "code", "message", "retryable" } }`.

The richer schema proposed earlier (`intent`, `confidence`, `needs_retake`,
`date_candidates`, `currency`, …) is **not** implemented yet. Milestone 6 adds
only the task-specific blocks it needs (expiry date candidates, currency) and the
deterministic logic that consumes them. Model confidence is not used for
anything in Milestone 5.

## Deterministic application logic

Kept out of the LLM, implemented as pure, unit-tested TypeScript:

- **Response validation** — parse JSON, validate against the schema, coerce
  nothing silently; on failure return a generic "could not understand the image,
  please retake" result (no automatic re-ask).
- **Confidence** — the model's `confidence` is never trusted on its own. The
  server downgrades it when evidence is missing (e.g. `currency` with no
  `visible_cues`, an expiry with no `raw_text`), and low confidence changes the
  wording ("It might be…, I may be mistaken").
- **Expiry dates** (Milestone 6):
  - Only `expiry`, `use_by` and `best_before` candidates are compared.
    `manufacturing` / `packed_on` are never treated as expiry, even if they are
    the only date; the answer then says no expiry date was found.
  - Validate ranges (month 1–12, real calendar day, plausible year window).
  - Month-only dates (e.g. `EXP 08/2027`) are treated as the **end of that
    month**, and the answer states this assumption.
  - Indian packaging uses day-first order. Numeric dates where day/month order
    is genuinely ambiguous, two-digit years that could be read two ways, and
    multiple conflicting expiry candidates produce `expiry_status: "unclear"`
    with the raw text read aloud, not a guess.
  - Compare against the device's local date; result `expired` / `expires_soon`
    (threshold configurable, e.g. 30 days) / `not_expired` / `unclear` / `not_found`.
  - Never say a product is safe to eat or use; report the date only.
- **Currency** — accept only ₹10, ₹20, ₹50, ₹100, ₹200, ₹500; anything else is
  `null`. Never claim authenticity; always say counterfeit detection is not
  possible. Multiple notes or partial notes → ask for one note at a time.
- **Task-specific safety rules** — keyword and intent checks on the question and
  answer (e.g. crossing / stairs / "is it safe", dosage / "how many tablets",
  "can I take", "is it OK for") that replace or append the standard safety
  message even if the model complied.
- **Medicine wording** — `printed_instructions` is spoken only with a "the label
  says" frame and a pharmacist/doctor reminder; answers containing advice-style
  wording (recommend, you should take, safe for you, suitable) are replaced with
  the standard medical-limits message plus any verbatim label text.
- **Duplicate-submission prevention** — the Ask button is locked while a request
  is in flight; a client request id lets the server reject an immediate duplicate.
- **Input quality** — the client checks above; the server re-checks size/type.

## Errors, quota and retries

- **No automatic retries anywhere** (the SDK's are switched off and the browser
  never repeats a request): a failed question shows a clear message and the user
  chooses *Try again*, which is offered only when trying again could help
  (quota, timeout, unavailable, unusable model output, network). `Retry-After`
  is shown when the server provides it.
- Each failure has a plain-language message and a recovery action (retake,
  retype, try again later). Camera stays as the user left it; nothing leaks.
- Quotas apply per Google Cloud project and are not guaranteed; the app's own
  rate limits protect the shared quota.

## Ask-flow states

Implemented as a pure reducer in `src/lib/ask/ask-flow.ts` (unit-tested), which
rejects invalid transitions by returning the same state object. Stored phases:
`idle`, `capturing`, `image-captured`, `listening`, `question-ready`, `sending`,
`answered`, `send-failed`; the UI also shows `camera-active` (idle + live
camera). Milestone 4's local "ready to submit" state became `sending`.

```text
idle/camera-active ─Capture→ capturing ─ok→ image-captured ⇄ question-ready
                                │fail→ idle           │  ↑ typing / transcript
                                                     ▼  │
                          listening ⇄ (start/stop speaking)
question-ready ─Ask→ sending ─ok→ answered ─Ask another→ image-captured (question cleared)
                        │fail→ send-failed ─Try again→ sending
                                         └─Edit question→ question-ready
Retake: any image state → idle (question kept, except after an answer)
Cancel: anything → idle (photo, question, answer cleared; a request in flight is aborted)
```

Guards: Capture needs a live camera and no image; Ask needs an image and a
non-blank question and is rejected while sending, answered or failed (duplicate
submission prevention, also enforced by a ref in the hook for same-tick double
activation); Try again exists only after a failure.

**Requests and stale replies** (`useAsk` + `src/lib/ask/client.ts`): each request
gets an id and an `AbortController`. Cancel, Retake, `pagehide`, unmount and a
newer request invalidate the id and abort the fetch; a reply for a stale id is
ignored, so an old answer can never overwrite a newer state. The browser times
out after 45 s (the server's own Gemini timeout is 30 s) and never retries
automatically. The server's reply is re-validated in the browser.

Phase changes are announced through a polite live region (including the answer
text); focus moves to the photo heading after capture, the answer or error
heading after a result, and the primary button after Retake/Cancel. Leaving or
hiding the page aborts listening (and `pagehide` also aborts the request and
discards the photo and answer).

## Failure handling checklist

Permission denied, missing device, insecure origin, unsupported speech or
synthesis API, missing language voice, unusable image, network loss, request
too large, rate limit, quota exhausted, invalid model output, upstream error,
page hidden mid-flow.

## Optional: Live Mode (not the default)

A possible future experimental mode with continuous voice conversation and
optional periodic camera frames over the Gemini Live API. Existing pieces:

- `POST /api/live-token` — single-use, model-locked ephemeral tokens
  (`docs/live-token.md`). Gated by the server-side flag `ENABLE_LIVE_MODE`:
  unless it is exactly `true`, the route returns 404 `LIVE_MODE_DISABLED`
  without reading the API key or minting anything. Default: disabled.
- Microphone capture → 16 kHz mono PCM16 (`docs/audio-pipeline.md`).
- Live session states in `src/lib/session-state.ts`: `idle`,
  `requesting-permissions`, `camera-ready`, `connecting`, `active`, `paused`,
  `stopping`, `error`.

If revived, it would still need: playback of 24 kHz model audio, barge-in, the
server-locked safety system instruction, frame sampling ≤ 1 FPS, and a
privacy-notice update. Live Mode costs more and streams continuously, so it is
off by default and requires explicit approval.
