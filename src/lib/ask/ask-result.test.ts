import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ASK_RESULT_LIMITS, parseAskResult, parseModelText } from "./ask-result.ts";

const valid = {
  answer: "It is a red mug.",
  details: null,
  uncertainty: "The label is blurry.",
  printed_text: null,
  printed_instructions: null,
};

describe("parseAskResult", () => {
  it("accepts a complete valid result", () => {
    assert.deepEqual(parseAskResult(valid), valid);
  });

  it("trims strings and turns blank optional strings into null", () => {
    const r = parseAskResult({ ...valid, answer: "  Hi  ", details: "   ", printed_text: "  ABC \n" });
    assert.equal(r?.answer, "Hi");
    assert.equal(r?.details, null);
    assert.equal(r?.printed_text, "ABC");
  });

  it("drops unknown extra fields", () => {
    const r = parseAskResult({ ...valid, extra: "x", script: "<script>" });
    assert.ok(r);
    assert.deepEqual(Object.keys(r).sort(), Object.keys(valid).sort());
  });

  it("rejects non-objects", () => {
    for (const v of [null, undefined, "text", 42, [], [valid], true]) assert.equal(parseAskResult(v), null);
  });

  it("rejects a missing, empty, blank or non-string answer", () => {
    const { answer: _omit, ...noAnswer } = valid;
    void _omit;
    assert.equal(parseAskResult(noAnswer), null);
    assert.equal(parseAskResult({ ...valid, answer: "" }), null);
    assert.equal(parseAskResult({ ...valid, answer: "   " }), null);
    assert.equal(parseAskResult({ ...valid, answer: null }), null);
    assert.equal(parseAskResult({ ...valid, answer: 5 }), null);
  });

  it("rejects incomplete results (a required field is missing)", () => {
    for (const key of ["details", "uncertainty", "printed_text", "printed_instructions"] as const) {
      const partial: Record<string, unknown> = { ...valid };
      delete partial[key];
      assert.equal(parseAskResult(partial), null, `missing ${key}`);
    }
  });

  it("rejects wrong types in optional fields", () => {
    assert.equal(parseAskResult({ ...valid, details: 5 }), null);
    assert.equal(parseAskResult({ ...valid, uncertainty: ["a"] }), null);
    assert.equal(parseAskResult({ ...valid, printed_text: { t: 1 } }), null);
    assert.equal(parseAskResult({ ...valid, printed_instructions: false }), null);
  });

  it("enforces the length limits (the API does not)", () => {
    assert.ok(parseAskResult({ ...valid, answer: "a".repeat(ASK_RESULT_LIMITS.answer) }));
    assert.equal(parseAskResult({ ...valid, answer: "a".repeat(ASK_RESULT_LIMITS.answer + 1) }), null);
    assert.equal(parseAskResult({ ...valid, details: "d".repeat(ASK_RESULT_LIMITS.details + 1) }), null);
    assert.equal(parseAskResult({ ...valid, uncertainty: "u".repeat(ASK_RESULT_LIMITS.uncertainty + 1) }), null);
    assert.equal(parseAskResult({ ...valid, printed_text: "p".repeat(ASK_RESULT_LIMITS.printed_text + 1) }), null);
    assert.equal(
      parseAskResult({ ...valid, printed_instructions: "i".repeat(ASK_RESULT_LIMITS.printed_instructions + 1) }),
      null,
    );
  });

  it("preserves non-Latin text", () => {
    const r = parseAskResult({ ...valid, answer: "यह एक लाल मग है।", printed_text: "ಇದು ಒಂದು ಪರೀಕ್ಷೆ" });
    assert.equal(r?.answer, "यह एक लाल मग है।");
    assert.equal(r?.printed_text, "ಇದು ಒಂದು ಪರೀಕ್ಷೆ");
  });
});

describe("parseModelText", () => {
  it("parses JSON text into a result", () => {
    const r = parseModelText(JSON.stringify(valid));
    assert.equal(r.ok, true);
  });

  it("reports empty output", () => {
    for (const t of [undefined, null, "", "   \n"]) {
      assert.deepEqual(parseModelText(t), { ok: false, reason: "empty" });
    }
  });

  it("reports non-JSON output (including markdown-fenced JSON)", () => {
    assert.deepEqual(parseModelText("Sure! The answer is a mug."), { ok: false, reason: "not_json" });
    assert.deepEqual(parseModelText("```json\n" + JSON.stringify(valid) + "\n```"), {
      ok: false,
      reason: "not_json",
    });
    assert.deepEqual(parseModelText('{"answer": "cut off'), { ok: false, reason: "not_json" });
  });

  it("reports JSON of the wrong shape", () => {
    assert.deepEqual(parseModelText("[]"), { ok: false, reason: "invalid_shape" });
    assert.deepEqual(parseModelText('{"answer": ""}'), { ok: false, reason: "invalid_shape" });
    assert.deepEqual(parseModelText('{"text": "hello"}'), { ok: false, reason: "invalid_shape" });
    assert.deepEqual(parseModelText("null"), { ok: false, reason: "invalid_shape" });
  });
});
