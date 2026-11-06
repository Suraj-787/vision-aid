/**
 * Tap-to-Ask interaction state model. A pure reducer so invalid transitions are
 * rejected in one tested place. It holds only metadata: the image bytes, the
 * camera, the speech session and the in-flight request live in hooks.
 *
 * Flow (Milestone 5): camera preview -> capture one image -> speak or type a
 * question -> Ask -> `sending` (one request to /api/ask) -> `answered`, or
 * `send-failed` (retryable). Milestone 4 stopped at a local "ready" state; that
 * state was replaced by `sending`.
 */
import { MAX_QUESTION_LENGTH } from "./ask-api.ts";

export const MAX_QUESTION_CHARS = MAX_QUESTION_LENGTH;

/** Phases the reducer stores. */
export type StoredPhase =
  | "idle"
  | "capturing"
  | "image-captured"
  | "listening"
  | "question-ready"
  | "sending"
  | "answered"
  | "send-failed";

/** Phases shown to the UI: `idle` splits into idle / camera-active by camera state. */
export type AskPhase = StoredPhase | "camera-active";

export interface AskContext {
  phase: StoredPhase;
  /** Raw question text (may contain surrounding whitespace). */
  question: string;
  hasImage: boolean;
}

export const INITIAL_ASK_CONTEXT: AskContext = {
  phase: "idle",
  question: "",
  hasImage: false,
};

export type AskAction =
  | { type: "CAPTURE_REQUESTED"; cameraActive: boolean }
  | { type: "CAPTURE_SUCCEEDED" }
  | { type: "CAPTURE_FAILED" }
  | { type: "RETAKE" }
  | { type: "QUESTION_CHANGED"; text: string }
  | { type: "LISTEN_STARTED" }
  | { type: "TRANSCRIPT"; text: string }
  | { type: "LISTEN_ENDED" }
  | { type: "ASK" }
  | { type: "SEND_SUCCEEDED" }
  | { type: "SEND_FAILED" }
  | { type: "RETRY" }
  | { type: "EDIT" }
  | { type: "ASK_ANOTHER" }
  | { type: "CANCEL" };

export function hasQuestion(text: string): boolean {
  return text.trim().length > 0;
}

function clampQuestion(text: string): string {
  return text.length > MAX_QUESTION_CHARS ? text.slice(0, MAX_QUESTION_CHARS) : text;
}

function phaseAfterEditing(question: string): StoredPhase {
  return hasQuestion(question) ? "question-ready" : "image-captured";
}

/**
 * Invalid actions return the *same object*, so callers can detect a rejected
 * transition with `===`.
 */
export function askReducer(ctx: AskContext, action: AskAction): AskContext {
  switch (action.type) {
    case "CAPTURE_REQUESTED":
      // Only from the live preview, with no image yet: blocks double captures.
      return ctx.phase === "idle" && !ctx.hasImage && action.cameraActive
        ? { ...ctx, phase: "capturing" }
        : ctx;

    case "CAPTURE_SUCCEEDED":
      return ctx.phase === "capturing"
        ? { ...ctx, hasImage: true, phase: phaseAfterEditing(ctx.question) }
        : ctx;

    case "CAPTURE_FAILED":
      return ctx.phase === "capturing" ? { ...ctx, phase: "idle", hasImage: false } : ctx;

    case "RETAKE":
      // Discards the image (and, from a request in flight, the hook aborts it).
      // The typed/spoken question is kept, except after an answer: a new photo
      // usually means a new question.
      if (!ctx.hasImage || ctx.phase === "capturing") return ctx;
      return {
        ...ctx,
        phase: "idle",
        hasImage: false,
        question: ctx.phase === "answered" ? "" : ctx.question,
      };

    case "QUESTION_CHANGED": {
      if (!ctx.hasImage) return ctx;
      if (ctx.phase !== "image-captured" && ctx.phase !== "question-ready") return ctx;
      const question = clampQuestion(action.text);
      return { ...ctx, question, phase: phaseAfterEditing(question) };
    }

    case "LISTEN_STARTED":
      return ctx.hasImage && (ctx.phase === "image-captured" || ctx.phase === "question-ready")
        ? { ...ctx, phase: "listening" }
        : ctx;

    case "TRANSCRIPT":
      // Empty interim results must not wipe an existing question.
      return ctx.phase === "listening" && hasQuestion(action.text)
        ? { ...ctx, question: clampQuestion(action.text) }
        : ctx;

    case "LISTEN_ENDED":
      return ctx.phase === "listening"
        ? { ...ctx, phase: phaseAfterEditing(ctx.question) }
        : ctx;

    case "ASK":
      // The only way to start a request. Rejected while sending (duplicate submit).
      return ctx.phase === "question-ready" && ctx.hasImage && hasQuestion(ctx.question)
        ? { ...ctx, phase: "sending" }
        : ctx;

    case "SEND_SUCCEEDED":
      return ctx.phase === "sending" ? { ...ctx, phase: "answered" } : ctx;

    case "SEND_FAILED":
      return ctx.phase === "sending" ? { ...ctx, phase: "send-failed" } : ctx;

    case "RETRY":
      return ctx.phase === "send-failed" && ctx.hasImage && hasQuestion(ctx.question)
        ? { ...ctx, phase: "sending" }
        : ctx;

    case "EDIT":
      return ctx.phase === "send-failed" ? { ...ctx, phase: "question-ready" } : ctx;

    case "ASK_ANOTHER":
      // Same photo, new question.
      return ctx.phase === "answered" && ctx.hasImage
        ? { ...ctx, phase: "image-captured", question: "" }
        : ctx;

    case "CANCEL":
      // Abandons the whole ask: image, question and any request are discarded.
      return ctx.phase === "idle" && !ctx.hasImage && ctx.question === ""
        ? ctx
        : INITIAL_ASK_CONTEXT;
  }
}

export function deriveAskPhase(ctx: AskContext, cameraActive: boolean): AskPhase {
  return ctx.phase === "idle" && cameraActive ? "camera-active" : ctx.phase;
}

// ---- Guards used by the UI (aria-disabled) and by hook handlers ----

export function canCapture(ctx: AskContext, cameraActive: boolean): boolean {
  return ctx.phase === "idle" && !ctx.hasImage && cameraActive;
}

export function canRetake(ctx: AskContext): boolean {
  return ctx.hasImage && ctx.phase !== "capturing";
}

export function canEditQuestion(ctx: AskContext): boolean {
  return ctx.hasImage && (ctx.phase === "image-captured" || ctx.phase === "question-ready");
}

export function canListen(ctx: AskContext): boolean {
  return ctx.hasImage && (ctx.phase === "image-captured" || ctx.phase === "question-ready");
}

export function canAsk(ctx: AskContext): boolean {
  return ctx.phase === "question-ready" && ctx.hasImage && hasQuestion(ctx.question);
}

export function canRetry(ctx: AskContext): boolean {
  return ctx.phase === "send-failed" && ctx.hasImage && hasQuestion(ctx.question);
}

/** Why Ask is unavailable, for an accessible hint; null when it is available. */
export function askBlockedReason(ctx: AskContext): string | null {
  if (canAsk(ctx)) return null;
  if (!ctx.hasImage) return "Take a photo first.";
  if (ctx.phase === "listening") return "Finish speaking first.";
  if (ctx.phase === "sending") return "Your question is being answered.";
  if (ctx.phase === "answered" || ctx.phase === "send-failed") return "Your question has already been sent.";
  return "Type or say a question to turn on Ask.";
}
