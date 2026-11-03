# VisionAid

VisionAid is an experimental, mobile-first web assistant that helps blind and
low-vision users understand visual information through a phone camera and
natural voice interaction.

**Tap-to-Ask:** camera preview → capture one image → speak or type a question →
image and question are processed together → the answer is displayed and spoken.
Each question is one server-side Gemini request; nothing streams continuously.
Typing is always available as an alternative to speaking.

> **Safety boundary:** VisionAid is an experimental information assistant, not a
> navigation, obstacle-detection or mobility-safety system, and not a medical
> tool. It never says a road, path or crossing is safe or clear, never claims to
> detect every obstacle, never recommends doses, prescribes or judges whether a
> medicine is suitable (it can only read the printed label aloud), and cannot
> tell whether a banknote is genuine. It does not replace a white cane,
> guide dog, orientation-and-mobility training, a human guide, or a pharmacist.

## Features (planned)

| Feature | What it does | Limits |
|---|---|---|
| Scene description | Describes surroundings and objects, answers questions about the photo | Approximate left/right/ahead only when visible; no safety claims |
| Text and medicine labels | Reads signs, notices, product and medicine labels; extracts medicine names and expiry; may read printed dosage text verbatim | No dose recommendations, prescriptions, suitability advice or interpretation |
| Indian currency | Identifies ₹10, ₹20, ₹50, ₹100, ₹200, ₹500 notes | Uncertain when evidence is weak; no counterfeit detection |
| Expiry check | Extracts the expiry date and compares it with today in deterministic code | Never treats a manufacturing date as expiry; ambiguous dates reported as unclear |

Languages targeted: English, Hindi, Kannada.

## Status

| Milestone | | |
|---|---|---|
| 0 Foundation | ✅ | Accessible Next.js shell, notices |
| 1 Camera preview | ✅ | Reused for Tap-to-Ask capture |
| 2 Audio primitives (PCM16) | ✅ | Kept for optional Live Mode / Sarvam reuse |
| 3 Live token endpoint | ✅ | Kept for optional Live Mode; not used by Tap-to-Ask |
| 4 Tap-to-Ask interface | next | Capture, Ask button, speech + text input |
| 5 Gemini image understanding | | `POST /api/ask`, structured output, spoken answers |
| 6 Accessibility tools | | Text, expiry, currency, medicine labels |
| 7 Multilingual | | en / hi / kn evaluation, optional Sarvam |
| 8 Reliability and evaluation | | Quality checks, accuracy, real devices, demo |

Work proceeds one milestone at a time (see `AGENTS.md`, `docs/implementation-roadmap.md`).

## Architecture in brief

```
Phone browser ── camera preview → one still → downscale/JPEG
              ── question: Web Speech API (or optional Sarvam) or typed text
              ── POST /api/ask {image, question, lang}
Next.js server ── validate · rate limit · ONE models.generateContent call (JSON schema)
              ── validate output · deterministic expiry/currency/safety logic
Phone browser ── answer text (aria-live) + speechSynthesis
```

Details: `docs/architecture.md`.

## Tech stack

- Next.js App Router, TypeScript, React, Tailwind CSS
- Browser MediaDevices (camera), canvas (capture, downscale, JPEG)
- Web Speech API (`SpeechRecognition`, `speechSynthesis`); optional Sarvam STT
- `@google/genai` (server only) with a Gemini Flash-family model

## Getting started

```bash
npm install
cp .env.example .env.local   # fill in GEMINI_API_KEY; never commit it
npm run dev
```

Open `http://localhost:3000`. Camera and microphone require a secure context:
localhost for development, HTTPS for phone testing (e.g. an ngrok tunnel;
`next.config.ts` allows ngrok hostnames for dev assets).

Checks: `npm run lint`, `npm run typecheck`, `npm run build`.

## Environment variables

All are server-only; see `.env.example`. Never use `NEXT_PUBLIC_*` for keys.

| Variable | Used by | Notes |
|---|---|---|
| `GEMINI_API_KEY` | `/api/ask` (M5), `/api/live-token` | Required |
| `GEMINI_MODEL` | `/api/ask` (M5) | Flash-family model ID; verify availability and quota for your project in Google AI Studio (`docs/model-and-quota-notes.md`) |
| `ENABLE_LIVE_MODE` | `/api/live-token` | Default `false`; must be exactly `true` for the endpoint to mint tokens |
| `GEMINI_LIVE_MODEL` | `/api/live-token` | Optional Live Mode only; allowlisted |
| `ALLOWED_ORIGINS` | API routes | Optional extra allowed origins |
| `SARVAM_API_KEY` | `/api/stt` (M7, optional) | Only if Sarvam is approved |

## Privacy

- Camera and microphone start only when you tap, with clear stop controls.
- When you ask, the photo and question go to Google's Gemini API through
  VisionAid's server. Browser speech recognition may process your audio through
  an external browser/provider service (on-device recognition is not available
  on mobile); typing is always available instead. Sarvam STT is optional for
  Milestone 7 and not integrated.
- Nothing is stored; images, audio, questions, answers, keys and tokens are never logged.
- **Free tier:** Google's pricing page says Free-tier content is used to improve
  its products. Do not send personal, medical, financial or bystander
  information while testing on the free tier; use staged scenes and consenting
  participants.

## Optional future: Live Mode

Continuous Gemini Live conversation is **not** the default. The token endpoint
(`docs/live-token.md`) and microphone PCM16 pipeline (`docs/audio-pipeline.md`)
remain in the codebase for a possible experimental Live Mode. The endpoint is
disabled unless `ENABLE_LIVE_MODE=true` is set on the server.

## Project documents

- `plan.md` — product requirements and scope
- `AGENTS.md` — coding-agent operating instructions
- `docs/architecture.md` — Tap-to-Ask system design
- `docs/implementation-roadmap.md` — milestone sequence
- `docs/testing-checklist.md` — manual and technical checks
- `docs/model-and-quota-notes.md` — model choice, quotas, free-tier caution
- `docs/audio-pipeline.md` — microphone PCM16 pipeline (Live Mode / reuse)
- `docs/live-token.md` — ephemeral token endpoint (Live Mode)
- `docs/dependency-audit.md` — npm audit status
