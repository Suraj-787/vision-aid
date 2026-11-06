"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { describeError, devLog } from "@/lib/dev-log";
import { speechError, type SpeechError } from "@/lib/speech/speech-errors";
import type { SpeechSession, SupportedLang } from "@/lib/speech/types";
import {
  isWebSpeechSupported,
  SpeechStartError,
  startWebSpeech,
} from "@/lib/speech/web-speech";

/** If a browser never fires `end` after stop(), force-finish after this long. */
const STOP_TIMEOUT_MS = 3000;

const subscribeNever = () => () => {};

export interface StartSpeechOptions {
  lang: SupportedLang;
  onTranscript: (text: string) => void;
  /** Called once when recognition has finished for any reason except abort(). */
  onEnd: () => void;
}

/**
 * Browser speech recognition for the question (Milestone 4). Starts only when
 * start() is called from a user action. Audio is handled by the browser's own
 * engine (which may use an external service); only text reaches the page, and
 * transcripts are never logged or stored.
 */
export function useSpeechInput() {
  // false on the server and during hydration, then the real answer: no effect needed.
  const supported = useSyncExternalStore(subscribeNever, isWebSpeechSupported, () => false);

  const sessionRef = useRef<SpeechSession | null>(null);
  const onEndRef = useRef<(() => void) | null>(null);
  const stopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [error, setError] = useState<SpeechError | null>(null);

  const clearStopTimer = useCallback(() => {
    if (stopTimerRef.current !== null) {
      clearTimeout(stopTimerRef.current);
      stopTimerRef.current = null;
    }
  }, []);

  /** Cancels immediately without delivering onEnd. Safe to call any time. */
  const abort = useCallback(() => {
    clearStopTimer();
    const session = sessionRef.current;
    sessionRef.current = null;
    onEndRef.current = null;
    session?.abort();
  }, [clearStopTimer]);

  const clearError = useCallback(() => setError(null), []);

  const finish = useCallback(
    (session: SpeechSession) => {
      if (sessionRef.current !== session) return; // already aborted/replaced
      clearStopTimer();
      const onEnd = onEndRef.current;
      sessionRef.current = null;
      onEndRef.current = null;
      onEnd?.();
    },
    [clearStopTimer],
  );

  const start = useCallback(
    (options: StartSpeechOptions) => {
      // A second tap in the same moment must not start a second recognition.
      if (sessionRef.current) return false;
      abort();
      setError(null);
      devLog("speech", `starting recognition (lang ${options.lang})`);
      try {
        const session: SpeechSession = startWebSpeech(options.lang, {
          onTranscript: (text) => {
            if (sessionRef.current === session) options.onTranscript(text);
          },
          onError: (kind) => {
            devLog("speech", `error: ${kind}`);
            if (sessionRef.current === session) setError(speechError(kind));
          },
          onEnd: () => finish(session),
        });
        sessionRef.current = session;
        onEndRef.current = options.onEnd;
        return true;
      } catch (err) {
        const kind = err instanceof SpeechStartError ? err.kind : "start-failed";
        devLog("speech", `could not start: ${kind}`, describeError(err));
        setError(speechError(kind));
        return false;
      }
    },
    [abort, finish],
  );

  /** User pressed "Stop speaking": let the engine deliver its final result. */
  const stop = useCallback(() => {
    const session = sessionRef.current;
    if (!session) return;
    devLog("speech", "stop requested");
    session.stop();
    clearStopTimer();
    stopTimerRef.current = setTimeout(() => {
      devLog("speech", "no end event after stop; forcing finish");
      session.abort();
      finish(session);
    }, STOP_TIMEOUT_MS);
  }, [clearStopTimer, finish]);

  // Unmount: cancel any recognition. No setState here.
  useEffect(() => abort, [abort]);

  return { supported, error, start, stop, abort, clearError };
}
