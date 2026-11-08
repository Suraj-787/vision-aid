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
 5. Downscale (≤ 1280 px) + JPEG-encode the still (done at capture, kept in memory)
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
  │    ├─ Sarvam STT            (documented future option; NOT integrated, decided in Milestone 7)
  │    └─ Typed question        (always available)
  ├─ Ask-flow state machine            src/lib/ask/ask-flow.ts (pure), src/hooks/useAsk.ts (exists, M4)
  ├─ Ask UI                            AskPanel, CapturedImageReview, QuestionInput (exists, M4);
  │                                     LanguageSelector (M7)
  ├─ Answer view (text, aria-live)     AnswerView, AskProgress, src/lib/ask/client.ts  (exists, M5;
  │                                     expiry/banknote cards, confidence, adjustments: M6)
  ├─ Spoken answers (speechSynthesis)  src/lib/speech/{spoken-text,script,voices,plan,player}.ts,
  │                                     src/hooks/useSpeechOutput.ts, SpeakControls  (exists, Milestone 7)
  └─ Microphone PCM16 test panel       src/hooks/useMicrophone.ts        (exists; Live Mode / Sarvam reuse)

Next.js server
  ├─ POST /api/ask           exists    src/app/api/ask/route.ts           (Milestone 5)
  │    └─ src/lib/server/ask/*: config, validate, prompt, gemini, errors, handler
  ├─ Deterministic logic (pure, shared) src/lib/ask/{dates,expiry,currency,safety,postprocess,
  │                                     model-output,ask-result}.ts                (exists, Milestone 6;
  │                                     safety-indic.ts: Hindi/Kannada guards, Milestone 7)
  ├─ POST /api/stt           not built (Sarvam proxy: a possible future option, needs approval)
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
   - Milestone 8 decision: the checks stay advisory. They have not been
     calibrated on physical devices, so none is reliable enough to block a photo.
     If the browser cannot read canvas pixels (privacy modes) the analysis is
     skipped, with no warning and no failure (`unknownQualityReport`).
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
    must be tested per device (Milestone 7: the interface does not claim support,
    it tells the user to type if nothing is recognised). `lang` is set explicitly
    from the language selector.
  - The browser manages the microphone for Web Speech; our PCM16 pipeline is not used.
- **Sarvam STT (optional fallback — evaluated in Milestone 7, deliberately not integrated; see "Sarvam decision").** Server-side only: the
  browser records a short clip, `POST /api/stt` forwards it with
  `SARVAM_API_KEY` to Sarvam's REST speech-to-text (Saaras models; `en-IN`,
  `hi-IN`, `kn-IN` documented). The Milestone 2 microphone capture (16 kHz mono
  PCM16) may be reused to build the clip; accepted formats, limits, pricing and
  data handling are verified before integration. Adds a third-party processor —
  requires approval and a privacy-notice update.
- **Text input** — always available on every device, whether or not speech
  works, and the only option when no speech provider works. The question text
  is editable before sending.

## Spoken output and languages (Milestone 7, implemented)

**Speaking the answer.** `window.speechSynthesis` / `SpeechSynthesisUtterance`,
started only when the user taps **Listen to answer**. Nothing is ever spoken
automatically.

| Piece | File | Responsibility |
|---|---|---|
| What is said | `lib/speech/spoken-text.ts` | Built from the *validated* result only: the answer, what is unclear, and (if the answer did not already say it) the expiry explanation or banknote statement. Never intent names, confidence, notices, "changes made", details, printed text or UI wording |
| Language of each part | `lib/speech/script.ts` | Per sentence, by script: Latin → en-IN, Devanagari → hi-IN, Kannada → kn-IN, so a mixed reply is read with matching voices |
| Voice choice | `lib/speech/voices.ts`, `plan.ts` | Exact language+region voice, else another region of the *same* language (the user is told), else **none**: that part is skipped and the user is told. **Never a voice for a different language** |
| Playback | `lib/speech/player.ts` | One playback at a time; a generation counter makes events from a stopped playback harmless (engines report their own `cancel()` as an error); `stop()` clears the whole queue; pause is verified (a device that ignores `pause()` is detected after 250 ms and reported); text is chunked to ≤ 200 characters because some engines stop long utterances |
| Errors | `lib/speech/speech-output-errors.ts` | Maps `SpeechSynthesisErrorEvent` codes: `canceled`/`interrupted` are silent; `not-allowed`, `audio-busy`/`audio-hardware`, everything else → plain messages with a recovery step |
| Hook | `hooks/useSpeechOutput.ts` | Owns the player and the installed-voice list (`voiceschanged`), stops speech when the page is hidden or left and on unmount |
| Controls | `components/SpeakControls.tsx` | Listen / Pause / Resume and Stop speaking. The first button keeps its place in the DOM as its label changes, so focus is not lost; state is also written as text |

Lifecycle rules (all in `useAsk`): speech stops on Cancel/Done, Retake, Ask another
question, a new request, hidden page, `pagehide` and unmount; starting the
microphone stops speech first, and speaking stops recognition first, so the
microphone never hears the answer; a second tap while speaking does nothing; the
answer text is always shown. Screen-reader announcements for speech are short
status messages ("Paused.", "Stopped reading.") and never repeat the answer; the
live region is cleared before playback so a repeated message is announced again.

**Languages.** `en-IN`, `hi-IN`, `kn-IN` (`lib/speech/types.ts`). One selector
(`components/LanguageSelector.tsx`; the language is not remembered, unlike the four accessibility settings) sets (1) the
`lang` of speech recognition, (2) `response_language` sent with the question
(`docs/ask-api.md`), (3) which voice availability message is shown. Reading a
reply picks voices from the reply's own script, not from the selector, so an
English reply to a Hindi request is read with an English voice and the interface
says the reply was not in Hindi (`lib/speech/answer-language.ts`). VisionAid's own
checks and notices remain English only, and the interface says so.

**Not done in Milestone 7 (by design).** No server TTS or paid speech service; no
Sarvam integration (see below); no translation of VisionAid's own safety
statements; no Indic date parsing; the language is not persisted between visits.

### Browser support (MDN browser-compat-data, fetched 2026-11-06)

| API | Support shown by MDN | What it does *not* tell us |
|---|---|---|
| `speechSynthesis` (speak, cancel, pause, resume, `getVoices`, `SpeechSynthesisVoice`) | Chrome 33+, Edge 14+, Firefox 49+, Firefox Android 62+, Safari 7+, Samsung Internet 3.0+ (`voiceschanged` event: Safari 16+) | Which **languages and voices** exist. Hindi and Kannada voices depend on the operating system and installed voice packs, and are often missing. MDN has no entry for some mobile browsers; no claim is made for them |
| `SpeechRecognition` | Chrome (`SpeechRecognition` unprefixed from 139, `webkit` prefix before), Safari 14.1+ (`webkit` prefix), Firefox 160+; **not** Firefox Android | Which **languages** are recognised, and whether it works on a given phone. `processLocally` (on-device) exists only in desktop Chrome 139+ / Firefox 160+, so on phones recognition is expected to use a server |

Known quirks the code defends against (from MDN notes and common engine
behaviour; **each must still be checked on real devices**): `getVoices()` is often
empty until `voiceschanged` fires; `cancel()` raises `canceled`/`interrupted` errors
on the utterance that was playing; some engines stop long utterances (hence
chunking); `pause()` does not work on every device; Android may report voice
languages as `hi_IN` or `hin-IND-...` (normalised); a voice may be online
(`localService === false`) in which case the text it reads leaves the device (the
user is told); autoplay policies can block speech not started from a tap
(`not-allowed`; VisionAid only speaks from a tap). iOS Safari and Android Chrome
limits on Hindi/Kannada recognition and voices are **unverified** here and are
listed as manual device tests.

### Sarvam decision (Milestone 7)

Browser-native speech was evaluated first and is kept as the only implementation:
it needs no new vendor, key, server route or privacy change, and typed input is
always available. Sarvam speech-to-text is **not integrated, no `SARVAM_API_KEY`
was added and no `/api/stt` route exists**. It remains a documented future option
(see `docs/model-and-quota-notes.md`) to be proposed *only if* physical-device
tests show that browser recognition is unusable for Hindi or Kannada on target
phones. Integrating it would add a third-party processor receiving the user's
voice, so it needs explicit approval, verified API/pricing/retention details and a
privacy-notice change first.

## Security headers and request lifecycle (Milestone 8)

**Headers** (`src/lib/security-headers.ts`, applied to every route in production by
`next.config.ts`; not in `next dev`, which needs eval and websockets):
`Content-Security-Policy` (`connect-src 'self'`, `frame-ancestors 'none'`,
`object-src 'none'`, `base-uri`/`form-action 'self'`, `img-src`/`media-src` allow
`blob:` for the photo preview), `X-Content-Type-Options: nosniff`,
`X-Frame-Options: DENY`, `Referrer-Policy: no-referrer` and `Permissions-Policy`
(camera and microphone for this site only; geolocation, payment, USB, serial and
Bluetooth off). Because `connect-src` is `'self'`, the page cannot send the photo,
question or answer to any other host even if a script were injected; only the
server talks to Google. **Limits:** `script-src` and `style-src` keep
`'unsafe-inline'` (Next.js inlines its bootstrap scripts and the pages are
statically generated, so there is no per-request nonce), so the CSP does not stop
all script injection. HSTS is not set here because it belongs to the TLS-terminating
host; set it there. `/api/*` responses additionally carry `Cache-Control: no-store`
and `X-Content-Type-Options`.

**Cancel and disconnect.** If the browser disconnects while Gemini is being asked
(Cancel, Retake, closing the page), Next.js aborts `request.signal`; the handler
passes it to the Gemini call, abandons the upstream request, logs only
`[ask] client disconnected before the answer`, replies with an empty `499` and
releases the one-at-a-time slot at once. Before Milestone 8 the slot stayed held
until Gemini answered (up to the 30 s timeout), so Cancel followed by Ask could be
refused as "already in progress". Whether Google still counts an abandoned request
against quota is not known; there are no retries either way.

**Known deployment limits (see also `docs/deployment.md`, which covers Vercel specifically):** the rate
limiter and the one-at-a-time guard are in memory, per server process (a serverless
host runs several processes, each with its own counters); the client key comes from
`X-Forwarded-For`/`X-Real-IP`, which only a trusted proxy makes reliable, and falls
back to a single shared key `local` when neither header exists (then all users
share one limit). Same-origin checking relies on `Origin` matching `Host` or
`X-Forwarded-Host`; non-browser clients can set these themselves, which is why the
rate limit and server-side validation exist.

## Accessibility architecture (Milestone 9)

Full description, announcement contract and limits: `docs/accessibility.md`. In short:
- `lib/a11y/` (pure, unit-tested): `announcer.ts` (dedupe and re-announce for the one live region),
  `messages.ts` (what a screen reader hears), `preferences.ts` (the three saved choices, strict parsing,
  injectable storage and a tiny store). `lib/guidance/messages.ts` (spoken prompts in en/hi/kn),
  `lib/commands/voice-commands.ts` (English command parser and step rules).
- `hooks/useAnnouncer.ts`, `hooks/useA11yPrefs.ts`; `hooks/useSpeechOutput.ts` now speaks both answers and
  guidance through the **one** `SpeechPlayer` (`say()` vs `listen()`), so nothing overlaps; `hooks/useAsk.ts`
  coordinates focus requests, guidance, prompt-then-listen, automatic reading, Escape and the one-shot command
  listener, which reuses the single `useSpeechInput` recognition session.
- Components: `AccessibilitySettings`, `VoiceBar`; step heading in `SessionShell`; camera `group` in `CameraPreview`.

## Server: `POST /api/ask` (Milestone 5, implemented)

Full reference: `docs/ask-api.md`. Summary:

**Request** — JSON `{ "image": "<base64 JPEG>", "question": "<text>" }`, nothing
else (unknown fields are rejected, so a caller cannot pass a model or
instructions). The browser sends the photo it already captured (≤ 1280 px JPEG);
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

Two shapes, both validated strictly, in `src/lib/ask/`:

**1. What the model returns** (`model-output.ts`, requested through the Gemini
response schema in `prompt.ts`). Every field is required; ones that do not apply
are `null`:

```ts
interface ModelOutput {
  intent: "scene_description" | "text_reading" | "medicine_label" |
          "currency_identification" | "expiry_date" | "general_question" | "unknown";
  answer: string;
  details: string | null;
  uncertainty: string | null;
  confidence: "low" | "medium" | "high";      // qualitative, not a probability
  printed_text: string | null;                // copied as printed, [unreadable] for gaps
  printed_instructions: string | null;        // printed instructions, copied as written
  currency: { denomination: number | null; currency: string | null; evidence: string | null };
  expiry: {
    expiry_date: string | null;               // printed text next to EXP / best before / use by
    expiry_kind: "expiry" | "best_before" | "use_by" | "unclear" | null;
    manufacturing_date: string | null;        // printed text next to MFG / MFD / packed
    date_text: string | null;                 // every date seen, including unlabelled ones
  };
}
```

The model reports printed text, never interpreted dates, and is told not to
calculate. Intent and confidence are string enums in the schema; the nullable
fields use `type: ["string","null"]` (the documented form); `maxLength` is not
used because the API ignores it. A reply with a missing field, wrong type, an
intent/confidence/kind outside its list, or an over-long string is rejected as a
whole; unknown fields are dropped.

**2. What `/api/ask` returns and the browser displays** (`ask-result.ts`,
validated again in the browser): the model's `intent`, `answer`, `details`,
`uncertainty`, `confidence`, `printed_text`, `printed_instructions`, plus the
app's own `currency_check`, `expiry_check`, `notices` and `adjustments`. The five
Milestone 5 fields keep their names and meaning, so the change is additive.
Failures are `{ "error": { "code", "message", "retryable" } }`.

Full field descriptions: `docs/ask-api.md`.

## Deterministic application logic

Kept out of the LLM, implemented as pure, unit-tested TypeScript in
`src/lib/ask/` (no browser or server APIs, so they run under `npm test`).
`postprocess.ts` runs them in this order on the validated model output:

- **Response validation** (`model-output.ts`, `ask-result.ts`) — described above.
  Failures become a generic "unusable answer, try again" error; raw model text is
  never shown.
- **Expiry dates** (`dates.ts`, `expiry.ts`) — the model supplies printed text;
  the code decides what it means and compares it with today as plain
  year/month/day integers (no `Date` comparisons, so no time-zone off-by-one).
  Result: `expired` / `not_expired` / `unclear` with the original text, the
  reading, the comparison date and its source, and any assumptions.
  - Only expiry, best-before and use-by dates are compared. A manufacturing or
    packing date is never an expiry date (MFG-only, an MFG label on the expiry
    text, the same text for both, and an expiry before the manufacturing date all
    give `unclear`).
  - Supported: day-first numeric, ISO and month-name dates, and month/year. A
    month/year date is valid through the **last day of the month**, stated on
    screen. Two-digit years are read as 20YY, stated on screen.
  - Ambiguous day/month order is read both ways: if both agree the result stands
    with the ambiguity stated; if they disagree it is `unclear`.
  - Never invented: missing years, impossible dates, relative lifetimes, run-
    together digits, years outside 2000–2099 and unknown words are `unclear`.
  - "Today" is the user's device date (sent as `local_date`, accepted only within
    ±2 days of the server's UTC date), otherwise the server's UTC date.
  - The printed day itself is still valid. The app never says a product is safe
    to eat or use.
- **Currency** (`currency.ts`) — only ₹10, ₹20, ₹50, ₹100, ₹200 and ₹500. A value
  is shown only when it is a supported note, the currency is rupee, evidence was
  given, confidence is not low, and the answer text does not contradict it;
  otherwise the result is `uncertain` with no value. Wording is "looks like" /
  "may be". It never says a note is genuine or counterfeit.
- **Safety guards** (`safety.ts`) — sentence-level removal, from the model's own
  prose only (`answer`, `details`, `uncertainty`), of claims that a place is safe
  or clear, medical advice or dosing, a note being genuine or fake, and a product
  being safe to use; plus expiry and banknote verdicts that conflict with the
  deterministic results. Removals are listed in `adjustments` and replaced by
  fixed wording. `printed_text` and `printed_instructions` are never altered.
- **Confidence** — shown as a word with a caveat, never a number. `low` always
  carries an explanation of uncertainty and withholds a banknote value. It is not
  used as a measure of correctness.
- **Duplicate-submission prevention** — the Ask button is locked while a request
  is in flight; the server allows one request per client at a time.
- **Input quality** — the client checks above; the server re-checks size/type.

What these cannot do: they cannot see the photo, so they cannot verify that the
printed text or banknote was read correctly. They stop unsupported or forbidden
claims from being shown as confirmed; they do not make a reading correct. The
sentence guards are pattern matching and can miss unusual phrasings or remove a
harmless sentence.

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
