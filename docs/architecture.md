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
and question together → display and speak the answer.**

```text
 1. Camera preview — started by the user (existing Milestone 1 hook)
 2. User taps the large "Ask" button → capture ONE still (video -> canvas)
 3. Advisory quality checks on the client: too dark? too blurry?
 4. User speaks (Web Speech API) or types the question — typing always available
 5. Downscale + JPEG-encode the image; package {image, question, language}
 6. POST /api/ask  ───────────────────────────────────────────────┐
                                                                  ▼
                             Server (Next.js route, Node runtime)
                             - origin / size / type validation
                             - rate limit, in-flight guard
                             - ONE models.generateContent call: image +
                               question, system instruction, JSON schema
                             - validate + normalise the JSON
                             - deterministic logic (expiry comparison,
                               currency allow-list, safety rules)
                                                                  │
 7. Response JSON  ◄──────────────────────────────────────────────┘
 8. Show answer text (aria-live) and speak it (speechSynthesis), stoppable
 9. Image, audio and question are discarded; nothing is persisted
```

## Components

```text
Mobile browser (Next.js App Router, React, Tailwind)
  ├─ Camera preview                    src/hooks/useCamera.ts            (exists, Milestone 1)
  ├─ Still capture + downscale + JPEG  planned  src/lib/image/*          (Milestone 4)
  ├─ Quality checks (brightness, blur) planned  src/lib/image/quality.ts (M4 design, M8 tuning)
  ├─ Speech input provider             planned  src/lib/speech/*         (Milestone 4; Sarvam in M7)
  │    ├─ WebSpeechProvider     (browser SpeechRecognition)
  │    ├─ SarvamProvider        (optional; audio -> our server -> Sarvam)
  │    └─ Text input fallback   (always available)
  ├─ Answer presenter: text + speechSynthesis (stoppable)    planned (Milestone 5)
  ├─ Ask-flow state machine            planned  src/hooks/useAsk.ts      (Milestone 4)
  └─ Microphone PCM16 test panel       src/hooks/useMicrophone.ts        (exists; Live Mode / Sarvam reuse)

Next.js server
  ├─ POST /api/ask           planned   src/app/api/ask/route.ts           (Milestone 5)
  │    └─ src/lib/server/ask/*: schema, prompt, validation, expiry, currency
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
3. **Quality checks (advisory, client-side)** — mean luminance (too dark / too
   bright) and a sharpness measure (e.g. variance of the Laplacian on a small
   greyscale copy). Thresholds are calibrated on real devices in Milestone 8.
   - Clearly unusable (e.g. near-black) → do not send; ask the user to retake.
   - Borderline → warn, let the user retake or send anyway.
   - A check that is not reliable on a device must not block sending.
4. **Downscale + encode** — JPEG (`image/jpeg`, a documented Gemini input type).
   Proposed starting point: longest side ≈ 1024–1536 px, quality ≈ 0.8, target
   well under 1.5 MB; tuned in Milestone 8 against OCR accuracy, latency and
   token cost (Gemini counts 258 tokens per 768 × 768 tile; `media_resolution`
   trades detail for tokens). The 100 MB inline limit is far above this.
5. **Lifetime** — the image exists only in memory for the request. Not cached,
   not stored, not logged, not kept in history.

## Speech input

A small provider interface so the ask flow does not depend on one engine:

```ts
interface SpeechInputProvider {
  id: "web-speech" | "sarvam";
  isSupported(lang: SupportedLang): Promise<boolean>;
  listen(opts: { lang: SupportedLang; signal: AbortSignal }): Promise<string>; // final text
}
type SupportedLang = "en-IN" | "hi-IN" | "kn-IN";
```

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

## Spoken output

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

## Server: `POST /api/ask` (Milestone 5)

**Request** — `multipart/form-data` or JSON with base64 (decided in Milestone 5):
image (`image/jpeg`, size cap e.g. ≤ 2 MB, magic-byte check), `question`
(trimmed, length cap e.g. ≤ 500 chars), `lang` (`en-IN` | `hi-IN` | `kn-IN`),
optional `task` hint from UI shortcuts (e.g. "Read text", "Check expiry",
"Identify note"), and a client request id.

**Guards** — reuse the Milestone 3 modules: origin check
(`src/lib/server/request-guard.ts`), in-memory `SlidingWindowLimiter`
(`src/lib/server/rate-limit.ts`; separate limits from `/api/live-token`), env
validation (`src/lib/server/env.ts`, extended with `GEMINI_MODEL`), `no-store`
responses, generic error messages. Plus one in-flight request per client.

**Gemini call (planned initial integration: `models.generateContent`)** —
exactly one stateless request per question:
`ai.models.generateContent({ model, contents: [image part, question], config: {
systemInstruction, responseMimeType: "application/json", responseJsonSchema,
thinking/mediaResolution settings } })`. These field names exist in the
installed `@google/genai` 2.32.0 and are re-verified against current docs at the
start of Milestone 5. The SDK's newer Interactions API (`ai.interactions.create`)
is not used initially. No separate calls for intent detection, OCR or routing —
the model returns `intent` in the same response. Not implemented yet.

**System instruction (server-side, never from the client)** — encodes the
safety and product rules in `AGENTS.md`: uncertainty language, no safety/clear
path claims, no navigation, medicine rules (below), no counterfeit
authentication, retake guidance, short spoken-style answers in the requested
language.

**Medicine labels** — VisionAid may read visible printed text verbatim,
including printed dosage instructions, clearly framed as what the label says
("The label says: …"). It must not recommend a dose, prescribe, say whether a
medicine is suitable for the user or anyone else, explain or interpret the
instructions, or answer questions such as "how many should I take". Those
questions get the printed text (if visible) plus advice to ask a pharmacist or
doctor.

## Structured response

Proposed schema (finalised in Milestone 5). A small common core plus optional
task blocks; irrelevant blocks are omitted, not filled with placeholders.

```ts
type Intent =
  | "scene" | "read_text" | "medicine_label" | "currency" | "expiry"
  | "other" | "safety_limited";          // question needs a safety judgement we refuse

interface AskResult {
  intent: Intent;
  answer: string;                       // short, speakable, in the requested language
  confidence: "high" | "medium" | "low"; // model's own estimate — advisory only
  needs_retake: boolean;
  retake_reason?: "too_dark" | "blurry" | "glare" | "cut_off" | "too_far" | "subject_not_found";
  uncertainty_reason?: string;
  detected_text?: string;               // read_text / medicine_label
  medicine?: {
    names: string[];
    printed_instructions?: string;      // verbatim label text only; never generated advice
  };
  date_candidates?: Array<{             // expiry / medicine_label
    raw_text: string;                   // exactly as printed
    label: "expiry" | "use_by" | "best_before" | "manufacturing" | "packed_on" | "unlabelled";
    year?: number; month?: number; day?: number;
  }>;
  currency?: {
    denomination: 10 | 20 | 50 | 100 | 200 | 500 | null;
    visible_cues: string[];             // e.g. numeral, colour, portrait position
  };
}
```

The server returns the validated `AskResult` plus deterministic fields it
computes itself (e.g. `expiry_status`), never raw model text.

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

- No automatic retry on HTTP 429 / `RESOURCE_EXHAUSTED`: tell the user, honour
  `Retry-After`, keep the Ask button available after the wait.
- At most one automatic retry for a transient network error or 5xx, with
  backoff; never loop.
- Each failure has a plain-language message and a recovery action (retake,
  retype, try again later). Camera stays as the user left it; nothing leaks.
- Quotas apply per Google Cloud project and are not guaranteed; the app's own
  rate limits protect the shared quota.

## Ask-flow states (Milestone 4)

`idle` → `camera-ready` → `capturing` → `checking-quality` → `listening` (or
`typing`) → `ready-to-send` → `sending` → `answering` (speaking) → back to
`camera-ready`; plus `error` from any state. States are visible and announced.
Leaving the page or hiding it cancels listening/sending/speaking and releases
devices, as the Milestone 1–2 hooks already do.

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
