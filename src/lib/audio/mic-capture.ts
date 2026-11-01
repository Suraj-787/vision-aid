import { devLog } from "@/lib/dev-log";
import {
  MicrophoneStartError,
  type MicrophoneErrorKind,
} from "@/lib/microphone-errors";
import { MicPcmPipeline, rmsLevel } from "@/lib/audio/pcm";

const WORKLET_URL = "/worklets/pcm-capture-processor.js";
const WORKLET_NAME = "pcm-capture-processor";
const BLOCK_MS = 20;

export interface MicCaptureHandlers {
  /** One 16 kHz mono PCM16 little-endian chunk. The caller must not keep it. */
  onChunk: (pcm16le: Uint8Array) => void;
  /** Input level 0..1 for a ~20 ms block (UI meter only). */
  onLevel: (level: number) => void;
  /** Capture ended without stop() being called (device lost, audio interrupted…). */
  onEnded: (kind: MicrophoneErrorKind) => void;
}

export interface MicCapture {
  readonly inputSampleRate: number;
  /** Idempotent. Stops tracks, disconnects nodes, closes the AudioContext. */
  stop: () => void;
}

type AudioContextCtor = typeof AudioContext;

function getAudioContextCtor(): AudioContextCtor | undefined {
  return (
    window.AudioContext ??
    (window as Window & { webkitAudioContext?: AudioContextCtor })
      .webkitAudioContext
  );
}

/**
 * Audio-only microphone capture (Milestone 2). Audio is never recorded, stored
 * or sent: it flows track -> AudioWorklet -> main thread -> resample/PCM16 ->
 * onChunk, and is dropped by the caller.
 *
 * Call this directly from a user gesture: the AudioContext is created before
 * the first await so iOS Safari treats it as user-initiated.
 */
export async function startMicCapture(
  handlers: MicCaptureHandlers,
): Promise<MicCapture> {
  if (!window.isSecureContext) throw new MicrophoneStartError("insecure-context");
  const Ctor = getAudioContextCtor();
  if (
    !Ctor ||
    typeof AudioWorkletNode === "undefined" ||
    !navigator.mediaDevices?.getUserMedia
  ) {
    throw new MicrophoneStartError("unsupported");
  }

  const ctx = new Ctor({ latencyHint: "interactive" });
  let stream: MediaStream | null = null;
  let source: MediaStreamAudioSourceNode | null = null;
  let node: AudioWorkletNode | null = null;
  let mute: GainNode | null = null;
  let stopped = false;

  const stop = () => {
    if (stopped) return;
    stopped = true;
    devLog("mic", "releasing microphone, audio nodes and context");
    ctx.onstatechange = null;
    if (node) {
      node.port.onmessage = null;
      node.onprocessorerror = null;
      node.port.postMessage("stop");
    }
    stream?.getTracks().forEach((track) => {
      track.onended = null;
      track.stop();
    });
    for (const n of [source, node, mute]) n?.disconnect();
    source = node = mute = null;
    stream = null;
    ctx.close().catch(() => {});
  };

  const endUnexpectedly = (kind: MicrophoneErrorKind) => {
    if (stopped) return;
    stop();
    handlers.onEnded(kind);
  };

  try {
    // Starts the context inside the user gesture; awaited after permission.
    const resumed = ctx.resume();
    devLog("mic", `AudioContext created at ${ctx.sampleRate} Hz`);

    stream = await navigator.mediaDevices.getUserMedia({
      // Audio only: the camera is a separate, independent control.
      audio: {
        echoCancellation: { ideal: true },
        noiseSuppression: { ideal: true },
        autoGainControl: { ideal: true },
        channelCount: { ideal: 1 },
      },
      video: false,
    });
    const [track] = stream.getAudioTracks();
    if (!track) throw new MicrophoneStartError("no-microphone");
    const s = track.getSettings();
    devLog("mic", "permission granted", {
      tracks: stream.getAudioTracks().length,
      echoCancellation: s.echoCancellation,
      noiseSuppression: s.noiseSuppression,
      autoGainControl: s.autoGainControl,
      channelCount: s.channelCount,
    });

    await resumed;
    if (ctx.state !== "running") throw new MicrophoneStartError("audio-blocked");

    try {
      await ctx.audioWorklet.addModule(WORKLET_URL);
    } catch (err) {
      devLog("mic", "audioWorklet.addModule failed", err);
      throw new MicrophoneStartError("worklet-failed");
    }
    devLog("mic", "worklet module loaded");

    const pipeline = new MicPcmPipeline(ctx.sampleRate);
    source = ctx.createMediaStreamSource(stream);
    node = new AudioWorkletNode(ctx, WORKLET_NAME, {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [1],
      channelCount: 1,
      channelCountMode: "explicit",
      processorOptions: { blockSize: Math.round((ctx.sampleRate * BLOCK_MS) / 1000) },
    });
    // The node writes silence; routing through a zero-gain node keeps it in
    // the rendered graph without any audible output or feedback.
    mute = ctx.createGain();
    mute.gain.value = 0;
    source.connect(node);
    node.connect(mute);
    mute.connect(ctx.destination);

    let firstChunkLogged = false;
    node.port.onmessage = (event: MessageEvent<ArrayBuffer>) => {
      if (stopped) return;
      const block = new Float32Array(event.data);
      handlers.onLevel(rmsLevel(block));
      for (const chunk of pipeline.push(block)) {
        if (!firstChunkLogged) {
          firstChunkLogged = true;
          devLog("mic", `first PCM16 chunk produced (${chunk.length} bytes)`);
        }
        handlers.onChunk(chunk);
      }
    };
    node.onprocessorerror = () => endUnexpectedly("worklet-failed");
    stream.getAudioTracks().forEach((t) => {
      t.onended = () => endUnexpectedly("disconnected");
    });
    ctx.onstatechange = () => {
      if (ctx.state !== "running") endUnexpectedly("interrupted");
    };

    return { inputSampleRate: ctx.sampleRate, stop };
  } catch (err) {
    stop();
    throw err;
  }
}
