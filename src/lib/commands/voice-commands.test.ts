import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { availableCommands, commandHelp, commandUnavailable, isCommandAvailable, parseCommand, type CommandContext } from "./voice-commands.ts";

const ctx = (over: Partial<CommandContext> = {}): CommandContext => ({ canCapture: false, canRetake: false, canListen: false, hasAnswer: false, canAsk: false, ...over });

describe("parseCommand: the whole utterance must be a command", () => {
  it("recognises each command and its natural variants", () => {
    assert.equal(parseCommand("Capture photo."), "capture-photo");
    assert.equal(parseCommand("take a picture"), "capture-photo");
    assert.equal(parseCommand("Retake photo"), "retake-photo");
    assert.equal(parseCommand("start speaking"), "start-speaking");
    assert.equal(parseCommand("Repeat answer"), "repeat-answer");
    assert.equal(parseCommand("read the answer"), "repeat-answer");
    assert.equal(parseCommand("Ask"), "ask");
    assert.equal(parseCommand("send"), "ask");
  });

  it("ignores filler words and punctuation", () => {
    assert.equal(parseCommand("Please capture photo!"), "capture-photo");
    assert.equal(parseCommand("hey VisionAid, retake photo"), "retake-photo");
    assert.equal(parseCommand("  OK   repeat   answer  "), "repeat-answer");
  });

  it("does not spot commands inside other speech, so ordinary talking cannot act", () => {
    for (const said of [
      "can you send this to my friend",
      "I want to ask about the medicine",
      "what does the label say about taking a photo",
      "please do not capture photo now",
      "send my photo to the doctor",
      "",
      "   ",
      "stop speaking",
      "stop listening",
    ]) {
      assert.equal(parseCommand(said), null, said);
    }
  });

  it("does not understand Hindi or Kannada commands (English only in this milestone)", () => {
    assert.equal(parseCommand("फोटो लो"), null);
    assert.equal(parseCommand("ಫೋಟೋ ತೆಗೆಯಿರಿ"), null);
  });
});

describe("command availability follows the current step", () => {
  it("capture only with the camera on and no photo", () => {
    assert.equal(isCommandAvailable("capture-photo", ctx({ canCapture: true })), true);
    assert.equal(isCommandAvailable("capture-photo", ctx({ canRetake: true })), false);
  });
  it("retake only when a photo exists that has not been sent", () => {
    assert.equal(isCommandAvailable("retake-photo", ctx({ canRetake: true })), true);
    assert.equal(isCommandAvailable("retake-photo", ctx({ canCapture: true })), false);
  });
  it("repeat answer only when an answer exists", () => {
    assert.equal(isCommandAvailable("repeat-answer", ctx({ hasAnswer: true })), true);
    assert.equal(isCommandAvailable("repeat-answer", ctx()), false);
  });
  it("lists only what works now, and the help text matches", () => {
    assert.deepEqual(availableCommands(ctx({ canCapture: true })), ["capture-photo"]);
    assert.deepEqual(availableCommands(ctx({ canRetake: true, canListen: true, canAsk: true })), ["retake-photo", "start-speaking", "ask"]);
    assert.equal(commandHelp(ctx({ canCapture: true })), "Command not recognised. You can say: capture photo.");
    assert.equal(commandHelp(ctx()), "No voice command is available at this step.");
  });
  it("every unavailable command explains why", () => {
    for (const c of ["capture-photo", "retake-photo", "start-speaking", "repeat-answer", "ask"] as const) assert.ok(commandUnavailable(c).length > 20);
  });
});
