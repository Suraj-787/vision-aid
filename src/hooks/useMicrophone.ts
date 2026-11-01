"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { startMicCapture, type MicCapture } from "@/lib/audio/mic-capture";
import { CHUNK_MS } from "@/lib/audio/pcm";
import { describeError, devLog } from "@/lib/dev-log";
import {
  microphoneError,
  toMicrophoneError,
  type MicrophoneError,
} from "@/lib/microphone-errors";

export type MicrophoneStatus =
  | "idle"
  | "requesting-permissions"
  | "listening"
  | "error";

export interface MicrophoneMeter {
  /** 0..1, peak over the last UI update window. */
  level: number;
  /** Seconds of audio converted since the microphone started. */
  seconds: number;
  /** True once any real sound has been picked up in this run. */
  heardSound: boolean;
}

const IDLE_METER: MicrophoneMeter = { level: 0, seconds: 0, heardSound: false };
const UI_INTERVAL_MS = 100;
const SOUND_LEVEL = 0.3; // ~ -42 dBFS

/**
 * Microphone input test (Milestone 2). Audio is converted to the Live API
 * input format (16 kHz mono PCM16 LE) and then discarded: only counters and a
 * level meter are kept. Nothing is recorded, stored, logged or transmitted.
 *
 * Every path that ends capture (stop, error, track ended, audio interrupted,
 * page hidden, pagehide, unmount) goes through release().
 */
export function useMicrophone() {
  const captureRef = useRef<MicCapture | null>(null);
  const requestIdRef = useRef(0);
  const requestingRef = useRef(false);
  // Mutable counters; copied to React state at most every UI_INTERVAL_MS.
  const statsRef = useRef({ chunks: 0, levelMax: 0, heard: false, lastUi: 0 });

  const [status, setStatus] = useState<MicrophoneStatus>("idle");
  const [error, setError] = useState<MicrophoneError | null>(null);
  const [meter, setMeter] = useState<MicrophoneMeter>(IDLE_METER);
  const [inputSampleRate, setInputSampleRate] = useState<number | null>(null);

  const release = useCallback(() => {
    const capture = captureRef.current;
    captureRef.current = null;
    if (capture) {
      devLog(
        "mic",
        `session summary: ${statsRef.current.chunks} chunk(s) of ${CHUNK_MS} ms converted and discarded`,
      );
      capture.stop();
    }
    statsRef.current = { chunks: 0, levelMax: 0, heard: false, lastUi: 0 };
  }, []);

  const cancelPending = useCallback(() => {
    requestIdRef.current += 1;
    requestingRef.current = false;
  }, []);

  const resetUi = useCallback(() => {
    setMeter(IDLE_METER);
    setInputSampleRate(null);
  }, []);

  const fail = useCallback(
    (err: MicrophoneError, cause?: unknown) => {
      devLog("mic", `failed: ${err.kind}`, cause && describeError(cause));
      cancelPending();
      release();
      resetUi();
      setError(err);
      setStatus("error");
    },
    [cancelPending, release, resetUi],
  );

  const stop = useCallback(() => {
    devLog("mic", "stop requested");
    cancelPending();
    release();
    resetUi();
    setError(null);
    setStatus("idle");
  }, [cancelPending, release, resetUi]);

  const start = useCallback(async () => {
    devLog("mic", "start requested");
    if (captureRef.current || requestingRef.current) {
      devLog("mic", "start ignored: already starting or running");
      return;
    }

    const id = ++requestIdRef.current;
    requestingRef.current = true;
    setError(null);
    setStatus("requesting-permissions");

    try {
      const capture = await startMicCapture({
        onChunk: () => {
          // Converted PCM16 is intentionally dropped in this milestone.
          if (id === requestIdRef.current) statsRef.current.chunks += 1;
        },
        onLevel: (level) => {
          if (id !== requestIdRef.current) return;
          const stats = statsRef.current;
          stats.levelMax = Math.max(stats.levelMax, level);
          if (level > SOUND_LEVEL) stats.heard = true;
          const now = performance.now();
          if (now - stats.lastUi < UI_INTERVAL_MS) return;
          stats.lastUi = now;
          setMeter({
            level: stats.levelMax,
            seconds: (stats.chunks * CHUNK_MS) / 1000,
            heardSound: stats.heard,
          });
          stats.levelMax = 0;
        },
        onEnded: (kind) => {
          if (id === requestIdRef.current) fail(microphoneError(kind));
        },
      });

      // Stopped, unmounted or restarted while the permission prompt was open.
      if (id !== requestIdRef.current) {
        devLog("mic", "stale request resolved; stopping its capture");
        capture.stop();
        return;
      }

      captureRef.current = capture;
      requestingRef.current = false;
      setInputSampleRate(capture.inputSampleRate);
      setStatus("listening");
      devLog("mic", "listening");
    } catch (err) {
      if (id !== requestIdRef.current) return;
      fail(toMicrophoneError(err), err);
    }
  }, [fail]);

  useEffect(() => {
    // Hidden/backgrounded pages must not keep the microphone on.
    const onVisibility = () => {
      if (document.visibilityState === "hidden" && captureRef.current) {
        fail(microphoneError("page-hidden"));
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", stop);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", stop);
      // Unmount: cancel any pending request and release everything. No setState.
      cancelPending();
      release();
    };
  }, [fail, stop, cancelPending, release]);

  return { status, error, meter, inputSampleRate, start, stop };
}
