# Model and quota notes

Free-tier availability, pricing and quotas change. Everything here was checked
on **2026-11-02** and must be re-verified before Milestone 5 and before any demo.

## Tap-to-Ask model (primary)

Configured server-side with `GEMINI_MODEL` (read from Milestone 5; no default
model is assumed). Must be a Flash-family model with image input and structured
outputs.

**Do not assume a model is free or has quota.** Free-tier availability, limits
and pricing change, and they are applied per project. Before Milestone 5 and
before any demo, confirm in Google AI Studio (https://aistudio.google.com/rate-limit
and the Projects page) that:
1. the exact model ID you set in `GEMINI_MODEL` is available to your project;
2. which tier your project is on and whether that model has Free-tier quota;
3. your project's RPM, TPM and RPD for that model.

Record what you saw (date, model, tier, limits) here. The table below is what the
public docs showed on 2026-11-02 — observations to start from, not guarantees.

| | `gemini-3.8-flash` (candidate) | `gemini-3.5-flash-lite` (candidate) |
|---|---|---|
| Status | Stable | Stable |
| Inputs / output | Text, image, video, audio, PDF → text | Text, image, video, audio, PDF → text |
| Structured outputs | Supported | Supported |
| Thinking | Supported: low / medium / high ("minimal" returns an error) | Supported |
| Free tier (Standard), public pricing page | Listed as free of charge | Listed as free of charge |
| Paid input / output per 1M tokens | $0.75 / $3.75 until 2026-12-31; $1.50 / $7.50 from 2027-01-01 | $0.30 / $2.50 |
| Used to improve Google's products | Free tier: **Yes** · Paid: No | Free tier: **Yes** · Paid: No |

Suggested evaluation order, once AI Studio confirms availability for your
project: `gemini-3.8-flash` first for reading accuracy (labels, dates, small
print), then `gemini-3.5-flash-lite` if quality is sufficient and quota/cost
matters more; compare in Milestone 8. Your earlier AI Studio dashboard snapshot
(below) showed only Live/audio models, so Flash limits for your project are
still unknown.

### Image input facts
- Supported MIME types include `image/jpeg` (also PNG, WEBP, HEIC, HEIF). VisionAid sends JPEG.
- Tokens: 258 if both sides ≤ 384 px; larger images are tiled into 768 × 768
  tiles at 258 tokens each (roughly: crop unit = floor(min(w, h) / 1.5)).
- `media_resolution` (Gemini 3+) sets the maximum tokens per image; higher
  helps fine text but costs tokens and latency. Tune in Milestone 8.
- Inline data limit: 100 MB per request (50 MB for PDFs). Our images are far smaller.

### API surface
**Planned initial integration: `ai.models.generateContent`** — one stateless
request per question carrying the image part, the question, a system
instruction, `responseMimeType: "application/json"` and `responseJsonSchema`
(plus `mediaResolution` / thinking settings). These fields exist in the
installed `@google/genai` 2.32.0. The SDK also has a newer `ai.interactions`
client, which the current docs lead with; it is not used initially. Field names
and behaviour are re-verified at the start of Milestone 5.

## Quotas

- Limits are per Google Cloud **project**, not per API key, across RPM, TPM and
  RPD; RPD resets at midnight Pacific. Limits are not guaranteed and vary by
  tier and model (https://ai.google.dev/gemini-api/docs/rate-limits).
- Exceeding a limit returns HTTP 429 / `RESOURCE_EXHAUSTED`. VisionAid shows a
  clear message, honours `Retry-After` and never retries indefinitely.
- One request per question, small images and short answers keep usage low.
  App-side rate limits on `/api/ask` protect the shared quota.

## Free-tier privacy caution

Google's pricing page marks Free-tier content as **used to improve Google's
products** (paid tier: not used). For free-tier testing:
- use staged scenes, your own products/notes, and consenting participants;
- avoid faces and bystanders, prescriptions with personal details, addresses,
  ID cards, bank cards, screens and private documents;
- review https://ai.google.dev/gemini-api/terms before testing with real users,
  and consider a paid tier for any real-user study.

Browser speech recognition may process audio through an external service run
by the browser or its provider (server-based by default per MDN; on-device
recognition is not available on mobile browsers). The optional Sarvam fallback
(Milestone 7, not integrated) would send audio to Sarvam. These are separate
processors with their own terms. Typed input is always available instead.

## Live Mode model (optional, not the default)

The Milestone 3 token endpoint is locked to `gemini-3.8-live` (verified
2026-11-01, https://ai.google.dev/gemini-api/docs/models), configured with
`GEMINI_LIVE_MODEL` and an allowlist in `src/lib/server/env.ts`. It is disabled
unless `ENABLE_LIVE_MODE=true` and only relevant if the optional Live Mode is
revived (`docs/live-token.md`).

### Dashboard snapshot (historical, Live/audio models only)

Your AI Studio dashboard for project **AutoToon**, Free Tier, 28-day view:

| Dashboard model label | RPM | TPM | RPD |
|---|---:|---:|---:|
| Gemini 2.5 Flash Native Audio Dialog | Unlimited | 1M | Unlimited |
| Gemini 3 Flash Live | Unlimited | 65K | Unlimited |
| Gemini 3.5 Live Translate | Unlimited | 20K | Unlimited |
| Gemini 3.5 Transcribe Live | Unlimited | 20K | Unlimited |
| Gemini 3.8 Live | Unlimited | 65K | Unlimited |
| Gemini 3.8 Live Extended Thinking | Unlimited | 65K | Unlimited |

These were observations at the time, not guarantees; "Unlimited" RPM/RPD does
not mean unlimited usage.

## Sarvam (optional STT fallback, Milestone 7)

Sarvam documents a REST speech-to-text API (Saaras v3/v4 models) supporting
`en-IN`, `hi-IN` and `kn-IN` among 22+ Indian languages
(https://docs.sarvam.ai/api-reference/speech-to-text/transcribe). Before any
integration, verify: request format and accepted audio types, clip length
limits, pricing/free credits, data retention, and authentication
(server-side `SARVAM_API_KEY` only).

## Official documentation starting points

- Models: https://ai.google.dev/gemini-api/docs/models
- Pricing: https://ai.google.dev/gemini-api/docs/pricing
- Rate limits: https://ai.google.dev/gemini-api/docs/rate-limits
- Image understanding: https://ai.google.dev/gemini-api/docs/image-understanding
- Structured outputs: https://ai.google.dev/gemini-api/docs/structured-output
- File input methods: https://ai.google.dev/gemini-api/docs/file-input-methods
- Web Speech API: https://developer.mozilla.org/en-US/docs/Web/API/Web_Speech_API
- Live API (optional mode): https://ai.google.dev/gemini-api/docs/live-api
