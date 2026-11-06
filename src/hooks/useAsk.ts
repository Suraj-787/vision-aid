"use client";

import { useCallback, useEffect, useReducer, useRef, useState, type RefObject } from "react";
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
import { describeQuality } from "@/lib/image/quality";
import { answerLanguageNotes, chooseResponseLanguage } from "@/lib/speech/answer-language";
import { DEFAULT_LANG, type SupportedLang } from "@/lib/speech/types";

/** What a screen reader says when an answer arrives: the answer, plus the app's own checks. */
function announcementFor(result: AskResult): string {
  const parts = [`Answer: ${result.answer}`];
  if (result.expiry_check) parts.push(result.expiry_check.explanation);
  if (result.confidence === "low") parts.push("The AI is not confident about this answer.");
  return parts.join(" ");
}

interface UseAskOptions {
  videoRef: RefObject<HTMLVideoElement | null>;
  /** True while the camera preview is live (useCamera status "camera-ready"). */
  cameraActive: boolean;
  /** Called right before speech starts, e.g. to stop the microphone test. */
  onBeforeListen?: () => void;
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
export function useAsk({ videoRef, cameraActive, onBeforeListen }: UseAskOptions) {
  const [flow, dispatch] = useReducer(askReducer, INITIAL_ASK_CONTEXT);
  const [image, setImage] = useState<CapturedImage | null>(null);
  const [captureError, setCaptureError] = useState<string | null>(null);
  const [result, setResult] = useState<AskResult | null>(null);
  const [sendError, setSendError] = useState<AskFailure | null>(null);
  const [lang, setLang] = useState<SupportedLang>(DEFAULT_LANG);
  // The answer language that was sent with the current answer (the selector may change afterwards).
  const [answerLang, setAnswerLang] = useState<SupportedLang>(DEFAULT_LANG);
  const [answerSelectedLang, setAnswerSelectedLang] = useState<SupportedLang>(DEFAULT_LANG);
  const [announcement, setAnnouncement] = useState("");

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

  const announce = useCallback((message: string) => setAnnouncement(message), []);

  const output = useSpeechOutput({ announce, onBeforeSpeak: onBeforeListen });
  const { stop: stopOutput, clearError: clearOutputError } = output;

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
      const advice = describeQuality(captured.quality);
      announce(
        ["Photo captured.", ...advice, "Type or say your question, then tap Ask."].join(" "),
      );
    } catch (err) {
      if (generation !== generationRef.current) return;
      const failure = toCaptureError(err);
      devLog("ask", `capture failed: ${failure.kind}`);
      dispatch({ type: "CAPTURE_FAILED" });
      setCaptureError(failure.message);
      announce(failure.message);
    } finally {
      if (generation === generationRef.current) capturingRef.current = false;
    }
  }, [videoRef, flow, cameraActive, announce, releaseImage]);

  const retake = useCallback(() => {
    if (!canRetake(flow)) return;
    abortSpeech();
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
  }, [flow, cameraActive, abortSpeech, clearSpeechError, abortRequest, clearAnswer, discardImage, announce]);

  const cancel = useCallback(() => {
    abortSpeech();
    clearSpeechError();
    abortRequest();
    clearAnswer();
    generationRef.current += 1;
    capturingRef.current = false;
    discardImage();
    setCaptureError(null);
    dispatch({ type: "CANCEL" });
    announce("Cancelled. The photo, question and answer were discarded.");
  }, [abortSpeech, clearSpeechError, abortRequest, clearAnswer, discardImage, announce]);

  const setQuestion = useCallback((text: string) => {
    dispatch({ type: "QUESTION_CHANGED", text });
  }, []);

  const startListening = useCallback(() => {
    if (!canListen(flow) || !speech.supported) return;
    stopOutput(); // the microphone must not hear the answer being read aloud
    onBeforeListen?.();
    const started = speech.start({
      lang,
      onTranscript: (text) => dispatch({ type: "TRANSCRIPT", text }),
      onEnd: () => {
        dispatch({ type: "LISTEN_ENDED" });
        announce("Finished listening. Check your question, then tap Ask.");
      },
    });
    if (started) {
      dispatch({ type: "LISTEN_STARTED" });
      announce("Listening. Speak your question.");
    }
  }, [flow, lang, speech, onBeforeListen, stopOutput, announce]);

  const stopListening = useCallback(() => speech.stop(), [speech]);

  /** Cancels speech immediately (e.g. another feature needs the microphone). */
  const abortListening = useCallback(() => {
    abortSpeech();
    dispatch({ type: "LISTEN_ENDED" });
  }, [abortSpeech]);

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
          announce(announcementFor(outcome.result));
        } else {
          devLog("ask", `request failed: ${outcome.error.code}`);
          setSendError(outcome.error);
          dispatch({ type: "SEND_FAILED" });
          announce(`There was a problem. ${outcome.error.message}`);
        }
      });
    },
    [flow, lang, announce, clearAnswer],
  );

  const ask = useCallback(() => submit("ask"), [submit]);
  const retry = useCallback(() => submit("retry"), [submit]);

  /** Reads the displayed answer aloud. Only ever called from the Listen button. */
  const listenToAnswer = useCallback(() => {
    if (!result) return;
    abortSpeech(); // recognition and synthesis never run together
    announce(""); // so a repeated "Stopped" / "Paused" is announced again
    output.listen(result);
  }, [result, abortSpeech, announce, output]);

  /** After a failure: go back to editing the question (the photo is kept). */
  const edit = useCallback(() => {
    setSendError(null);
    dispatch({ type: "EDIT" });
    announce("Editing your question.");
  }, [announce]);

  /** After an answer: same photo, new question. */
  const askAnother = useCallback(() => {
    clearAnswer();
    dispatch({ type: "ASK_ANOTHER" });
    announce("Ready for another question about the same photo. Type or say it, then tap Ask.");
  }, [clearAnswer, announce]);

  // Leaving or hiding the page: stop listening; leaving also drops everything.
  useEffect(() => {
    const onHidden = () => {
      if (document.visibilityState !== "hidden") return;
      abortSpeech();
      dispatch({ type: "LISTEN_ENDED" });
    };
    const onPageHide = () => {
      abortSpeech();
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
  }, [abortSpeech, abortRequest, releaseImage]);

  return {
    phase,
    image,
    question: flow.question,
    lang,
    setLang,
    captureError,
    announcement,
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
  };
}
