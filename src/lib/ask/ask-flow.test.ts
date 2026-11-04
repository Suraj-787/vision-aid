import assert from "node:assert/strict";
import { describe, it } from "node:test";
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
  MAX_QUESTION_CHARS,
  type AskAction,
  type AskContext,
} from "./ask-flow.ts";

const run = (actions: AskAction[], start: AskContext = INITIAL_ASK_CONTEXT) =>
  actions.reduce(askReducer, start);

const captured: AskAction[] = [
  { type: "CAPTURE_REQUESTED", cameraActive: true },
  { type: "CAPTURE_SUCCEEDED" },
];
const withQuestion: AskAction[] = [...captured, { type: "QUESTION_CHANGED", text: "What is this?" }];

describe("happy path", () => {
  it("idle -> capturing -> image-captured -> question-ready -> ready-to-submit", () => {
    let ctx = INITIAL_ASK_CONTEXT;
    assert.equal(deriveAskPhase(ctx, false), "idle");
    assert.equal(deriveAskPhase(ctx, true), "camera-active");

    ctx = askReducer(ctx, { type: "CAPTURE_REQUESTED", cameraActive: true });
    assert.equal(ctx.phase, "capturing");
    ctx = askReducer(ctx, { type: "CAPTURE_SUCCEEDED" });
    assert.equal(ctx.phase, "image-captured");
    assert.ok(ctx.hasImage);
    ctx = askReducer(ctx, { type: "QUESTION_CHANGED", text: "What does this label say?" });
    assert.equal(ctx.phase, "question-ready");
    ctx = askReducer(ctx, { type: "ASK" });
    assert.equal(ctx.phase, "ready-to-submit");
  });

  it("supports speaking: listening -> transcript -> question-ready", () => {
    let ctx = run(captured);
    ctx = askReducer(ctx, { type: "LISTEN_STARTED" });
    assert.equal(ctx.phase, "listening");
    ctx = askReducer(ctx, { type: "TRANSCRIPT", text: "what is" });
    ctx = askReducer(ctx, { type: "TRANSCRIPT", text: "what is on the table" });
    assert.equal(ctx.question, "what is on the table");
    assert.equal(ctx.phase, "listening");
    ctx = askReducer(ctx, { type: "LISTEN_ENDED" });
    assert.equal(ctx.phase, "question-ready");
    assert.ok(canAsk(ctx));
  });
});

describe("invalid transitions are rejected (same object returned)", () => {
  const rejected = (ctx: AskContext, action: AskAction) =>
    assert.equal(askReducer(ctx, action), ctx, `${action.type} from ${ctx.phase}`);

  it("cannot capture without an active camera", () => {
    rejected(INITIAL_ASK_CONTEXT, { type: "CAPTURE_REQUESTED", cameraActive: false });
  });

  it("cannot capture twice (double tap) or while an image exists", () => {
    const capturing = askReducer(INITIAL_ASK_CONTEXT, { type: "CAPTURE_REQUESTED", cameraActive: true });
    rejected(capturing, { type: "CAPTURE_REQUESTED", cameraActive: true });
    rejected(run(captured), { type: "CAPTURE_REQUESTED", cameraActive: true });
  });

  it("cannot ask without an image", () => {
    rejected(INITIAL_ASK_CONTEXT, { type: "ASK" });
    // Question typed earlier but image retaken away
    const noImage = run([...withQuestion, { type: "RETAKE" }]);
    assert.equal(noImage.question, "What is this?");
    rejected(noImage, { type: "ASK" });
  });

  it("cannot ask with an empty or whitespace-only question", () => {
    rejected(run(captured), { type: "ASK" });
    const blank = run([...captured, { type: "QUESTION_CHANGED", text: "   \n " }]);
    assert.equal(blank.phase, "image-captured");
    rejected(blank, { type: "ASK" });
  });

  it("cannot ask twice (duplicate submission)", () => {
    const submitted = run([...withQuestion, { type: "ASK" }]);
    assert.equal(submitted.phase, "ready-to-submit");
    rejected(submitted, { type: "ASK" });
  });

  it("cannot ask while listening", () => {
    rejected(run([...withQuestion, { type: "LISTEN_STARTED" }]), { type: "ASK" });
  });

  it("cannot edit the question or listen before an image exists", () => {
    rejected(INITIAL_ASK_CONTEXT, { type: "QUESTION_CHANGED", text: "hi" });
    rejected(INITIAL_ASK_CONTEXT, { type: "LISTEN_STARTED" });
  });

  it("cannot edit the typed question while listening", () => {
    rejected(run([...captured, { type: "LISTEN_STARTED" }]), { type: "QUESTION_CHANGED", text: "x" });
  });

  it("cannot start listening twice or from ready-to-submit", () => {
    rejected(run([...captured, { type: "LISTEN_STARTED" }]), { type: "LISTEN_STARTED" });
    rejected(run([...withQuestion, { type: "ASK" }]), { type: "LISTEN_STARTED" });
  });

  it("ignores stray transcript, listen-end and edit events", () => {
    rejected(run(captured), { type: "TRANSCRIPT", text: "late result" });
    rejected(run(captured), { type: "LISTEN_ENDED" });
    rejected(run(withQuestion), { type: "EDIT" });
    rejected(INITIAL_ASK_CONTEXT, { type: "CAPTURE_SUCCEEDED" });
    rejected(INITIAL_ASK_CONTEXT, { type: "CAPTURE_FAILED" });
  });

  it("cannot retake with no image or during capture", () => {
    rejected(INITIAL_ASK_CONTEXT, { type: "RETAKE" });
    rejected(askReducer(INITIAL_ASK_CONTEXT, { type: "CAPTURE_REQUESTED", cameraActive: true }), {
      type: "RETAKE",
    });
  });

  it("an empty transcript does not wipe the existing question", () => {
    const listening = run([...withQuestion, { type: "LISTEN_STARTED" }]);
    rejected(listening, { type: "TRANSCRIPT", text: "  " });
    assert.equal(listening.question, "What is this?");
  });
});

describe("capture failure", () => {
  it("returns to idle without an image", () => {
    const ctx = run([{ type: "CAPTURE_REQUESTED", cameraActive: true }, { type: "CAPTURE_FAILED" }]);
    assert.equal(ctx.phase, "idle");
    assert.equal(ctx.hasImage, false);
  });
});

describe("retake, edit and cancel", () => {
  it("retake discards the image but keeps the question", () => {
    const ctx = run([...withQuestion, { type: "RETAKE" }]);
    assert.equal(ctx.phase, "idle");
    assert.equal(ctx.hasImage, false);
    assert.equal(ctx.question, "What is this?");
    assert.equal(deriveAskPhase(ctx, true), "camera-active");
  });

  it("a recaptured image with a kept question is immediately question-ready", () => {
    const ctx = run([...withQuestion, { type: "RETAKE" }, ...captured]);
    assert.equal(ctx.phase, "question-ready");
  });

  it("retake while listening ends listening", () => {
    const ctx = run([...withQuestion, { type: "LISTEN_STARTED" }, { type: "RETAKE" }]);
    assert.equal(ctx.phase, "idle");
    assert.equal(askReducer(ctx, { type: "TRANSCRIPT", text: "late" }), ctx);
  });

  it("edit returns from ready-to-submit to question-ready", () => {
    const ctx = run([...withQuestion, { type: "ASK" }, { type: "EDIT" }]);
    assert.equal(ctx.phase, "question-ready");
    assert.ok(canAsk(ctx));
  });

  it("editing the text after ready-to-submit invalidates the prepared request", () => {
    const ctx = run([...withQuestion, { type: "ASK" }, { type: "QUESTION_CHANGED", text: "Other?" }]);
    assert.equal(ctx.phase, "question-ready");
    const cleared = run([...withQuestion, { type: "ASK" }, { type: "QUESTION_CHANGED", text: "" }]);
    assert.equal(cleared.phase, "image-captured");
  });

  it("cancel discards image and question from any phase", () => {
    for (const actions of [
      [{ type: "CAPTURE_REQUESTED", cameraActive: true }] as AskAction[],
      captured,
      withQuestion,
      [...withQuestion, { type: "LISTEN_STARTED" }] as AskAction[],
      [...withQuestion, { type: "ASK" }] as AskAction[],
    ]) {
      assert.deepEqual(run([...actions, { type: "CANCEL" }]), INITIAL_ASK_CONTEXT);
    }
  });

  it("cancel from the initial state is a no-op", () => {
    assert.equal(askReducer(INITIAL_ASK_CONTEXT, { type: "CANCEL" }), INITIAL_ASK_CONTEXT);
  });
});

describe("question handling", () => {
  it("clamps the question to the maximum length", () => {
    const ctx = run([...captured, { type: "QUESTION_CHANGED", text: "a".repeat(MAX_QUESTION_CHARS + 50) }]);
    assert.equal(ctx.question.length, MAX_QUESTION_CHARS);
    const spoken = run([...captured, { type: "LISTEN_STARTED" }, { type: "TRANSCRIPT", text: "b".repeat(900) }]);
    assert.equal(spoken.question.length, MAX_QUESTION_CHARS);
  });

  it("a spoken transcript replaces the previous question once it arrives", () => {
    const ctx = run([...withQuestion, { type: "LISTEN_STARTED" }, { type: "TRANSCRIPT", text: "New one" }]);
    assert.equal(ctx.question, "New one");
  });

  it("listening that hears nothing keeps the old question", () => {
    const ctx = run([...withQuestion, { type: "LISTEN_STARTED" }, { type: "LISTEN_ENDED" }]);
    assert.equal(ctx.question, "What is this?");
    assert.equal(ctx.phase, "question-ready");
  });

  it("listening with no question ends in image-captured", () => {
    const ctx = run([...captured, { type: "LISTEN_STARTED" }, { type: "LISTEN_ENDED" }]);
    assert.equal(ctx.phase, "image-captured");
  });
});

describe("guards", () => {
  it("canCapture / canRetake / canListen / canEditQuestion", () => {
    assert.equal(canCapture(INITIAL_ASK_CONTEXT, true), true);
    assert.equal(canCapture(INITIAL_ASK_CONTEXT, false), false);
    assert.equal(canCapture(run(captured), true), false);
    assert.equal(canRetake(INITIAL_ASK_CONTEXT), false);
    assert.equal(canRetake(run(captured)), true);
    assert.equal(canListen(run(captured)), true);
    assert.equal(canListen(run([...captured, { type: "LISTEN_STARTED" }])), false);
    assert.equal(canEditQuestion(run(captured)), true);
    assert.equal(canEditQuestion(INITIAL_ASK_CONTEXT), false);
  });

  it("askBlockedReason explains why Ask is unavailable", () => {
    assert.equal(askBlockedReason(INITIAL_ASK_CONTEXT), "Take a photo first.");
    assert.equal(askBlockedReason(run(captured)), "Type or say a question to turn on Ask.");
    assert.equal(askBlockedReason(run(withQuestion)), null);
    assert.equal(askBlockedReason(run([...withQuestion, { type: "ASK" }])), "Your request is already prepared.");
    assert.equal(askBlockedReason(run([...withQuestion, { type: "LISTEN_STARTED" }])), "Finish speaking first.");
  });
});
