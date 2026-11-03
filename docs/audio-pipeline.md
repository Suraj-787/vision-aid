# Audio pipeline notes (Milestone 2)

> **Status (2026-11-02): retained, not part of the default Tap-to-Ask flow.**
> Tap-to-Ask uses the browser's Web Speech API for speech input, which manages
> the microphone itself. This PCM16 pipeline is kept for the optional future
> Live Mode and may be reused to record clips for the optional Sarvam STT
> fallback (Milestone 7). See `docs/architecture.md`.

## Verified Live API audio requirements (checked 2026-11-02)

Sources:
- https://ai.google.dev/gemini-api/docs/live-api/get-started-websocket (updated 2026-09-15)
- https://ai.google.dev/gemini-api/docs/live-api/capabilities ("Audio formats")
- https://ai.google.dev/gemini-api/docs/live-api (technical specifications)

| Item | Value |
|---|---|
| Input encoding | raw, little-endian, 16-bit PCM, mono |
| Input rate | 16 kHz native. The API resamples other rates, but the rate must be declared in the blob MIME type |
| Input MIME type | `audio/pcm;rate=16000` |
| Output | raw little-endian 16-bit PCM at **24 kHz** (needed for playback in a later milestone) |
| Chunk size | **Not specified** by the docs. This project uses 100 ms (1600 samples, 3200 bytes) as its own tunable choice (`CHUNK_MS` in `src/lib/audio/pcm.ts`) |

Nothing is sent to the API in Milestone 2; this only prepares the input format.

## Design

```
getUserMedia({audio, video:false})
  -> AudioContext (device-native rate, NOT forced to 16 kHz)
  -> MediaStreamSource -> AudioWorkletNode (public/worklets/pcm-capture-processor.js)
       batches 20 ms mono Float32 blocks, posts them to the main thread
  -> src/lib/audio/pcm.ts: Resampler (windowed-sinc, anti-aliased) -> PCM16 LE -> 100 ms chunks
  -> onChunk(): counted and discarded (Milestone 2)
```

Why not `new AudioContext({ sampleRate: 16000 })`: browser handling of a context
rate that differs from the capture device is not uniform (Firefox rejects
connecting such a stream), so the context runs at the device rate and the
conversion happens in typed, unit-tested code instead.

The worklet is a static file in `public/` (no extra dependency or bundler
config). The worklet node writes silence and is routed through a zero-gain node
so it stays in the rendered graph with no audible output or feedback.

Constraints requested (all `ideal`, so none can cause a failure): echo
cancellation, noise suppression, auto gain control, mono. Echo cancellation
matters later when assistant audio plays from the same device.

## Privacy

Audio is never recorded, stored, logged or transmitted. Dev logs contain only
event names, counts and non-identifying track settings.

## Lifecycle / cleanup

`stop()` in `mic-capture.ts` (idempotent) stops every track, clears
`onended`/`onmessage`/`onstatechange`/`onprocessorerror`, tells the worklet to
stop, disconnects all nodes and closes the AudioContext. It runs on: Stop
button, any error, track ended, audio interruption, page hidden, `pagehide`,
and unmount. A request that resolves after Stop/unmount is detected with a
request counter and stopped immediately.

The microphone is also turned off when the page becomes hidden (privacy-first;
background capture is not assumed to work on mobile browsers).

## Not in this milestone

Playback of model audio (24 kHz), interruption/barge-in, any Live API traffic.
