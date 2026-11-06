import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ADJUSTMENT_CODES,
  ADJUSTMENT_TEXT,
  ASK_RESULT_LIMITS,
  CONFIDENCE_LABELS,
  INTENT_LABELS,
  INTENTS,
  NOTICE_CODES,
  NOTICE_TEXT,
  parseAskResult,
} from "./ask-result.ts";
import { checkCurrency } from "./currency.ts";
import { checkExpiry } from "./expiry.ts";
import { claimsAuthenticity, claimsProductSafety, givesMedicalAdvice, makesNavigationClaim, splitSentences } from "./safety.ts";

const valid = () => ({
  intent: "text_reading",
  answer: "It is a red mug.",
  details: null,
  uncertainty: "The label is blurry.",
  confidence: "medium",
  printed_text: null,
  printed_instructions: null,
  currency_check: null,
  expiry_check: null,
  notices: [] as string[],
  adjustments: [] as string[],
});

const expiry = checkExpiry({ expiryText: "08/2027", expiryKind: "expiry", manufacturingText: "02/2026", dateText: null }, { year: 2026, month: 11, day: 6 }, "device");
const currency = checkCurrency(
  { denomination: 500, currency: "INR", evidence: "the numeral 500 and the portrait" },
  { confidence: "high", asksAboutCurrency: true, answerText: "It looks like a 500 rupee note" },
);

describe("parseAskResult (the response the browser validates)", () => {
  it("accepts a complete valid result and returns it unchanged", () => {
    assert.deepEqual(parseAskResult(valid()), valid());
  });

  it("accepts a result with expiry and currency checks, notices and adjustments", () => {
    const full = { ...valid(), intent: "expiry_date", expiry_check: expiry, currency_check: currency, notices: ["expiry_limits", "currency_limits"], adjustments: ["expiry_conclusion_replaced"] };
    const parsed = parseAskResult(JSON.parse(JSON.stringify(full)));
    assert.ok(parsed);
    assert.equal(parsed.expiry_check?.status, "not_expired");
    assert.equal(parsed.currency_check?.denomination, 500);
  });

  it("keeps the five Milestone 5 fields with their names and types (compatibility)", () => {
    const parsed = parseAskResult(valid());
    assert.ok(parsed);
    for (const key of ["answer", "details", "uncertainty", "printed_text", "printed_instructions"]) assert.ok(key in parsed, key);
    assert.equal(typeof parsed.answer, "string");
  });

  it("every supported intent is accepted", () => {
    for (const intent of INTENTS) assert.equal(parseAskResult({ ...valid(), intent })?.intent, intent);
  });

  it("rejects non-objects", () => {
    for (const v of [null, undefined, "text", 42, [], [valid()], true]) assert.equal(parseAskResult(v), null);
  });

  it("rejects an invalid or missing intent and confidence", () => {
    for (const intent of ["banana", "", null, undefined, 4]) assert.equal(parseAskResult({ ...valid(), intent }), null, String(intent));
    for (const confidence of ["certain", "85%", 0.9, null, undefined]) assert.equal(parseAskResult({ ...valid(), confidence }), null, String(confidence));
  });

  it("rejects a missing, empty or non-string answer", () => {
    for (const answer of [undefined, "", "   ", null, 5]) assert.equal(parseAskResult({ ...valid(), answer }), null, String(answer));
  });

  it("rejects incomplete results: every field is required", () => {
    for (const key of Object.keys(valid())) {
      const partial: Record<string, unknown> = valid();
      delete partial[key];
      assert.equal(parseAskResult(partial), null, `missing ${key}`);
    }
  });

  it("rejects wrong types in optional text fields", () => {
    for (const key of ["details", "uncertainty", "printed_text", "printed_instructions"]) {
      for (const v of [5, true, ["a"], {}]) assert.equal(parseAskResult({ ...valid(), [key]: v }), null, `${key}=${JSON.stringify(v)}`);
    }
  });

  it("turns blank optional strings into null and trims", () => {
    const r = parseAskResult({ ...valid(), answer: "  Hi  ", details: "   ", printed_text: " ABC \n" });
    assert.equal(r?.answer, "Hi");
    assert.equal(r?.details, null);
    assert.equal(r?.printed_text, "ABC");
  });

  it("drops unexpected extra fields", () => {
    const r = parseAskResult({ ...valid(), extra: "x", html: "<script>", system: "y" });
    assert.ok(r);
    assert.deepEqual(Object.keys(r).sort(), Object.keys(valid()).sort());
  });

  it("enforces the length limits", () => {
    for (const key of ["answer", "details", "uncertainty", "printed_text", "printed_instructions"] as const) {
      const limit = ASK_RESULT_LIMITS[key];
      assert.ok(parseAskResult({ ...valid(), [key]: "a".repeat(limit) }), `${key} at limit`);
      assert.equal(parseAskResult({ ...valid(), [key]: "a".repeat(limit + 1) }), null, `${key} over limit`);
    }
  });

  it("rejects malformed expiry and currency checks", () => {
    assert.equal(parseAskResult({ ...valid(), expiry_check: { status: "safe" } }), null);
    assert.equal(parseAskResult({ ...valid(), expiry_check: "expired" }), null);
    assert.equal(parseAskResult({ ...valid(), currency_check: { status: "identified", denomination: 1000, evidence: null, message: "m" } }), null);
    assert.equal(parseAskResult({ ...valid(), currency_check: { status: "identified", denomination: null, evidence: null, message: "m" } }), null);
    assert.equal(parseAskResult({ ...valid(), currency_check: { status: "uncertain", denomination: 500, evidence: null, message: "m" } }), null);
  });

  it("rejects unknown or non-list notices and adjustments", () => {
    assert.equal(parseAskResult({ ...valid(), notices: ["made_up"] }), null);
    assert.equal(parseAskResult({ ...valid(), adjustments: ["made_up"] }), null);
    assert.equal(parseAskResult({ ...valid(), notices: "label_only" }), null);
    assert.equal(parseAskResult({ ...valid(), adjustments: [1] }), null);
    assert.deepEqual(parseAskResult({ ...valid(), notices: ["label_only", "label_only"] })?.notices, ["label_only"]);
  });
});

describe("display text tables", () => {
  it("every intent, confidence level, notice and adjustment has wording", () => {
    for (const i of INTENTS) assert.ok(INTENT_LABELS[i].length > 3, i);
    for (const c of ["low", "medium", "high"] as const) assert.ok(CONFIDENCE_LABELS[c]);
    for (const n of NOTICE_CODES) assert.ok(NOTICE_TEXT[n].length > 20, n);
    for (const a of ADJUSTMENT_CODES) assert.ok(ADJUSTMENT_TEXT[a].length > 20, a);
  });

  it("confidence is never shown as a number or percentage", () => {
    for (const c of ["low", "medium", "high"] as const) assert.doesNotMatch(CONFIDENCE_LABELS[c], /\d|%/);
  });

  it("fixed wording makes no safety, medical or authenticity claim (checked with the app's own guards)", () => {
    const all = [...NOTICE_CODES.map((n) => NOTICE_TEXT[n]), ...ADJUSTMENT_CODES.map((a) => ADJUSTMENT_TEXT[a])];
    for (const text of all) {
      for (const sentence of splitSentences(text)) {
        assert.equal(makesNavigationClaim(sentence), false, sentence);
        assert.equal(givesMedicalAdvice(sentence), false, sentence);
        assert.equal(claimsAuthenticity(sentence), false, sentence);
        assert.equal(claimsProductSafety(sentence), false, sentence);
      }
      assert.doesNotMatch(text, /guarantee|100%/i);
    }
    assert.match(NOTICE_TEXT.currency_limits, /cannot tell whether a note is genuine or counterfeit/);
    assert.match(NOTICE_TEXT.expiry_limits, /does not tell you whether the product is safe/);
    assert.match(NOTICE_TEXT.label_only, /does not give medical advice/);
  });
});
