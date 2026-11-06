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
import { langInfo, type SupportedLang } from "@/lib/speech/types";
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

/** What VisionAid is saying: the answer (with Pause/Resume controls) or a short spoken guidance prompt. */
export type SpeechPurpose = "answer" | "guidance";

export type SayOutcome = "started" | "no-voice" | "unsupported" | "busy";

/**
 * Spoken output through the browser's `speechSynthesis`: reading a displayed answer
 * (Milestone 7) and short voice guidance (Milestone 9). Both go through ONE player, so
 * VisionAid can never speak two things at once. Speech starts only from a user action
 * or, in voice-guided mode, as a direct consequence of one. It is stopped on stop(), on
 * unmount, when the page is hidden and when it is left; the player ignores stale events
 * from earlier playback. Nothing spoken is stored or logged.
 */
export function useSpeechOutput({ announce, onBeforeSpeak }: UseSpeechOutputOptions = {}) {
  const supported = useSyncExternalStore(subscribeNever, synthesisAvailable, () => false);
  const voices = useSyncExternalStore(subscribeVoices, getVoicesSnapshot, getServerVoices);
  const [timedOut, setTimedOut] = useState(false);
  const [state, setState] = useState<PlayerState>("idle");
  const [purpose, setPurpose] = useState<SpeechPurpose | null>(null);
  const [error, setError] = useState<SpeechOutputError | null>(null);
  const [notes, setNotes] = useState<string[]>([]);
  const [pauseUnsupported, setPauseUnsupported] = useState(false);
  const [guidanceNote, setGuidanceNote] = useState<string | null>(null);

  const playerRef = useRef<SpeechPlayer | null>(null);
  const announceRef = useRef(announce);
  const beforeSpeakRef = useRef(onBeforeSpeak);
  const purposeRef = useRef<SpeechPurpose | null>(null);
  const doneRef = useRef<(() => void) | null>(null);
  useEffect(() => {
    announceRef.current = announce;
    beforeSpeakRef.current = onBeforeSpeak;
  });

  const setPurposeBoth = useCallback((next: SpeechPurpose | null) => {
    purposeRef.current = next;
    setPurpose(next);
  }, []);

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
      const guidance = purposeRef.current === "guidance";
      switch (event.type) {
        case "state":
          setState(event.state);
          if (event.state === "paused" && !guidance) announceRef.current?.("Paused.");
          break;
        case "finished": {
          devLog("speech-out", "finished");
          if (guidance) {
            const done = doneRef.current;
            doneRef.current = null;
            setPurposeBoth(null);
            done?.();
          } else {
            announceRef.current?.("Finished reading the answer.");
          }
          break;
        }
        case "error": {
          devLog("speech-out", `error: ${event.kind}`);
          const failure = speechOutputError(event.kind);
          doneRef.current = null;
          if (guidance) {
            // A prompt that could not be spoken is reported, not retried; the same words
            // are in the screen-reader announcement.
            setGuidanceNote(failure.message);
            setPurposeBoth(null);
          } else {
            setError(failure);
            announceRef.current?.(failure.message);
          }
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
    const stopForPage = () => {
      doneRef.current = null;
      player.stop();
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") stopForPage();
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", stopForPage);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", stopForPage);
      doneRef.current = null;
      player.dispose();
      playerRef.current = null;
    };
  }, [supported, setPurposeBoth]);

  /** Reads the answer aloud. Returns true when speech started. */
  const listen = useCallback(
    (result: AskResult): boolean => {
      const player = playerRef.current;
      if (player && player.state !== "idle") {
        // A second tap while the answer is being read must not start a second playback.
        if (purposeRef.current !== "guidance") return false;
        // Guidance is short and the person asked for the answer: let the answer win.
        doneRef.current = null;
        player.stop();
      }
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
      setPurposeBoth("answer");
      devLog("speech-out", `speaking ${plan.chunks.length} part(s)`);
      return player.play(plan.chunks);
    },
    [supported, setPurposeBoth],
  );

  /**
   * Speaks one short guidance prompt in `lang`. A prompt replaces an earlier prompt, but
   * never interrupts an answer being read. If no voice for `lang` is installed the prompt
   * is NOT spoken in another language: the reason is recorded in `guidanceNote`.
   * `onDone` runs only when the prompt finished by itself (not when it was stopped).
   */
  const say = useCallback(
    (text: string, lang: SupportedLang, onDone?: () => void): SayOutcome => {
      const player = playerRef.current;
      if (!supported || !player) return "unsupported";
      if (player.state !== "idle") {
        if (purposeRef.current !== "guidance") return "busy";
        doneRef.current = null;
        player.stop();
      }
      const plan = planPlayback([{ text, lang, mixed: false }], window.speechSynthesis.getVoices());
      if (plan.chunks.length === 0) {
        setGuidanceNote(
          `Voice guidance cannot be spoken in ${langInfo(lang).englishName}: ${plan.notes[0] ?? "no voice is installed."} Messages are still announced to your screen reader.`,
        );
        return "no-voice";
      }
      setGuidanceNote(null);
      beforeSpeakRef.current?.();
      doneRef.current = onDone ?? null;
      setPurposeBoth("guidance");
      if (!player.play(plan.chunks)) {
        doneRef.current = null;
        setPurposeBoth(null);
        return "busy";
      }
      return "started";
    },
    [supported, setPurposeBoth],
  );

  const pause = useCallback(() => {
    if (purposeRef.current === "answer") playerRef.current?.pause();
  }, []);
  const resume = useCallback(() => {
    const player = playerRef.current;
    if (!player || player.state !== "paused" || purposeRef.current !== "answer") return;
    player.resume();
    announceRef.current?.("Resumed.");
  }, []);

  /** The Stop speaking button (answer playback). */
  const stopByUser = useCallback(() => {
    const player = playerRef.current;
    if (!player || player.state === "idle") return;
    doneRef.current = null;
    player.stop();
    announceRef.current?.("Stopped reading.");
  }, []);

  /** Silent stop for lifecycle changes (Cancel, Retake, a new question, ...) and for the voice bar / Escape. */
  const stop = useCallback(() => {
    doneRef.current = null;
    playerRef.current?.stop();
  }, []);

  /** True while anything (answer or guidance) is being spoken. Reads the player directly, so it is current within the same tick. */
  const isSpeaking = useCallback(() => (playerRef.current?.state ?? "idle") !== "idle", []);
  const isSpeakingGuidance = useCallback(
    () => (playerRef.current?.state ?? "idle") !== "idle" && purposeRef.current === "guidance",
    [],
  );

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
    /** The answer playback state (guidance does not drive the Listen / Pause controls). */
    state: purpose === "answer" ? state : ("idle" as PlayerState),
    /** True while anything, including guidance, is being spoken. */
    speaking: state !== "idle",
    purpose,
    error,
    notes,
    guidanceNote,
    pauseUnsupported,
    listen,
    say,
    pause,
    resume,
    stopByUser,
    stop,
    isSpeaking,
    isSpeakingGuidance,
    clearError,
    support,
  };
}
