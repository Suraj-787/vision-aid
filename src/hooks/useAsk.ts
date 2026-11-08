"use client";

import { useCallback, useEffect, useReducer, useRef, useState, type RefObject } from "react";
import { useAnnouncer } from "@/hooks/useAnnouncer";
import { useSpeechInput } from "@/hooks/useSpeechInput";
import { useSpeechOutput } from "@/hooks/useSpeechOutput";
import {
  askBlockedReason,
  askReducer,
  canAsk,
  canCapture,
  canEditQuestion,
  canListen,
  canRetake,
  canRetry,
  deriveAskPhase,
  INITIAL_ASK_CONTEXT,
} from "@/lib/ask/ask-flow";
import { postAsk, type AskFailure } from "@/lib/ask/client";
import type { AskResult } from "@/lib/ask/ask-result";
import { devLog } from "@/lib/dev-log";
import { captureStill, toCaptureError, type CapturedImage } from "@/lib/image/capture";
import { answerLanguageNotes, chooseResponseLanguage } from "@/lib/speech/answer-language";
import { DEFAULT_LANG, type SupportedLang } from "@/lib/speech/types";
import { answerReadyAnnouncement, photoCapturedAnnouncement, transcriptAnnouncement } from "@/lib/a11y/messages";
import { effectiveAutoRead, effectiveVoiceAsk, isVoiceGuided, type A11yPrefs } from "@/lib/a11y/preferences";
import {
  ASK_BY_VOICE_SENDING,
  ASK_NEEDS_CONFIRMATION,
  commandHelp,
  commandLabel,
  commandUnavailable,
  deriveCommandStep,
  isCommandAvailable,
  parseCommand,
  type CommandContext,
} from "@/lib/commands/voice-commands";
import { guidanceText, photoGuidance } from "@/lib/guidance/messages";

/** Voice commands are English only (see lib/commands/voice-commands.ts). */
const COMMAND_LANG: SupportedLang = "en-IN";

export type FocusTarget = "question" | "ask" | "primary";

interface UseAskOptions {
  videoRef: RefObject<HTMLVideoElement | null>;
  /** True while the camera preview is live (useCamera status "camera-ready"). */
  cameraActive: boolean;
  /** Called right before speech starts, e.g. to stop the microphone test. */
  onBeforeListen?: () => void;
  /** Accessibility preferences (interaction mode, automatic reading, voice commands). */
  prefs: A11yPrefs;
}

/**
 * Coordinates the Tap-to-Ask interaction: reuses the camera preview (via
 * `videoRef`), captures one still, collects a spoken or typed question, and on
 * Ask sends the already-captured photo and question to /api/ask (one request,
 * no automatic retry). Photo, question, answer and any error exist only in
 * memory and are discarded on Retake, Cancel, leaving the page and unmount.
 *
 * Responses are guarded by a request id: a reply that arrives after Cancel,
 * Retake, a newer request or unmount is ignored, and the fetch is aborted.
 */
export function useAsk({ videoRef, cameraActive, onBeforeListen, prefs }: UseAskOptions) {
  const [flow, dispatch] = useReducer(askReducer, INITIAL_ASK_CONTEXT);
  const [image, setImage] = useState<CapturedImage | null>(null);
  const [captureError, setCaptureError] = useState<string | null>(null);
  const [result, setResult] = useState<AskResult | null>(null);
  const [sendError, setSendError] = useState<AskFailure | null>(null);
  const [lang, setLang] = useState<SupportedLang>(DEFAULT_LANG);
  // The answer language that was sent with the current answer (the selector may change afterwards).
  const [answerLang, setAnswerLang] = useState<SupportedLang>(DEFAULT_LANG);
  const [answerSelectedLang, setAnswerSelectedLang] = useState<SupportedLang>(DEFAULT_LANG);
  const { message: announcement, announce } = useAnnouncer();
  const [commandActive, setCommandActiveState] = useState(false);
  // The same flag, readable at once: a command that ends hands over to the next action
  // (for example dictation) before React has re-rendered, and that action must not see a stale "still listening".
  const commandActiveRef = useRef(false);
  const setCommandActive = useCallback((active: boolean) => {
    commandActiveRef.current = active;
    setCommandActiveState(active);
  }, []);
  // The outcome of the last voice command, shown on screen as well as announced.
  const [commandMessage, setCommandMessage] = useState<string | null>(null);
  const [focusRequest, setFocusRequest] = useState<{ target: FocusTarget | null; n: number }>({ target: null, n: 0 });

  const speech = useSpeechInput();
  const { abort: abortSpeech, clearError: clearSpeechError } = speech;

  const imageRef = useRef<CapturedImage | null>(null);
  const capturingRef = useRef(false);
  // Bumped on retake/cancel/unmount so an in-flight capture can tell it is stale.
  const generationRef = useRef(0);
  // Same idea for the network request, plus its AbortController.
  const requestIdRef = useRef(0);
  const requestAbortRef = useRef<AbortController | null>(null);
  const requestInFlightRef = useRef(false);

  const phase = deriveAskPhase(flow, cameraActive);

  const output = useSpeechOutput({ announce, onBeforeSpeak: onBeforeListen });
  const {
    stop: stopOutput,
    clearError: clearOutputError,
    say,
    listen: listenOutput,
    isSpeaking,
    isSpeakingGuidance,
  } = output;

  // The newest values for callbacks that run later (end of a spoken prompt, end of a command).
  const latest = useRef<{
    flow: typeof flow;
    cameraActive: boolean;
    result: AskResult | null;
    prefs: A11yPrefs;
    lang: SupportedLang;
  }>({ flow, cameraActive, result, prefs, lang });
  useEffect(() => {
    latest.current = { flow, cameraActive, result, prefs, lang };
  });
  const promptPendingRef = useRef(false);
  // Set when the browser refused to start listening after a spoken prompt (no tap at that moment):
  // the next tap then starts at once, without another prompt.
  const skipPromptRef = useRef(false);

  const requestFocus = useCallback((target: FocusTarget) => setFocusRequest((f) => ({ target, n: f.n + 1 })), []);

  /** Speaks a guidance prompt, in the chosen language, only in voice-guided mode. */
  const guide = useCallback(
    (text: string, onDone?: () => void) => (isVoiceGuided(latest.current.prefs) ? say(text, latest.current.lang, onDone) : "busy"),
    [say],
  );

  /** Frees the preview object URL (no state change; safe in cleanup). */
  const releaseImage = useCallback(() => {
    const current = imageRef.current;
    imageRef.current = null;
    if (current) URL.revokeObjectURL(current.url);
  }, []);

  const discardImage = useCallback(() => {
    releaseImage();
    setImage(null);
  }, [releaseImage]);

  /** Aborts any request and invalidates its reply. No state change; safe in cleanup. */
  const abortRequest = useCallback(() => {
    requestIdRef.current += 1;
    requestAbortRef.current?.abort();
    requestAbortRef.current = null;
    requestInFlightRef.current = false;
  }, []);

  // Anything that removes or replaces the answer also stops it being read aloud.
  const clearAnswer = useCallback(() => {
    stopOutput();
    clearOutputError();
    setResult(null);
    setSendError(null);
  }, [stopOutput, clearOutputError]);

  const capture = useCallback(async () => {
    const video = videoRef.current;
    if (!video || capturingRef.current || !canCapture(flow, cameraActive)) return;

    capturingRef.current = true;
    const generation = ++generationRef.current;
    setCaptureError(null);
    dispatch({ type: "CAPTURE_REQUESTED", cameraActive });
    announce("Capturing photo.");
    devLog("ask", "capture requested");

    try {
      const captured = await captureStill(video);
      if (generation !== generationRef.current) {
        URL.revokeObjectURL(captured.url); // cancelled while encoding
        return;
      }
      releaseImage();
      imageRef.current = captured;
      setImage(captured);
      dispatch({ type: "CAPTURE_SUCCEEDED" });
      devLog(
        "ask",
        `captured ${captured.width}x${captured.height}, ${Math.round(captured.bytes / 1024)} KB, issues: ${captured.quality.issues.join(",") || "none"}`,
      );
      // Focus moves to the "Photo captured" heading, so the announcement adds only what
      // it does not say (advice about the photo and the next step).
      announce(photoCapturedAnnouncement(captured.quality.issues));
      guide(photoGuidance(latest.current.lang, captured.quality.issues.length > 0));
    } catch (err) {
      if (generation !== generationRef.current) return;
      const failure = toCaptureError(err);
      devLog("ask", `capture failed: ${failure.kind}`);
      dispatch({ type: "CAPTURE_FAILED" });
      setCaptureError(failure.message); // shown as an alert, which announces it
    } finally {
      if (generation === generationRef.current) capturingRef.current = false;
    }
  }, [videoRef, flow, cameraActive, announce, releaseImage, guide]);

  const retake = useCallback(() => {
    if (!canRetake(flow)) return;
    abortSpeech();
    setCommandActive(false);
    clearSpeechError();
    abortRequest();
    clearAnswer();
    generationRef.current += 1;
    capturingRef.current = false;
    discardImage();
    setCaptureError(null);
    dispatch({ type: "RETAKE" });
    announce(
      cameraActive
        ? "Photo discarded. The camera preview is showing. Tap Capture photo."
        : "Photo discarded. Start the camera to take a new photo.",
    );
  }, [flow, cameraActive, abortSpeech, clearSpeechError, abortRequest, clearAnswer, discardImage, announce, setCommandActive]);

  const cancel = useCallback((message?: string) => {
    abortSpeech();
    setCommandActive(false);
    clearSpeechError();
    abortRequest();
    clearAnswer();
    generationRef.current += 1;
    capturingRef.current = false;
    discardImage();
    setCaptureError(null);
    dispatch({ type: "CANCEL" });
    announce(typeof message === "string" ? message : "Cancelled. The photo, question and answer were discarded.");
  }, [abortSpeech, clearSpeechError, abortRequest, clearAnswer, discardImage, announce, setCommandActive]);

  const setQuestion = useCallback((text: string) => {
    dispatch({ type: "QUESTION_CHANGED", text });
  }, []);

  /** Starts the browser's recognition for the question. Reports what it heard when it ends. */
  const beginRecognition = useCallback((): boolean => {
    let lastText = "";
    const started = speech.start({
      lang,
      onTranscript: (text) => {
        lastText = text;
        dispatch({ type: "TRANSCRIPT", text });
      },
      onEnd: () => {
        dispatch({ type: "LISTEN_ENDED" });
        announce(transcriptAnnouncement(lastText));
      },
    });
    if (started) {
      dispatch({ type: "LISTEN_STARTED" });
      announce("Listening. Speak your question.");
    }
    return started;
  }, [lang, speech, announce]);

  const startListening = useCallback(() => {
    if (!canListen(flow) || !speech.supported) return;
    if (commandActiveRef.current) {
      // A voice command is being listened for: dictation cannot start at the same time.
      const message = "VisionAid is listening for a voice command. Wait for it to finish, or tap Stop listening.";
      setCommandMessage(message);
      announce(message);
      return;
    }
    if (promptPendingRef.current && isSpeakingGuidance()) return; // the prompt is already playing
    stopOutput(); // the microphone must not hear VisionAid speaking
    onBeforeListen?.();
    if (isVoiceGuided(latest.current.prefs) && !skipPromptRef.current) {
      // Speak the prompt first and listen only when it has finished, so the microphone never hears it.
      promptPendingRef.current = true;
      const outcome = say(guidanceText("listening", lang), lang, () => {
        promptPendingRef.current = false;
        if (!canListen(latest.current.flow)) return;
        if (!beginRecognition()) skipPromptRef.current = true;
      });
      if (outcome === "started") return;
      promptPendingRef.current = false;
    }
    skipPromptRef.current = false;
    beginRecognition();
  }, [flow, lang, speech, say, isSpeakingGuidance, stopOutput, onBeforeListen, beginRecognition, announce]);

  const stopListening = useCallback(() => speech.stop(), [speech]);

  /** Cancels speech immediately (e.g. another feature needs the microphone). */
  const abortListening = useCallback(() => {
    abortSpeech();
    setCommandActive(false);
    dispatch({ type: "LISTEN_ENDED" });
  }, [abortSpeech, setCommandActive]);

  /**
   * Sends the captured photo and the question. Only ever called from the Ask or
   * Retry button. The ref check makes a double activation in the same tick a
   * no-op even before React re-renders; the reducer rejects it afterwards.
   */
  const submit = useCallback(
    (kind: "ask" | "retry") => {
      if (requestInFlightRef.current) return;
      const captured = imageRef.current;
      if (!captured || !(kind === "ask" ? canAsk(flow) : canRetry(flow))) return;

      requestInFlightRef.current = true;
      const responseLanguage = chooseResponseLanguage(lang, flow.question);
      setAnswerLang(responseLanguage);
      setAnswerSelectedLang(lang);
      const id = ++requestIdRef.current;
      const controller = new AbortController();
      requestAbortRef.current = controller;
      clearAnswer();
      dispatch({ type: kind === "ask" ? "ASK" : "RETRY" });
      announce("Sending your photo and question to Google's Gemini service. Please wait.");
      guide(guidanceText("processing", lang));
      devLog("ask", `request started (${kind})`);

      void postAsk({
        image: captured.blob,
        question: flow.question.trim(),
        responseLanguage,
        signal: controller.signal,
      }).then((outcome) => {
        // Cancelled, retaken, replaced by a newer request, or unmounted: ignore.
        if (id !== requestIdRef.current) return;
        requestInFlightRef.current = false;
        requestAbortRef.current = null;
        if (outcome.ok) {
          devLog("ask", "answer received");
          setResult(outcome.result);
          dispatch({ type: "SEND_SUCCEEDED" });
          // Focus moves to the Answer heading; the answer itself is NOT read out automatically.
          announce(answerReadyAnnouncement(outcome.result));
          const answer = outcome.result;
          const autoRead = effectiveAutoRead(latest.current.prefs);
          const outcomeSay = guide(guidanceText("answer-ready", lang), () => {
            if (autoRead) listenOutput(answer);
          });
          if (outcomeSay !== "started" && autoRead) listenOutput(answer);
        } else {
          devLog("ask", `request failed: ${outcome.error.code}`);
          setSendError(outcome.error);
          dispatch({ type: "SEND_FAILED" });
          // The failure card takes focus and its message is an alert: no extra announcement.
          guide(guidanceText("failed", lang));
        }
      });
    },
    [flow, lang, announce, clearAnswer, guide, listenOutput],
  );

  const ask = useCallback(() => submit("ask"), [submit]);
  const retry = useCallback(() => submit("retry"), [submit]);

  /** Reads the displayed answer aloud. Only ever called from the Listen button. */
  const listenToAnswer = useCallback(() => {
    if (!result) return;
    abortSpeech(); // recognition and synthesis never run together
    announce(""); // so a repeated "Stopped" / "Paused" is announced again
    listenOutput(result);
  }, [result, abortSpeech, announce, listenOutput]);

  /** Stops anything VisionAid is saying, and a spoken prompt that is waiting to start the microphone. */
  const stopAllSpeech = useCallback(() => {
    promptPendingRef.current = false;
    stopOutput();
  }, [stopOutput]);

  // Escape stops VisionAid's speech at once (a hardware or Bluetooth keyboard).
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || !isSpeaking()) return;
      stopAllSpeech();
      announce("Speech stopped.");
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [isSpeaking, stopAllSpeech, announce]);

  // Voice guidance: the camera became ready (a state change, so it is spoken once).
  useEffect(() => {
    if (cameraActive) guide(guidanceText("camera-ready", latest.current.lang));
  }, [cameraActive, guide]);

  const speakCameraError = useCallback(() => void guide(guidanceText("camera-error", latest.current.lang)), [guide]);
  const speakWelcome = useCallback(() => void say(guidanceText("welcome", latest.current.lang), latest.current.lang), [say]);

  // ---- voice commands (optional, English, one explicit activation = one command) ----
  const runCommand = useCallback(
    (heard: string) => {
      const l = latest.current;
      const ctx: CommandContext = { step: deriveCommandStep(l.flow.phase, l.flow.hasImage, l.cameraActive) };
      const said = heard.replace(/\s+/g, " ").trim().slice(0, 60); // shown briefly, never stored or logged
      const report = (message: string) => {
        setCommandMessage(message);
        announce(message);
      };
      if (said === "") return report("I did not hear a command. Tap Say a command and try again.");
      const command = parseCommand(said);
      if (!command) return report(`I heard \u201c${said}\u201d. ${commandHelp(ctx)}`);
      if (!isCommandAvailable(command, ctx)) return report(commandUnavailable(command, ctx));
      setCommandMessage(`Command understood: ${commandLabel(command)}.`); // the action itself announces its result
      switch (command) {
        case "capture-photo":
          return void capture();
        case "retake-photo":
          return retake();
        case "start-speaking":
          return startListening();
        case "repeat-answer":
          return listenToAnswer();
        case "done":
          // Ends this conversation: the photo, question and answer are discarded (nothing was or is sent).
          cancel(
            (ctx.step === "sending"
              ? "Done. The request was cancelled and the photo and question were discarded on this device."
              : "Done. The photo, question and answer were discarded on this device.") +
              (l.cameraActive ? " Say capture photo, or use Capture photo, for a new one." : " Start the camera to take a new photo."),
          );
          return requestFocus("primary");
        case "ask":
          if (effectiveVoiceAsk(l.prefs)) {
            // The person turned on "Ask by voice" (and was told it sends straight away): send now.
            setCommandMessage(ASK_BY_VOICE_SENDING);
            return ask();
          }
          // Default: it does not send. The photo and question go to Google only when the person activates Ask.
          requestFocus("ask");
          setCommandMessage(ASK_NEEDS_CONFIRMATION);
          return announce(ASK_NEEDS_CONFIRMATION);
      }
    },
    [announce, capture, retake, cancel, ask, startListening, listenToAnswer, requestFocus],
  );
  const runCommandRef = useRef(runCommand);
  useEffect(() => {
    runCommandRef.current = runCommand;
  });

  const startCommand = useCallback(() => {
    if (!prefs.voiceCommands || !speech.supported || commandActiveRef.current) return;
    if (phase === "listening" || phase === "capturing") {
      // Dictating or capturing: the microphone or camera step must finish first.
      const message = "Voice commands are not available while VisionAid is listening to your question or taking a photo.";
      setCommandMessage(message);
      announce(message);
      return;
    }
    // Speaking is stopped first, so recognition and speech never run together; the person's tap
    // is an interruption, so the button is never blocked by a prompt that is still playing.
    stopOutput();
    onBeforeListen?.();
    setCommandMessage(null);
    let heard = "";
    const started = speech.start({
      lang: COMMAND_LANG,
      onTranscript: (text) => {
        heard = text;
      },
      onEnd: () => {
        setCommandActive(false);
        const text = heard;
        heard = "";
        runCommandRef.current(text);
      },
    });
    if (started) {
      setCommandActive(true);
      announce("Listening for a command.");
    }
  }, [prefs.voiceCommands, speech, phase, announce, stopOutput, onBeforeListen, setCommandActive]);

  /** Stops listening for a command at once, without running anything. */
  const stopCommand = useCallback(() => {
    abortSpeech();
    setCommandActive(false);
    setCommandMessage(null);
    announce("Stopped listening for a command.");
  }, [abortSpeech, announce, setCommandActive]);

  /** After a failure: go back to editing the question (the photo is kept). */
  const edit = useCallback(() => {
    setSendError(null);
    dispatch({ type: "EDIT" });
    announce("Editing your question.");
    requestFocus("question");
  }, [announce, requestFocus]);

  /** After an answer: same photo, new question. */
  const askAnother = useCallback(() => {
    clearAnswer();
    dispatch({ type: "ASK_ANOTHER" });
    announce("Ready for another question about the same photo. Type or say it, then tap Ask.");
    requestFocus("question");
  }, [clearAnswer, announce, requestFocus]);

  // Leaving or hiding the page: stop listening; leaving also drops everything.
  useEffect(() => {
    const onHidden = () => {
      if (document.visibilityState !== "hidden") return;
      abortSpeech();
      setCommandActive(false);
      dispatch({ type: "LISTEN_ENDED" });
    };
    const onPageHide = () => {
      abortSpeech();
      setCommandActive(false);
      abortRequest();
      generationRef.current += 1;
      capturingRef.current = false;
      releaseImage();
      setImage(null);
      setResult(null);
      setSendError(null);
      dispatch({ type: "CANCEL" });
    };
    document.addEventListener("visibilitychange", onHidden);
    window.addEventListener("pagehide", onPageHide);
    return () => {
      document.removeEventListener("visibilitychange", onHidden);
      window.removeEventListener("pagehide", onPageHide);
      // Unmount: abort the request, invalidate captures and free the preview URL.
      abortRequest();
      generationRef.current += 1;
      releaseImage();
    };
  }, [abortSpeech, abortRequest, releaseImage, setCommandActive]);

  return {
    phase,
    image,
    question: flow.question,
    lang,
    setLang,
    captureError,
    announcement,
    /** Announces a short message to screen readers (e.g. why a disabled button did nothing). */
    notify: announce,
    focusRequest,
    result,
    sendError,
    answerLang,
    answerLanguageNotes: result ? answerLanguageNotes(answerLang, result, answerSelectedLang) : [],
    speech: {
      supported: speech.supported,
      error: speech.error,
    },
    output: {
      supported: output.supported,
      state: output.state,
      error: output.error,
      notes: output.notes,
      speaking: output.speaking,
      guidanceNote: output.guidanceNote,
      pauseUnsupported: output.pauseUnsupported,
      support: output.support,
      pause: output.pause,
      resume: output.resume,
      stop: output.stopByUser,
    },
    can: {
      capture: canCapture(flow, cameraActive),
      retake: canRetake(flow),
      editQuestion: canEditQuestion(flow),
      listen: canListen(flow) && speech.supported,
      ask: canAsk(flow),
      retry: canRetry(flow),
    },
    askBlockedReason: askBlockedReason(flow),
    capture,
    retake,
    cancel,
    setQuestion,
    startListening,
    stopListening,
    abortListening,
    ask,
    retry,
    edit,
    askAnother,
    listenToAnswer,
    stopAllSpeech,
    /** Spoken when the camera could not start (voice-guided mode only). */
    speakCameraError,
    /** Spoken when the person switches to voice-guided mode (their tap is the user gesture speech needs). */
    speakWelcome,
    commands: {
      enabled: prefs.voiceCommands && speech.supported,
      active: commandActive,
      message: commandMessage,
      start: startCommand,
      stop: stopCommand,
    },
  };
}
