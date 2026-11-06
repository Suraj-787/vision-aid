import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AskResult } from "../ask/ask-result.ts";
import { answerLanguageNotes, chooseResponseLanguage } from "./answer-language.ts";

const result = (over: Partial<AskResult> = {}): AskResult => ({
  intent: "scene_description",
  answer: "I can see a white box.",
  details: null,
  uncertainty: null,
  confidence: "high",
  printed_text: null,
  printed_instructions: null,
  currency_check: null,
  expiry_check: null,
  notices: [],
  adjustments: [],
  ...over,
});

describe("answerLanguageNotes", () => {
  it("says nothing for an English answer to an English request", () => {
    assert.deepEqual(answerLanguageNotes("en-IN", result()), []);
  });

  it("says nothing extra for a Hindi answer to a Hindi request with no app checks", () => {
    assert.deepEqual(answerLanguageNotes("hi-IN", result({ answer: "यह एक सफेद डिब्बा है।" })), []);
  });

  it("is honest when the answer came back in a different language than requested", () => {
    const notes = answerLanguageNotes("hi-IN", result());
    assert.equal(notes.length, 1);
    assert.match(notes[0], /You asked for Hindi, but this answer is mostly in English/);
    assert.match(notes[0], /does not translate/);
    const kn = answerLanguageNotes("kn-IN", result({ answer: "यह एक सफेद डिब्बा है।" }));
    assert.match(kn[0], /You asked for Kannada, but this answer is mostly in Hindi/);
  });

  it("an English request answered in Hindi is also reported", () => {
    assert.match(answerLanguageNotes("en-IN", result({ answer: "यह एक सफेद डिब्बा है।" }))[0], /You asked for English/);
  });

  it("explains that VisionAid's own checks stay in English when the answer is not English", () => {
    const check = { status: "unclear" } as AskResult["expiry_check"];
    const notes = answerLanguageNotes("hi-IN", result({ answer: "यह एक सफेद डिब्बा है।", expiry_check: check, notices: ["expiry_limits"] }));
    assert.equal(notes.length, 1);
    assert.match(notes[0], /expiry check and VisionAid's notices are written by VisionAid in English only/);
  });

  it("does not mention English-only parts for an English answer to an English request", () => {
    const check = { status: "unclear" } as AskResult["expiry_check"];
    assert.deepEqual(answerLanguageNotes("en-IN", result({ expiry_check: check })), []);
  });
});

describe("chooseResponseLanguage (the answer follows the language of the question)", () => {
  it("a Hindi or Kannada question is answered in that language even if English is selected", () => {
    assert.equal(chooseResponseLanguage("en-IN", "यह क्या है?"), "hi-IN");
    assert.equal(chooseResponseLanguage("en-IN", "ಇದು ಏನು?"), "kn-IN");
    assert.equal(chooseResponseLanguage("hi-IN", "ಇದು ಏನು?"), "kn-IN");
  });

  it("a question in English letters keeps the selector, so choosing Hindi still gives Hindi", () => {
    assert.equal(chooseResponseLanguage("en-IN", "What is this?"), "en-IN");
    assert.equal(chooseResponseLanguage("hi-IN", "What is this?"), "hi-IN");
    assert.equal(chooseResponseLanguage("kn-IN", "kya hai yeh?"), "kn-IN");
  });

  it("digits-only or empty questions keep the selector", () => {
    assert.equal(chooseResponseLanguage("hi-IN", "500"), "hi-IN");
    assert.equal(chooseResponseLanguage("kn-IN", ""), "kn-IN");
  });

  it("a mostly-English question with one Hindi word is not switched", () => {
    assert.equal(chooseResponseLanguage("en-IN", "Does this box say क्रोसिन on the front of the packet?"), "en-IN");
  });
});

describe("answerLanguageNotes when the question's language overrode the selector", () => {
  it("says so, so the switch is never silent", () => {
    const notes = answerLanguageNotes("hi-IN", result({ answer: "यह एक सफेद डिब्बा है।" }), "en-IN");
    assert.equal(notes.length, 1);
    assert.match(notes[0], /Your question is written in Hindi, so Hindi was requested for the answer even though English is selected/);
  });

  it("adds nothing when the selector was used as is", () => {
    assert.deepEqual(answerLanguageNotes("hi-IN", result({ answer: "यह एक सफेद डिब्बा है।" }), "hi-IN"), []);
  });
});
