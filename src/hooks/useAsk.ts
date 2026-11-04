"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type RefObject,
} from "react";
import { useSpeechInput } from "@/hooks/useSpeechInput";
import {
  askBlockedReason,
  askReducer,
  canAsk,
  canCapture,
  canEditQuestion,
  canListen,
  canRetake,
  deriveAskPhase,
  INITIAL_ASK_CONTEXT,
} from "@/lib/ask/ask-flow";
import { devLog } from "@/lib/dev-log";
import { captureStill, toCaptureError, type CapturedImage } from "@/lib/image/capture";
import { describeQuality } from "@/lib/image/quality";
import type { SupportedLang } from "@/lib/speech/types";

interface UseAskOptions {
  videoRef: RefObject<HTMLVideoElement | null>;
  /** True while the camera preview is live (useCamera status "camera-ready"). */
  cameraActive: boolean;
  /** Called right before speech starts, e.g. to stop the microphone test. */
  onBeforeListen?: () => void;
}

/** What Milestone 5 will send. Built locally; nothing is transmitted in Milestone 4. */
export interface PreparedRequest {
  image: Blob;
  width: number;
  height: number;
  question: string;
  lang: SupportedLang;
}

/**
 * Coordinates the Tap-to-Ask interaction: reuses the camera preview (via
 * `videoRef`), captures one still, collects a spoken or typed question and
 * holds the prepared request locally. Images, audio and transcripts exist only
 * in memory and are discarded on Retake, Cancel, page hide and unmount.
 */
export function useAsk({ videoRef, cameraActive, onBeforeListen }: UseAskOptions) {
  const [flow, dispatch] = useReducer(askReducer, INITIAL_ASK_CONTEXT);
  const [image, setImage] = useState<CapturedImage | null>(null);
  const [captureError, setCaptureError] = useState<string | null>(null);
  const [lang, setLang] = useState<SupportedLang>("en-IN");
  const [announcement, setAnnouncement] = useState("");

  const speech = useSpeechInput();
  const { abort: abortSpeech, clearError: clearSpeechError } = speech;

  const imageRef = useRef<CapturedImage | null>(null);
  const capturingRef = useRef(false);
  // Bumped on retake/cancel/unmount so an in-flight capture can tell it is stale.
  const generationRef = useRef(0);

  const phase = deriveAskPhase(flow, cameraActive);

  const announce = useCallback((message: string) => setAnnouncement(message), []);

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
  }, [flow, cameraActive, abortSpeech, clearSpeechError, discardImage, announce]);

  const cancel = useCallback(() => {
    abortSpeech();
    clearSpeechError();
    generationRef.current += 1;
    capturingRef.current = false;
    discardImage();
    setCaptureError(null);
    dispatch({ type: "CANCEL" });
    announce("Cancelled. The photo and question were discarded.");
  }, [abortSpeech, clearSpeechError, discardImage, announce]);

  const setQuestion = useCallback((text: string) => {
    dispatch({ type: "QUESTION_CHANGED", text });
  }, []);

  const startListening = useCallback(() => {
    if (!canListen(flow) || !speech.supported) return;
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
  }, [flow, lang, speech, onBeforeListen, announce]);

  const stopListening = useCallback(() => speech.stop(), [speech]);

  /** Cancels speech immediately (e.g. another feature needs the microphone). */
  const abortListening = useCallback(() => {
    abortSpeech();
    dispatch({ type: "LISTEN_ENDED" });
  }, [abortSpeech]);

  const ask = useCallback(() => {
    if (!canAsk(flow) || !imageRef.current) return;
    dispatch({ type: "ASK" });
    announce(
      "Your photo and question are ready. Nothing has been sent, because asking the AI is not available in this version.",
    );
    devLog("ask", "request prepared locally (not sent)");
  }, [flow, announce]);

  const edit = useCallback(() => {
    dispatch({ type: "EDIT" });
    announce("Editing your question.");
  }, [announce]);

  // Leaving or hiding the page: stop listening; leaving also drops the image.
  useEffect(() => {
    const onHidden = () => {
      if (document.visibilityState !== "hidden") return;
      abortSpeech();
      dispatch({ type: "LISTEN_ENDED" });
    };
    const onPageHide = () => {
      abortSpeech();
      generationRef.current += 1;
      capturingRef.current = false;
      releaseImage();
      setImage(null);
      dispatch({ type: "CANCEL" });
    };
    document.addEventListener("visibilitychange", onHidden);
    window.addEventListener("pagehide", onPageHide);
    return () => {
      document.removeEventListener("visibilitychange", onHidden);
      window.removeEventListener("pagehide", onPageHide);
      // Unmount: invalidate any in-flight capture and free the preview URL.
      generationRef.current += 1;
      releaseImage();
    };
  }, [abortSpeech, releaseImage]);

  const prepared = useMemo<PreparedRequest | null>(
    () =>
      phase === "ready-to-submit" && image
        ? {
            image: image.blob,
            width: image.width,
            height: image.height,
            question: flow.question.trim(),
            lang,
          }
        : null,
    [phase, image, flow.question, lang],
  );

  return {
    phase,
    image,
    question: flow.question,
    lang,
    setLang,
    captureError,
    announcement,
    prepared,
    speech: {
      supported: speech.supported,
      error: speech.error,
    },
    can: {
      capture: canCapture(flow, cameraActive),
      retake: canRetake(flow),
      editQuestion: canEditQuestion(flow),
      listen: canListen(flow) && speech.supported,
      ask: canAsk(flow),
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
    edit,
  };
}
