# Architecture

## High-level components

```text
Mobile browser
  ├─ Accessible Next.js UI
  ├─ Camera preview (getUserMedia)
  ├─ Frame sampler (video → canvas → compressed image)
  ├─ Microphone capture (MediaDevices / Web Audio)
  ├─ Live session client
  ├─ Audio playback queue + interruption
  └─ Session state / temporary context
          │
          ├── POST /api/live-token
          │       └─ Server-only Gemini API key
          │           └─ Official ephemeral-token creation flow
          │
          └── Gemini Live API (short-lived client token)
```

## Trust boundaries

- The permanent Gemini API key exists only on the server.
- The browser receives only a short-lived token created for the session, if supported by the selected model and documented flow.
- Never send a permanent key to the client.
- Do not log tokens, media payloads, transcripts, or private user content.

## Camera path

1. User taps Start Camera.
2. Request video permission with `getUserMedia`.
3. Display local preview.
4. Only after user starts the AI session, sample frames.
5. Initially target no more than one frame per second.
6. Resize and encode frames according to the current API requirements.
7. Stop tracks on Stop, error, route teardown, and component unmount.

Do not transmit a continuous full-resolution video stream unless the current official API explicitly requires and supports it. Use the documented image/video message shape.

## Audio path

Follow the current official Live API documentation for:
- input audio encoding and sample rate;
- output audio encoding and sample rate;
- real-time transport and event format;
- voice activity detection and interruption events;
- session configuration and tool/function calling, if any.

Do not copy protocol details from old examples without checking compatibility with the selected model. If using PCM and AudioWorklet, implement resampling and playback queueing carefully. User speech must interrupt assistant playback.

## Session lifecycle

States should be explicit and visible:
- `idle`
- `requesting-permissions`
- `camera-ready`
- `connecting`
- `active`
- `paused`
- `stopping`
- `error`

On stop:
- stop frame sampling;
- close the Live API connection;
- stop all media tracks;
- stop/clear audio playback;
- clear transient session state.

## Context and narration

For the first implementation, keep context in memory for the active session only. Avoid building a vector database or persistent memory. Use recent frames and recent conversation context as supported by the Live API. Narration should be concise, non-repetitive, and explicitly uncertain when visual evidence is ambiguous.

## Failure handling

Handle:
- camera/microphone permission denied;
- missing device;
- insecure origin;
- unsupported browser APIs;
- network loss;
- token creation failure;
- Live API connection failure;
- session expiry;
- malformed/unsupported audio or image payload;
- playback/autoplay restrictions.

Show a user-understandable error and a clear recovery action. Do not leave camera/microphone active after an unrecoverable error.
