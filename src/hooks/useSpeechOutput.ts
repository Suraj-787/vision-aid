"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { devLog } from "@/lib/dev-log";
import type { AskResult } from "@/lib/ask/ask-result";
import { planPlayback } from "@/lib/speech/plan";
import {
  SpeechPlayer,
  type PlayerEvent,
  type PlayerState,
  type SynthLike,
  type UtteranceLike,
} from "@/lib/speech/player";
import { speechOutputError, type SpeechOutputError } from "@/lib/speech/speech-output-errors";
import { buildSpokenSegments } from "@/lib/speech/spoken-text";
import type { SupportedLang } from "@/lib/speech/types";
import { describeVoiceSupport, type VoiceSupport } from "@/lib/speech/voices";

/** Voices are often delivered late (Chrome) or never (some browsers): stop saying "checking" after this long. */
const VOICES_SETTLE_MS = 1500;

function synthesisAvailable(): boolean {
  return (
    typeof window !== "undefined" &&
    "speechSynthesis" in window &&
    typeof window.SpeechSynthesisUtterance === "function"
  );
}

const subscribeNever = () => () => {};

// ---- installed voices, as an external store (the list changes when the browser finishes loading them) ----
let voiceCache: SpeechSynthesisVoice[] = [];
let voiceCacheReady = false;

function refreshVoices(): boolean {
  const next = window.speechSynthesis.getVoices();
  const changed = next.length !== voiceCache.length || next.some((v, i) => v !== voiceCache[i]);
  if (changed || !voiceCacheReady) {
    voiceCache = changed ? next : voiceCache;
    voiceCacheReady = true;
    return changed;
  }
  return false;
}

function subscribeVoices(onChange: () => void): () => void {
  if (!synthesisAvailable()) return () => {};
  const synth = window.speechSynthesis;
  const handler = () => {
    if (refreshVoices()) onChange();
  };
  synth.addEventListener("voiceschanged", handler);
  handler(); // voices may have arrived between render and subscribe
  return () => synth.removeEventListener("voiceschanged", handler);
}

const NO_VOICES: SpeechSynthesisVoice[] = [];
function getVoicesSnapshot(): SpeechSynthesisVoice[] {
  if (!synthesisAvailable()) return NO_VOICES;
  if (!voiceCacheReady) refreshVoices();
  return voiceCache;
}
const getServerVoices = () => NO_VOICES;

interface UseSpeechOutputOptions {
  /** Short status messages for the page's live region (never the answer text). */
  announce?: (message: string) => void;
  /** Called right before speaking starts, e.g. to stop the microphone test. */
  onBeforeSpeak?: () => void;
}

/**
 * Spoken output for a displayed answer (Milestone 7), using the browser's
 * `speechSynthesis`. Speaks only when listen() is called from a user action,
 * never automatically. Playback is stopped on stop(), on unmount, when the page
 * is hidden and when it is left; the player guarantees one playback at a time and
 * ignores stale events from earlier playback. Nothing spoken is stored or logged.
 */
export function useSpeechOutput({ announce, onBeforeSpeak }: UseSpeechOutputOptions = {}) {
  const supported = useSyncExternalStore(subscribeNever, synthesisAvailable, () => false);
  const voices = useSyncExternalStore(subscribeVoices, getVoicesSnapshot, getServerVoices);
  const [timedOut, setTimedOut] = useState(false);
  const [state, setState] = useState<PlayerState>("idle");
  const [error, setError] = useState<SpeechOutputError | null>(null);
  const [notes, setNotes] = useState<string[]>([]);
  const [pauseUnsupported, setPauseUnsupported] = useState(false);

  const playerRef = useRef<SpeechPlayer | null>(null);
  const announceRef = useRef(announce);
  const beforeSpeakRef = useRef(onBeforeSpeak);
  useEffect(() => {
    announceRef.current = announce;
    beforeSpeakRef.current = onBeforeSpeak;
  });

  // Gives up waiting for voices after a while (some browsers never report any).
  useEffect(() => {
    if (!supported) return;
    const timer = setTimeout(() => setTimedOut(true), VOICES_SETTLE_MS);
    return () => clearTimeout(timer);
  }, [supported]);

  // The player lives for as long as the component; dispose() cancels speech on unmount.
  useEffect(() => {
    if (!supported) return;
    const synth = window.speechSynthesis;
    const handle = (event: PlayerEvent) => {
      switch (event.type) {
        case "state":
          setState(event.state);
          if (event.state === "paused") announceRef.current?.("Paused.");
          break;
        case "finished":
          devLog("speech-out", "finished");
          announceRef.current?.("Finished reading the answer.");
          break;
        case "error": {
          devLog("speech-out", `error: ${event.kind}`);
          const failure = speechOutputError(event.kind);
          setError(failure);
          announceRef.current?.(failure.message);
          break;
        }
        case "pause-unsupported":
          setPauseUnsupported(true);
          announceRef.current?.("Pause is not available on this device. Use Stop speaking instead.");
          break;
      }
    };
    const player = new SpeechPlayer({
      synth: synth as unknown as SynthLike,
      createUtterance: (text) => new window.SpeechSynthesisUtterance(text) as unknown as UtteranceLike,
      onEvent: handle,
    });
    playerRef.current = player;

    // Hidden or left: speech cannot be relied on in the background, and a locked
    // phone must not keep reading an answer aloud.
    const stopForPage = () => player.stop();
    const onVisibility = () => {
      if (document.visibilityState === "hidden") stopForPage();
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", stopForPage);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", stopForPage);
      player.dispose();
      playerRef.current = null;
    };
  }, [supported]);

  /** Reads the answer aloud. Returns true when speech started. */
  const listen = useCallback(
    (result: AskResult): boolean => {
      const player = playerRef.current;
      if (player && player.state !== "idle") return false; // already reading: a second tap must not start a second playback or wipe the notes
      setError(null);
      setNotes([]);
      if (!supported || !player) {
        setError(speechOutputError("unsupported"));
        return false;
      }
      const segments = buildSpokenSegments(result);
      if (segments.length === 0) {
        setError(speechOutputError("failed", "There is nothing in this answer to read aloud."));
        return false;
      }
      const plan = planPlayback(segments, window.speechSynthesis.getVoices());
      setNotes(plan.notes);
      if (plan.chunks.length === 0) {
        setError(speechOutputError("no-voice", plan.notes[0]));
        return false;
      }
      beforeSpeakRef.current?.();
      setPauseUnsupported(false);
      devLog("speech-out", `speaking ${plan.chunks.length} part(s)`);
      return player.play(plan.chunks);
    },
    [supported],
  );

  const pause = useCallback(() => playerRef.current?.pause(), []);
  const resume = useCallback(() => {
    const player = playerRef.current;
    if (!player || player.state !== "paused") return;
    player.resume();
    announceRef.current?.("Resumed.");
  }, []);

  /** The Stop speaking button. */
  const stopByUser = useCallback(() => {
    const player = playerRef.current;
    if (!player || player.state === "idle") return;
    player.stop();
    announceRef.current?.("Stopped reading.");
  }, []);

  /** Silent stop for lifecycle changes (Cancel, Retake, a new question, ...). */
  const stop = useCallback(() => playerRef.current?.stop(), []);

  const clearError = useCallback(() => {
    setError(null);
    setNotes([]);
  }, []);

  const support = useCallback(
    (lang: SupportedLang): VoiceSupport =>
      describeVoiceSupport(lang, voices, {
        synthesisSupported: supported,
        settled: voices.length > 0 || timedOut,
      }),
    [voices, supported, timedOut],
  );

  return {
    supported,
    state,
    error,
    notes,
    pauseUnsupported,
    listen,
    pause,
    resume,
    stopByUser,
    stop,
    clearError,
    support,
  };
}
