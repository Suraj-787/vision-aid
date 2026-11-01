# VisionAid

VisionAid is a mobile-first, browser-based multimodal AI companion that helps a blind or low-vision user understand selected aspects of their surroundings through spoken scene descriptions and voice questions.

> **Safety boundary:** VisionAid is an experimental information assistant, not a navigation, obstacle-detection, or mobility-safety system. It must never tell a user that a road is safe to cross, that a path is clear, or that an obstacle has been reliably detected. It does not replace a white cane, guide dog, orientation-and-mobility training, or a human guide.

## Current build target

Build a working web prototype in small, testable milestones:

1. Accessible mobile-first UI and project foundation.
2. Camera preview and explicit camera start/stop controls.
3. Microphone capture and audio playback pipeline.
4. Secure backend endpoint that issues a short-lived Gemini Live token.
5. Live multimodal session: user audio + sampled camera frames + spoken response.
6. Interruptible speech and voice questions.
7. Short-term scene context, OCR/read-aloud behavior, and language testing.
8. Privacy, accessibility, and supervised usability evaluation.

Do not implement all milestones at once. Follow `AGENTS.md` and `docs/implementation-roadmap.md`.

## Tech stack

- Next.js App Router, TypeScript
- Tailwind CSS
- Browser MediaDevices API for camera and microphone
- Canvas for sampled camera frames
- Web Audio API / AudioWorklet for real-time audio where required by the current Gemini Live protocol
- `@google/genai` if its current official SDK supports the selected Live API flow; otherwise use the documented protocol
- Server-side Next.js route for ephemeral token creation

Use the official current Gemini Live documentation as the source of truth. Do not assume a dashboard display label is also a valid API model identifier.

## Getting started

```bash
npm install
cp .env.example .env.local
npm run dev
```

Open `http://localhost:3000`. Camera and microphone access require a secure context: localhost is suitable for development; deployed testing must use HTTPS.

## Environment variables

See `.env.example` (server-only variables; copy to `.env.local`). Never put a permanent Gemini API key in a `NEXT_PUBLIC_*` variable or browser code. The token endpoint is documented in `docs/live-token.md`.

The model value is deliberately configurable. The Google AI Studio dashboard you shared displayed **Gemini 3.8 Live** with 65K TPM and Unlimited RPM/RPD for your Free Tier project. Before implementation, verify the exact API model ID and availability in the current official Live API model documentation. If the dashboard label is not the exact API ID, set the documented ID in `GEMINI_LIVE_MODEL`.

## Privacy-first defaults

- Camera and microphone are off until the user explicitly starts them.
- Show clear camera/microphone status.
- Provide an obvious stop/pause control.
- Sample camera frames at no more than approximately 1 frame per second for the initial prototype.
- Do not record or persist raw audio/video.
- Do not log frame contents, audio contents, transcripts, or API tokens.
- Stop all media tracks when the user stops the session or leaves the active experience.
- Test only with informed consent and avoid capturing bystanders or sensitive information.

## Project documents

- `plan.md` — product requirements and scope
- `AGENTS.md` — coding-agent operating instructions
- `docs/architecture.md` — system design
- `docs/implementation-roadmap.md` — milestone-by-milestone build sequence
- `docs/testing-checklist.md` — manual and technical checks
- `docs/model-and-quota-notes.md` — how to handle the dashboard limits and model selection
- `docs/audio-pipeline.md` — verified Live API audio format and the microphone pipeline
- `docs/live-token.md` — ephemeral token endpoint: flow, constraints, security, testing
- `docs/dependency-audit.md` — npm audit status
