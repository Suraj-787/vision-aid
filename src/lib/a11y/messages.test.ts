import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { answerReadyAnnouncement, photoCapturedAnnouncement, transcriptAnnouncement } from "./messages.ts";

describe("photoCapturedAnnouncement", () => {
  it("adds only the next step when there is no advice, and never repeats the heading's words", () => {
    const text = photoCapturedAnnouncement([]);
    assert.equal(text, "Next, type or say your question.");
    assert.doesNotMatch(text, /Photo captured/i);
  });

  it("turns each quality issue into an advisory the person can act on or ignore", () => {
    assert.match(photoCapturedAnnouncement(["blurry"]), /may be blurry/);
    assert.match(photoCapturedAnnouncement(["too_dark"]), /may be too dark/);
    assert.match(photoCapturedAnnouncement(["too_bright"]), /too bright or have glare/);
    for (const issue of ["blurry", "too_dark", "too_bright"] as const) {
      assert.match(photoCapturedAnnouncement([issue]), /You can retake the photo, or continue/);
    }
  });

  it("never claims the photo is well framed, clear or readable", () => {
    for (const issues of [[], ["blurry"], ["too_dark", "too_bright"]] as const) {
      assert.doesNotMatch(photoCapturedAnnouncement(issues), /well framed|clear|readable|good photo|perfect/i);
    }
  });
});

describe("answerReadyAnnouncement", () => {
  it("says the answer is ready, without any of its content", () => {
    const text = answerReadyAnnouncement({ confidence: "high", uncertainty: null });
    assert.equal(text, "Your answer is ready.");
  });

  it("flags low confidence or something unclear, briefly", () => {
    assert.match(answerReadyAnnouncement({ confidence: "low", uncertainty: "blurry" }), /not confident/);
    assert.match(answerReadyAnnouncement({ confidence: "medium", uncertainty: "blurry" }), /something that is unclear/);
    assert.doesNotMatch(answerReadyAnnouncement({ confidence: "low", uncertainty: "blurry" }), /unclear/); // one warning, not two
  });
});

describe("transcriptAnnouncement", () => {
  it("reads back the recognised question so it can be corrected", () => {
    assert.equal(transcriptAnnouncement("What does this say?"), "Finished listening. Your question: What does this say?. Edit it, or choose Ask.");
    assert.match(transcriptAnnouncement("  what   is this "), /Your question: what is this\./);
  });
  it("says so when nothing was recognised and offers typing", () => {
    assert.match(transcriptAnnouncement("   "), /Nothing was recognised.*type your question/);
  });
});
