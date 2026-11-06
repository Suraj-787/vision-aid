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
  canRetry,
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
const sending: AskAction[] = [...withQuestion, { type: "ASK" }];
const answered: AskAction[] = [...sending, { type: "SEND_SUCCEEDED" }];
const failed: AskAction[] = [...sending, { type: "SEND_FAILED" }];

const rejected = (ctx: AskContext, action: AskAction) =>
  assert.equal(askReducer(ctx, action), ctx, `${action.type} from ${ctx.phase}`);

describe("happy path", () => {
  it("idle -> capturing -> image-captured -> question-ready -> sending -> answered", () => {
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
    assert.equal(ctx.phase, "sending");
    ctx = askReducer(ctx, { type: "SEND_SUCCEEDED" });
    assert.equal(ctx.phase, "answered");
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

describe("sending, failure and retry", () => {
  it("a failed request can be retried with the same photo and question", () => {
    const ctx = run([...failed, { type: "RETRY" }]);
    assert.equal(ctx.phase, "sending");
    assert.equal(ctx.question, "What is this?");
    assert.ok(ctx.hasImage);
    assert.equal(run(failed).phase, "send-failed");
    assert.ok(canRetry(run(failed)));
  });

  it("retry can fail again and then succeed", () => {
    const ctx = run([...failed, { type: "RETRY" }, { type: "SEND_FAILED" }, { type: "RETRY" }, { type: "SEND_SUCCEEDED" }]);
    assert.equal(ctx.phase, "answered");
  });

  it("after a failure the question can be edited", () => {
    const ctx = run([...failed, { type: "EDIT" }]);
    assert.equal(ctx.phase, "question-ready");
    assert.equal(ctx.question, "What is this?");
    assert.ok(canAsk(ctx));
  });

  it("another question about the same photo clears only the question", () => {
    const ctx = run([...answered, { type: "ASK_ANOTHER" }]);
    assert.equal(ctx.phase, "image-captured");
    assert.equal(ctx.hasImage, true);
    assert.equal(ctx.question, "");
    assert.equal(canAsk(ctx), false);
    assert.equal(run([...answered, { type: "ASK_ANOTHER" }, { type: "QUESTION_CHANGED", text: "And this?" }]).phase, "question-ready");
  });

  it("a new photo after an answer clears the old question; after a failure it keeps it", () => {
    assert.equal(run([...answered, { type: "RETAKE" }]).question, "");
    assert.equal(run([...failed, { type: "RETAKE" }]).question, "What is this?");
    assert.equal(run([...answered, { type: "RETAKE" }]).phase, "idle");
  });
});

describe("invalid transitions are rejected (same object returned)", () => {
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

  it("cannot submit twice: Ask is rejected while sending, after an answer and after a failure", () => {
    rejected(run(sending), { type: "ASK" });
    rejected(run(answered), { type: "ASK" });
    rejected(run(failed), { type: "ASK" });
  });

  it("cannot retry unless the last request failed", () => {
    rejected(run(sending), { type: "RETRY" });
    rejected(run(answered), { type: "RETRY" });
    rejected(run(withQuestion), { type: "RETRY" });
    rejected(INITIAL_ASK_CONTEXT, { type: "RETRY" });
  });

  it("results only apply to a request that is in flight", () => {
    rejected(INITIAL_ASK_CONTEXT, { type: "SEND_SUCCEEDED" });
    rejected(run(withQuestion), { type: "SEND_SUCCEEDED" });
    rejected(run(withQuestion), { type: "SEND_FAILED" });
    rejected(run(answered), { type: "SEND_SUCCEEDED" });
    rejected(run(answered), { type: "SEND_FAILED" });
    rejected(run(failed), { type: "SEND_SUCCEEDED" });
  });

  it("a late result after Retake or Cancel is ignored", () => {
    const retaken = run([...sending, { type: "RETAKE" }]);
    rejected(retaken, { type: "SEND_SUCCEEDED" });
    rejected(retaken, { type: "SEND_FAILED" });
    const cancelled = run([...sending, { type: "CANCEL" }]);
    rejected(cancelled, { type: "SEND_SUCCEEDED" });
  });

  it("the question cannot be edited while sending or after an answer", () => {
    rejected(run(sending), { type: "QUESTION_CHANGED", text: "x" });
    rejected(run(answered), { type: "QUESTION_CHANGED", text: "x" });
    rejected(run(failed), { type: "QUESTION_CHANGED", text: "x" });
    rejected(run(sending), { type: "LISTEN_STARTED" });
  });

  it("EDIT and ASK_ANOTHER only from their own phases", () => {
    rejected(run(withQuestion), { type: "EDIT" });
    rejected(run(answered), { type: "EDIT" });
    rejected(run(sending), { type: "ASK_ANOTHER" });
    rejected(run(failed), { type: "ASK_ANOTHER" });
    rejected(run(withQuestion), { type: "ASK_ANOTHER" });
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

  it("cannot start listening twice", () => {
    rejected(run([...captured, { type: "LISTEN_STARTED" }]), { type: "LISTEN_STARTED" });
  });

  it("ignores stray transcript, listen-end and capture events", () => {
    rejected(run(captured), { type: "TRANSCRIPT", text: "late result" });
    rejected(run(captured), { type: "LISTEN_ENDED" });
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

describe("retake and cancel", () => {
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

  it("retake while listening or sending returns to the live preview", () => {
    assert.equal(run([...withQuestion, { type: "LISTEN_STARTED" }, { type: "RETAKE" }]).phase, "idle");
    const retaken = run([...sending, { type: "RETAKE" }]);
    assert.equal(retaken.phase, "idle");
    assert.equal(retaken.hasImage, false);
  });

  it("cancel discards image and question from any phase, including a request in flight", () => {
    for (const actions of [
      [{ type: "CAPTURE_REQUESTED", cameraActive: true }] as AskAction[],
      captured,
      withQuestion,
      [...withQuestion, { type: "LISTEN_STARTED" }] as AskAction[],
      sending,
      answered,
      failed,
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

  it("the shared limit matches the server's", () => {
    assert.equal(MAX_QUESTION_CHARS, 500);
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
    assert.equal(canRetake(run(sending)), true);
    assert.equal(canRetake(run(answered)), true);
    assert.equal(canListen(run(captured)), true);
    assert.equal(canListen(run([...captured, { type: "LISTEN_STARTED" }])), false);
    assert.equal(canListen(run(sending)), false);
    assert.equal(canEditQuestion(run(captured)), true);
    assert.equal(canEditQuestion(run(sending)), false);
    assert.equal(canEditQuestion(INITIAL_ASK_CONTEXT), false);
  });

  it("askBlockedReason explains why Ask is unavailable", () => {
    assert.equal(askBlockedReason(INITIAL_ASK_CONTEXT), "Take a photo first.");
    assert.equal(askBlockedReason(run(captured)), "Type or say a question to turn on Ask.");
    assert.equal(askBlockedReason(run(withQuestion)), null);
    assert.equal(askBlockedReason(run(sending)), "Your question is being answered.");
    assert.equal(askBlockedReason(run(answered)), "Your question has already been sent.");
    assert.equal(askBlockedReason(run([...withQuestion, { type: "LISTEN_STARTED" }])), "Finish speaking first.");
  });
});
