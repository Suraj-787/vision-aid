import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  checkCurrency,
  CURRENCY_LIMITS_NOTICE,
  DENOMINATIONS,
  isDenomination,
  isIndianRupee,
  mentionedDenominations,
  parseCurrencyCheck,
  type CurrencyInput,
} from "./currency.ts";

type Conf = "low" | "medium" | "high";
const input = (over: Partial<CurrencyInput> = {}): CurrencyInput => ({
  denomination: 500,
  currency: "INR",
  evidence: "the printed numeral 500 and the portrait",
  ...over,
});
const run = (over: Partial<CurrencyInput> = {}, ctx: { confidence?: Conf; asks?: boolean; answer?: string } = {}) =>
  checkCurrency(input(over), {
    confidence: ctx.confidence ?? "high",
    asksAboutCurrency: ctx.asks ?? true,
    answerText: ctx.answer ?? "",
  });

describe("every supported denomination", () => {
  it("is exactly 10, 20, 50, 100, 200 and 500", () => {
    assert.deepEqual([...DENOMINATIONS], [10, 20, 50, 100, 200, 500]);
  });

  for (const d of DENOMINATIONS) {
    it(`₹${d} is identified when evidence supports it`, () => {
      const c = run({ denomination: d });
      assert.ok(c);
      assert.equal(c.status, "identified");
      assert.equal(c.denomination, d);
      assert.match(c.message, new RegExp(`₹${d} note`));
      assert.equal(c.evidence, "the printed numeral 500 and the portrait");
    });
  }

  it("medium confidence is worded as a possibility, high as 'looks like'", () => {
    assert.match(run({}, { confidence: "high" })!.message, /^This looks like a ₹500 note/);
    assert.match(run({}, { confidence: "medium" })!.message, /^This may be a ₹500 note.*double-check/);
  });
});

describe("unsupported and invalid denominations", () => {
  it("values that are not supported notes are never shown", () => {
    for (const d of [1000, 2000, 5, 1, 0, -10, 10.5, 499, 501, 25, 75, 1e6]) {
      const c = run({ denomination: d });
      assert.ok(c, String(d));
      assert.equal(c.status, "uncertain", String(d));
      assert.equal(c.denomination, null, String(d));
      assert.match(c.message, /not one of the notes I can report/, String(d));
      assert.doesNotMatch(c.message, new RegExp(`₹${d}\\b`), String(d)); // not echoed as a result
    }
  });

  it("isDenomination is strict about type", () => {
    for (const v of [10, 20, 50, 100, 200, 500]) assert.equal(isDenomination(v), true);
    for (const v of ["500", 500.5, null, undefined, NaN, Infinity, {}, [500], true]) assert.equal(isDenomination(v), false, String(v));
  });

  it("a currency other than the Indian rupee is not identified", () => {
    for (const code of ["USD", "EUR", "GBP", "dollar", "JPY"]) {
      const c = run({ currency: code });
      assert.equal(c?.status, "uncertain", code);
      assert.equal(c?.denomination, null, code);
    }
  });

  it("accepts the usual spellings of the Indian rupee, and a missing currency code", () => {
    for (const code of ["INR", "inr", "₹", "Rs", "Rs.", "rupee", "rupees", "Indian Rupee", "Indian rupees", " INR "]) {
      assert.equal(isIndianRupee(code), true, code);
      assert.equal(run({ currency: code })?.status, "identified", code);
    }
    assert.equal(run({ currency: null })?.status, "identified");
    assert.equal(isIndianRupee("USD"), false);
    assert.equal(isIndianRupee("INR; DROP"), false);
  });
});

describe("missing denomination", () => {
  it("is uncertain (with a retake tip) when the question was about a banknote", () => {
    const c = run({ denomination: null, currency: null, evidence: null });
    assert.ok(c);
    assert.equal(c.status, "uncertain");
    assert.equal(c.denomination, null);
    assert.match(c.message, /could not tell which banknote/);
    assert.match(c.message, /flat, in good light/);
  });

  it("is absent entirely when nothing was reported and the question was not about a banknote", () => {
    assert.equal(run({ denomination: null, currency: null, evidence: null }, { asks: false }), null);
  });

  it("a note value with no denomination reported but other fields set is uncertain", () => {
    const c = run({ denomination: null }, { asks: false });
    assert.equal(c?.status, "uncertain");
    assert.equal(c?.denomination, null);
  });
});

describe("low confidence and ambiguous or incomplete evidence", () => {
  it("low confidence never produces a denomination", () => {
    const c = run({}, { confidence: "low" });
    assert.equal(c?.status, "uncertain");
    assert.equal(c?.denomination, null);
    assert.match(c!.message, /not confident/);
    assert.equal(c?.evidence, "the printed numeral 500 and the portrait"); // evidence is still shown for context
  });

  it("no evidence, blank evidence or very short evidence is not enough", () => {
    for (const evidence of [null, "", "   ", "500", "yes", "seen"]) {
      const c = run({ evidence });
      assert.equal(c?.status, "uncertain", JSON.stringify(evidence));
      assert.equal(c?.denomination, null, JSON.stringify(evidence));
      assert.match(c!.message, /no visible features were given/);
    }
  });

  it("an answer that contradicts the structured value is not trusted", () => {
    const c = run({ denomination: 100 }, { answer: "This looks like a ₹500 note." });
    assert.equal(c?.status, "uncertain");
    assert.equal(c?.denomination, null);
    assert.match(c!.message, /disagreed/);
  });

  it("an answer that agrees is fine, and one that names no value is fine", () => {
    assert.equal(run({ denomination: 500 }, { answer: "It looks like a ₹500 note." })?.status, "identified");
    assert.equal(run({ denomination: 500 }, { answer: "I can see a note with a portrait." })?.status, "identified");
    assert.equal(run({ denomination: 500 }, { answer: "Rs. 500 and 500 rupees are the same value" })?.status, "identified");
  });

  it("every uncertain result carries no denomination and offers a retake tip", () => {
    const cases = [
      run({ denomination: null, currency: null, evidence: null }),
      run({ denomination: 1000 }),
      run({ currency: "USD" }),
      run({ evidence: null }),
      run({}, { confidence: "low" }),
      run({ denomination: 20 }, { answer: "₹50" }),
    ];
    for (const c of cases) {
      assert.ok(c);
      assert.equal(c.status, "uncertain");
      assert.equal(c.denomination, null);
      assert.match(c.message, /Lay the whole note flat/);
    }
  });
});

describe("never claims authenticity", () => {
  it("no message says or implies a note is genuine or fake", () => {
    const messages = [
      run({})!.message,
      run({}, { confidence: "medium" })!.message,
      run({}, { confidence: "low" })!.message,
      run({ denomination: 1000 })!.message,
      run({ evidence: null })!.message,
      run({ denomination: null, currency: null, evidence: null })!.message,
      run({ currency: "USD" })!.message,
    ];
    for (const m of messages) assert.doesNotMatch(m, /\b(genuine|fake|counterfeit|authentic|forged|real note)\b/i, m);
  });

  it("the standing notice says VisionAid cannot tell", () => {
    assert.match(CURRENCY_LIMITS_NOTICE, /cannot tell whether a note is genuine or counterfeit/);
  });
});

describe("mentionedDenominations", () => {
  it("finds values written several ways", () => {
    assert.deepEqual(mentionedDenominations("a ₹500 note"), [500]);
    assert.deepEqual(mentionedDenominations("Rs. 100 note"), [100]);
    assert.deepEqual(mentionedDenominations("Rs 20"), [20]);
    assert.deepEqual(mentionedDenominations("INR 50"), [50]);
    assert.deepEqual(mentionedDenominations("a 200 rupee note"), [200]);
    assert.deepEqual(mentionedDenominations("10 rupees"), [10]);
    assert.deepEqual(mentionedDenominations("₹ 500"), [500]);
    assert.deepEqual(mentionedDenominations("500/-"), [500]);
  });

  it("finds spelled-out values", () => {
    assert.deepEqual(mentionedDenominations("a hundred rupee note"), [100]);
    assert.deepEqual(mentionedDenominations("a one hundred rupee note"), [100]);
    assert.deepEqual(mentionedDenominations("fifty rupees"), [50]);
    assert.deepEqual(mentionedDenominations("a ten-rupee note"), [10]);
    assert.deepEqual(mentionedDenominations("a twenty rupee note"), [20]);
    assert.deepEqual(mentionedDenominations("two hundred rupee note"), [200]);
    assert.deepEqual(mentionedDenominations("five hundred rupee note"), [500]);
  });

  it("ignores numbers that are not amounts of money", () => {
    assert.deepEqual(mentionedDenominations("There are 500 tablets in the box"), []);
    assert.deepEqual(mentionedDenominations("EXP 08/2027, 3 items"), []);
    assert.deepEqual(mentionedDenominations(""), []);
  });
});

describe("parseCurrencyCheck (validation of a server reply)", () => {
  const good = run({})!;
  it("accepts real checks", () => {
    assert.deepEqual(parseCurrencyCheck(JSON.parse(JSON.stringify(good))), good);
    const unc = run({}, { confidence: "low" })!;
    assert.deepEqual(parseCurrencyCheck(JSON.parse(JSON.stringify(unc))), unc);
  });

  it("rejects malformed checks and enforces that only 'identified' carries a value", () => {
    const base = JSON.parse(JSON.stringify(good));
    assert.equal(parseCurrencyCheck({ ...base, status: "genuine" }), null);
    assert.equal(parseCurrencyCheck({ ...base, denomination: 1000 }), null);
    assert.equal(parseCurrencyCheck({ ...base, denomination: "500" }), null);
    assert.equal(parseCurrencyCheck({ ...base, denomination: null }), null);
    assert.equal(parseCurrencyCheck({ ...base, status: "uncertain" }), null); // uncertain must not carry a value
    assert.equal(parseCurrencyCheck({ ...base, message: "" }), null);
    assert.equal(parseCurrencyCheck({ ...base, evidence: 5 }), null);
    assert.equal(parseCurrencyCheck({ ...base, evidence: "x".repeat(700) }), null);
    for (const v of [null, undefined, "x", 1, [], true]) assert.equal(parseCurrencyCheck(v), null);
  });
});
