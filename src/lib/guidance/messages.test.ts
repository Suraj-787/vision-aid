import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { detectAnswerLanguage, scriptCounts } from "../speech/script.ts";
import { SUPPORTED_LANGS } from "../speech/types.ts";
import { GUIDANCE_EVENTS, guidanceText, photoGuidance } from "./messages.ts";

describe("voice guidance wording", () => {
  it("every event has a message in English, Hindi and Kannada", () => {
    for (const { code } of SUPPORTED_LANGS) {
      for (const event of GUIDANCE_EVENTS) {
        const text = guidanceText(event, code);
        assert.ok(text.length > 5, `${code} ${event}`);
      }
    }
  });

  it("messages are short enough to hear in one go", () => {
    for (const { code } of SUPPORTED_LANGS) {
      for (const event of GUIDANCE_EVENTS) assert.ok(guidanceText(event, code).length <= 130, `${code} ${event}: ${guidanceText(event, code).length}`);
    }
  });

  it("each message is entirely in its own language's script, so one matching voice reads it", () => {
    for (const { code } of SUPPORTED_LANGS) {
      for (const event of GUIDANCE_EVENTS) {
        const text = guidanceText(event, code);
        assert.equal(detectAnswerLanguage(text), code, `${code} ${event}`);
        if (code !== "en-IN") assert.equal(scriptCounts(text).latin, 0, `${code} ${event} contains Latin letters`);
      }
    }
  });

  it("never claims a path, road or area is safe or clear", () => {
    for (const { code } of SUPPORTED_LANGS) {
      for (const event of GUIDANCE_EVENTS) {
        assert.doesNotMatch(guidanceText(event, code), /\bsafe\b|\bclear\b|obstacle|route|walk/i);
      }
    }
  });

  it("the English wording covers the documented moments", () => {
    assert.match(guidanceText("camera-ready", "en-IN"), /Camera is ready/);
    assert.match(guidanceText("listening", "en-IN"), /Listening\. Speak your question/);
    assert.match(guidanceText("answer-ready", "en-IN"), /answer is ready/);
    assert.match(guidanceText("failed", "en-IN"), /try again/);
  });
});

describe("photoGuidance", () => {
  it("photo captured plus the next step", () => {
    assert.equal(photoGuidance("en-IN", false), "Photo captured. You can now ask your question.");
  });
  it("adds the advisory only when the quality check found something, and still offers to continue", () => {
    const text = photoGuidance("en-IN", true);
    assert.match(text, /may be unclear/);
    assert.match(text, /retake it, or continue/);
  });
  it("is read by one voice in Hindi and Kannada", () => {
    assert.equal(detectAnswerLanguage(photoGuidance("hi-IN", true)), "hi-IN");
    assert.equal(detectAnswerLanguage(photoGuidance("kn-IN", true)), "kn-IN");
  });
});
