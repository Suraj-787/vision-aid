import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ALL_COMMANDS,
  availableCommands,
  COMMAND_STEPS,
  commandHelp,
  commandUnavailable,
  deriveCommandStep,
  isCommandAvailable,
  parseCommand,
  type CommandStep,
} from "./voice-commands.ts";


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

  it("ask and start-speaking phrases do not collide", () => {
    assert.equal(parseCommand("ask a question"), "start-speaking"); // dictate a question
    assert.equal(parseCommand("ask"), "ask"); // the send word
    assert.equal(parseCommand("send question"), "ask");
    assert.equal(parseCommand("ask question"), null); // ambiguous, so not accepted
  });

  it("recognises done and its natural variants", () => {
    for (const said of ["Done", "done.", "I'm done", "I am done", "all done", "Finish", "finished", "That's all", "end conversation", "Please say done"]) {
      assert.equal(parseCommand(said), said === "Please say done" ? null : "done", said);
    }
  });

  it("done must be the whole utterance, so ordinary talking cannot end a conversation", () => {
    for (const said of ["I am done reading the label", "are you done", "the date is done", "not done yet", "done with the medicine", "what does done mean"]) {
      assert.equal(parseCommand(said), null, said);
    }
  });

  it("does not understand Hindi or Kannada commands (English only in this milestone)", () => {
    assert.equal(parseCommand("फोटो लो"), null);
    assert.equal(parseCommand("ಫೋಟೋ ತೆಗೆಯಿರಿ"), null);
  });
});

/** The documented behaviour, written out so that any change to the rules is a visible change to this table. */
const EXPECTED: Record<CommandStep, string[]> = {
  "camera-off": [],
  "camera-ready": ["capture-photo"],
  photo: ["retake-photo", "start-speaking", "done"],
  "ready-to-ask": ["retake-photo", "start-speaking", "ask", "done"],
  sending: ["done"],
  answered: ["repeat-answer", "done"],
  failed: ["done"],
  busy: [],
};

describe("which commands work at each step (the complete table)", () => {
  for (const step of COMMAND_STEPS) {
    it(`${step}: ${EXPECTED[step].join(", ") || "none"}`, () => {
      assert.deepEqual(availableCommands({ step }), EXPECTED[step]);
      for (const c of ALL_COMMANDS) assert.equal(isCommandAvailable(c, { step }), EXPECTED[step].includes(c), `${step} ${c}`);
    });
  }

  it("capture photo works only with the camera on and no photo", () => {
    for (const step of COMMAND_STEPS) assert.equal(isCommandAvailable("capture-photo", { step }), step === "camera-ready");
  });
  it("retake photo works only before the question is sent", () => {
    for (const step of COMMAND_STEPS) assert.equal(isCommandAvailable("retake-photo", { step }), step === "photo" || step === "ready-to-ask");
  });
  it("ask works only with a photo AND a question, and not while sending or after an answer", () => {
    for (const step of COMMAND_STEPS) assert.equal(isCommandAvailable("ask", { step }), step === "ready-to-ask");
  });
  it("repeat answer works only when an answer is showing", () => {
    for (const step of COMMAND_STEPS) assert.equal(isCommandAvailable("repeat-answer", { step }), step === "answered");
  });
  it("done works from every step that has a photo, including while sending (it cancels the request)", () => {
    for (const step of COMMAND_STEPS) assert.equal(isCommandAvailable("done", { step }), ["photo", "ready-to-ask", "sending", "answered", "failed"].includes(step), step);
  });
  it("nothing runs while VisionAid is busy capturing or dictating", () => {
    assert.deepEqual(availableCommands({ step: "busy" }), []);
  });
});

describe("a command that cannot run is explained, in words that fit the step", () => {
  it("every unavailable command at every step has its own non-empty reason", () => {
    for (const step of COMMAND_STEPS) {
      for (const command of ALL_COMMANDS) {
        if (isCommandAvailable(command, { step })) continue;
        const reason = commandUnavailable(command, { step });
        assert.ok(reason.length > 20, `${step} ${command}`);
      }
    }
  });

  it("never gives a reason that contradicts the state (for example 'needs a photo' when there is one)", () => {
    for (const step of ["photo", "ready-to-ask", "sending", "answered", "failed"] as const) {
      for (const command of ALL_COMMANDS) {
        if (isCommandAvailable(command, { step })) continue;
        assert.doesNotMatch(commandUnavailable(command, { step }), /needs a photo|first taken|Start the camera/i, `${step} ${command}: ${commandUnavailable(command, { step })}`);
      }
    }
  });

  it("points to what does work", () => {
    assert.match(commandUnavailable("ask", { step: "answered" }), /Say done to start again, or use Ask another question/);
    assert.match(commandUnavailable("ask", { step: "photo" }), /needs a question first/);
    assert.match(commandUnavailable("ask", { step: "sending" }), /already being sent/);
    assert.match(commandUnavailable("ask", { step: "failed" }), /Try again/);
    assert.match(commandUnavailable("retake-photo", { step: "sending" }), /say done to cancel it/i);
    assert.match(commandUnavailable("capture-photo", { step: "camera-off" }), /Start the camera first/);
    assert.match(commandUnavailable("done", { step: "camera-ready" }), /once you have taken a photo/);
    assert.match(commandUnavailable("repeat-answer", { step: "photo" }), /no answer to repeat/);
  });

  it("while busy every command gets the same clear 'wait' message", () => {
    for (const command of ALL_COMMANDS) assert.match(commandUnavailable(command, { step: "busy" }), /busy right now/);
  });

  it("help lists only what works now", () => {
    assert.equal(commandHelp({ step: "camera-ready" }), "Command not recognised. You can say: capture photo.");
    assert.equal(commandHelp({ step: "ready-to-ask" }), "Command not recognised. You can say: retake photo, start speaking, ask, done.");
    assert.equal(commandHelp({ step: "answered" }), "Command not recognised. You can say: repeat answer, done.");
    assert.equal(commandHelp({ step: "camera-off" }), "No voice command is available at this step.");
  });
});

describe("deriveCommandStep maps the app's phases to a step", () => {
  it("no photo: camera on or off", () => {
    assert.equal(deriveCommandStep("idle", false, true), "camera-ready");
    assert.equal(deriveCommandStep("idle", false, false), "camera-off");
  });
  it("capturing and dictating are busy, with or without a photo", () => {
    assert.equal(deriveCommandStep("capturing", false, true), "busy");
    assert.equal(deriveCommandStep("listening", true, true), "busy");
  });
  it("each stored phase with a photo", () => {
    assert.equal(deriveCommandStep("image-captured", true, true), "photo");
    assert.equal(deriveCommandStep("question-ready", true, false), "ready-to-ask");
    assert.equal(deriveCommandStep("sending", true, true), "sending");
    assert.equal(deriveCommandStep("answered", true, true), "answered");
    assert.equal(deriveCommandStep("send-failed", true, true), "failed");
  });
});
