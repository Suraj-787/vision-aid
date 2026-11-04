/**
 * Tap-to-Ask interaction state model (Milestone 4). A pure reducer so invalid
 * transitions are rejected in one tested place. It holds only metadata: the
 * image bytes, the camera and the speech session live in hooks.
 *
 * Flow: camera preview -> capture one image -> speak or type a question ->
 * Ask -> "ready to submit" (a local state; nothing is sent in this milestone).
 */

export const MAX_QUESTION_CHARS = 500;

/** Phases the reducer stores. */
export type StoredPhase =
  | "idle"
  | "capturing"
  | "image-captured"
  | "listening"
  | "question-ready"
  | "ready-to-submit";

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
  | { type: "EDIT" }
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
      // Discards the image; the typed/spoken question is kept.
      return ctx.hasImage && ctx.phase !== "capturing"
        ? { ...ctx, phase: "idle", hasImage: false }
        : ctx;

    case "QUESTION_CHANGED": {
      if (!ctx.hasImage) return ctx;
      if (
        ctx.phase !== "image-captured" &&
        ctx.phase !== "question-ready" &&
        ctx.phase !== "ready-to-submit"
      ) {
        return ctx;
      }
      const question = clampQuestion(action.text);
      // Editing after "ready to submit" invalidates the prepared request.
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
      return ctx.phase === "question-ready" && ctx.hasImage && hasQuestion(ctx.question)
        ? { ...ctx, phase: "ready-to-submit" }
        : ctx;

    case "EDIT":
      return ctx.phase === "ready-to-submit" ? { ...ctx, phase: "question-ready" } : ctx;

    case "CANCEL":
      // Abandons the whole ask: image and question are discarded.
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
  return (
    ctx.hasImage &&
    (ctx.phase === "image-captured" ||
      ctx.phase === "question-ready" ||
      ctx.phase === "ready-to-submit")
  );
}

export function canListen(ctx: AskContext): boolean {
  return ctx.hasImage && (ctx.phase === "image-captured" || ctx.phase === "question-ready");
}

export function canAsk(ctx: AskContext): boolean {
  return ctx.phase === "question-ready" && ctx.hasImage && hasQuestion(ctx.question);
}

/** Why Ask is unavailable, for an accessible hint; null when it is available. */
export function askBlockedReason(ctx: AskContext): string | null {
  if (canAsk(ctx)) return null;
  if (!ctx.hasImage) return "Take a photo first.";
  if (ctx.phase === "listening") return "Finish speaking first.";
  if (ctx.phase === "ready-to-submit") return "Your request is already prepared.";
  return "Type or say a question to turn on Ask.";
}
