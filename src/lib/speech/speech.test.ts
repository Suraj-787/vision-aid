import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mapSpeechErrorCode, speechError, type SpeechErrorKind } from "./speech-errors.ts";
import { collectTranscript, type ResultLike } from "./transcript.ts";

const result = (transcript: string, isFinal: boolean): ResultLike => ({
  isFinal,
  length: 1,
  0: { transcript },
});

describe("collectTranscript", () => {
  it("joins results, normalises whitespace and reports finality", () => {
    assert.deepEqual(collectTranscript([result("what does", true), result(" this say", true)]), {
      text: "what does this say",
      isFinal: true,
    });
  });

  it("is not final while any result is interim", () => {
    assert.equal(collectTranscript([result("what", true), result(" is", false)]).isFinal, false);
  });

  it("handles no results and empty alternatives", () => {
    assert.deepEqual(collectTranscript([]), { text: "", isFinal: false });
    assert.deepEqual(collectTranscript([{ isFinal: true, length: 0 }]), { text: "", isFinal: true });
  });

  it("preserves non-Latin text (Hindi, Kannada)", () => {
    assert.equal(collectTranscript([result("यह क्या है", true)]).text, "यह क्या है");
    assert.equal(collectTranscript([result(" ಇದು ಏನು ", true)]).text, "ಇದು ಏನು");
  });
});

describe("mapSpeechErrorCode", () => {
  const cases: Array<[string, SpeechErrorKind | null]> = [
    ["not-allowed", "permission-denied"],
    ["service-not-allowed", "permission-denied"],
    ["no-speech", "no-speech"],
    ["audio-capture", "no-microphone"],
    ["network", "network"],
    ["language-not-supported", "language-not-supported"],
    ["aborted", null],
    ["bad-grammar", "unknown"],
    ["something-new", "unknown"],
  ];
  for (const [code, kind] of cases) {
    it(`${code} -> ${kind}`, () => assert.equal(mapSpeechErrorCode(code), kind));
  }

  it("every error message offers typing as an alternative", () => {
    const kinds: SpeechErrorKind[] = [
      "unsupported",
      "permission-denied",
      "no-speech",
      "no-microphone",
      "network",
      "language-not-supported",
      "start-failed",
      "unknown",
    ];
    for (const kind of kinds) {
      assert.match(speechError(kind).message, /type your question/i, kind);
    }
  });
});
