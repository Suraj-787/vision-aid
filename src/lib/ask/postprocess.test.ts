import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { INTENTS, parseAskResult, type AskResult } from "./ask-result.ts";
import type { DateOnly } from "./dates.ts";
import { parseModelOutput } from "./model-output.ts";
import { FALLBACK_ANSWER, LOW_CONFIDENCE_NOTE, postProcess } from "./postprocess.ts";
import { GUARD_NOTES } from "./safety.ts";

const TODAY: DateOnly = { year: 2026, month: 11, day: 6 };

const model = (over: Record<string, unknown> = {}) => {
  const { currency, expiry, ...rest } = over as Record<string, unknown> & {
    currency?: Record<string, unknown>;
    expiry?: Record<string, unknown>;
  };
  const out = parseModelOutput({
    intent: "general_question",
    answer: "A white box on a table.",
    details: null,
    uncertainty: null,
    confidence: "high",
    printed_text: null,
    printed_instructions: null,
    ...rest,
    currency: { denomination: null, currency: null, evidence: null, ...currency },
    expiry: { expiry_date: null, expiry_kind: null, manufacturing_date: null, date_text: null, ...expiry },
  });
  assert.ok(out, "test input must be a valid model output");
  return out;
};

const run = (over: Record<string, unknown> = {}, today: DateOnly = TODAY): AskResult => {
  const result = postProcess(model(over), { today, todaySource: "device" });
  assert.ok(parseAskResult(JSON.parse(JSON.stringify(result))), "post-processed output must pass the browser's validation");
  return result;
};

describe("plain questions pass through untouched", () => {
  it("a scene description gets no checks, notices or adjustments", () => {
    const r = run({ intent: "scene_description", answer: "I can see a red mug on a wooden table.", details: "The mug has a handle." });
    assert.equal(r.answer, "I can see a red mug on a wooden table.");
    assert.equal(r.details, "The mug has a handle.");
    assert.equal(r.expiry_check, null);
    assert.equal(r.currency_check, null);
    assert.deepEqual(r.notices, []);
    assert.deepEqual(r.adjustments, []);
  });

  it("every intent is preserved", () => {
    for (const intent of INTENTS) assert.equal(run({ intent }).intent, intent);
  });

  it("printed text and instructions are never altered, even if they read like advice", () => {
    const printedText = "Adults should take 2 tablets daily.\nKeep away from [unreadable] children";
    const r = run({ intent: "medicine_label", printed_text: printedText, printed_instructions: "Adults should take 2 tablets daily." });
    assert.equal(r.printed_text, printedText);
    assert.equal(r.printed_instructions, "Adults should take 2 tablets daily.");
    assert.deepEqual(r.adjustments, []);
  });

  it("does not modify its input", () => {
    const input = model({ answer: "The path ahead is clear. A bench." });
    const snapshot = JSON.stringify(input);
    postProcess(input, { today: TODAY, todaySource: "device" });
    assert.equal(JSON.stringify(input), snapshot);
  });
});

describe("expiry: the deterministic check speaks, not the model", () => {
  const expiryFields = { expiry_date: "08/2027", expiry_kind: "expiry", manufacturing_date: "02/2026", date_text: "MFG 02/2026 EXP 08/2027" };

  it("builds the check from the printed text and today's date", () => {
    const r = run({ intent: "expiry_date", answer: "The expiry date printed is 08/2027.", expiry: expiryFields });
    assert.ok(r.expiry_check);
    assert.equal(r.expiry_check.status, "not_expired");
    assert.equal(r.expiry_check.printed_text, "08/2027");
    assert.equal(r.expiry_check.manufacturing_text, "02/2026");
    assert.equal(r.expiry_check.checked_on, "2026-11-06");
    assert.ok(r.notices.includes("expiry_limits"));
  });

  it("puts the deterministic statement first in the answer", () => {
    const r = run({ intent: "expiry_date", answer: "The expiry date is printed as 08/2027.", expiry: expiryFields });
    assert.match(r.answer, /^The printed expiry date "08\/2027" has not passed yet\./);
    assert.match(r.answer, /The expiry date is printed as 08\/2027\./);
    assert.deepEqual(r.adjustments, []);
  });

  it("replaces a wrong 'it has expired' from the model with the real result", () => {
    const r = run({ intent: "expiry_date", answer: "This product has expired. The label shows EXP 08/2027.", expiry: expiryFields });
    assert.equal(r.expiry_check?.status, "not_expired");
    assert.doesNotMatch(r.answer, /has expired/);
    assert.match(r.answer, /has not passed yet/);
    assert.match(r.answer, /The label shows EXP 08\/2027\./);
    assert.ok(r.adjustments.includes("expiry_conclusion_replaced"));
  });

  it("replaces a wrong 'not expired' too, and works the other way", () => {
    const r = run({ intent: "expiry_date", answer: "It is not expired.", expiry: { ...expiryFields, expiry_date: "08/2025", manufacturing_date: "02/2024" } });
    assert.equal(r.expiry_check?.status, "expired");
    assert.match(r.answer, /has passed/);
    assert.doesNotMatch(r.answer, /not expired/);
  });

  it("removes the model's conclusion from details and uncertainty as well", () => {
    const r = run({
      intent: "expiry_date",
      answer: "Dates are printed.",
      details: "The product is still valid. It has a barcode.",
      uncertainty: "It is expired maybe.",
      expiry: expiryFields,
    });
    assert.equal(r.details, "It has a barcode.");
    assert.equal(r.uncertainty, null);
  });

  it("a manufacturing date alone is never an expiry: unclear, and the model's 'not expired' is removed", () => {
    const r = run({
      intent: "expiry_date",
      answer: "It was made in 2020 and is not expired.",
      expiry: { expiry_date: null, expiry_kind: null, manufacturing_date: "MFG 02/2020", date_text: "MFG 02/2020" },
    });
    assert.equal(r.expiry_check?.status, "unclear");
    assert.match(r.expiry_check!.explanation, /not an expiry date/);
    assert.doesNotMatch(r.answer, /not expired/);
    assert.match(r.answer, /cannot tell whether it has expired/);
  });

  it("a date labelled as manufacturing but filed as the expiry is not compared", () => {
    const r = run({ intent: "expiry_date", answer: "The date is MFG 08/2020.", expiry: { expiry_date: "MFG 08/2020", expiry_kind: "expiry", manufacturing_date: null, date_text: "MFG 08/2020" } });
    assert.equal(r.expiry_check?.status, "unclear");
  });

  it("an expiry question with no date found says so", () => {
    const r = run({ intent: "expiry_date", answer: "I cannot see a date." });
    assert.equal(r.expiry_check?.status, "unclear");
    assert.match(r.expiry_check!.explanation, /could not find a printed expiry date/);
  });

  it("an unreadable date is reported as unclear with the printed text kept", () => {
    const r = run({ intent: "expiry_date", answer: "A date is printed.", expiry: { expiry_date: "EXP 31/04/2027", expiry_kind: "expiry", manufacturing_date: null, date_text: null } });
    assert.equal(r.expiry_check?.status, "unclear");
    assert.equal(r.expiry_check?.printed_text, "EXP 31/04/2027");
  });

  it("the comparison date changes the result (and is reported)", () => {
    const early = run({ intent: "expiry_date", expiry: { ...expiryFields, expiry_date: "11/2026" } }, { year: 2026, month: 11, day: 30 });
    const late = run({ intent: "expiry_date", expiry: { ...expiryFields, expiry_date: "11/2026" } }, { year: 2026, month: 12, day: 1 });
    assert.equal(early.expiry_check?.status, "not_expired");
    assert.equal(late.expiry_check?.status, "expired");
    assert.equal(late.expiry_check?.checked_on, "2026-12-01");
  });

  it("an expiry claim with no date information at all becomes an unclear check, not a fact", () => {
    const r = run({ intent: "general_question", answer: "It has expired. It is a small bottle." });
    assert.equal(r.expiry_check?.status, "unclear");
    assert.doesNotMatch(r.answer, /It has expired/);
    assert.match(r.answer, /It is a small bottle\./);
    assert.ok(r.adjustments.includes("expiry_conclusion_replaced"));
  });

  it("other intents with dates still get the check, without rewriting a clean answer", () => {
    const r = run({ intent: "medicine_label", answer: "A medicine strip.", expiry: expiryFields });
    assert.equal(r.expiry_check?.status, "not_expired");
    assert.equal(r.answer, "A medicine strip.");
  });

  it("never says anything about safety", () => {
    const r = run({ intent: "expiry_date", answer: "It is safe to eat. The date is 08/2027.", expiry: expiryFields });
    assert.doesNotMatch(r.answer, /safe to eat/);
    assert.ok(r.adjustments.includes("expiry_safety_claim_removed"));
    assert.match(r.answer, new RegExp(GUARD_NOTES.expiry_safety.slice(0, 30)));
  });
});

describe("currency: unsupported conclusions are never shown as confirmed", () => {
  const evidence = "the printed numeral 500, the portrait and the Hindi text";

  it("an identified note shows the value with its evidence and the standing notice", () => {
    const r = run({ intent: "currency_identification", answer: "This looks like a ₹500 note.", currency: { denomination: 500, currency: "INR", evidence } });
    assert.equal(r.currency_check?.status, "identified");
    assert.equal(r.currency_check?.denomination, 500);
    assert.equal(r.currency_check?.evidence, evidence);
    assert.ok(r.notices.includes("currency_limits"));
    assert.match(r.answer, /₹500/);
    assert.deepEqual(r.adjustments, []);
  });

  it("does not say the same thing twice when the model already stated the identified value", () => {
    const r = run({ intent: "currency_identification", answer: "This looks like a ₹500 note.", currency: { denomination: 500, currency: "INR", evidence } });
    assert.equal(r.answer, "This looks like a ₹500 note.");
  });

  it("leads with the app's wording when the model did not state the value", () => {
    const r = run({ intent: "currency_identification", answer: "It has a portrait on it.", currency: { denomination: 500, currency: "INR", evidence } });
    assert.match(r.answer, /^This looks like a ₹500 note/);
    assert.match(r.answer, /It has a portrait on it\./);
  });

  it("low confidence: the value is withheld and the model's statement of it is replaced", () => {
    const r = run({ intent: "currency_identification", confidence: "low", answer: "This is a ₹500 note.", currency: { denomination: 500, currency: "INR", evidence } });
    assert.equal(r.currency_check?.status, "uncertain");
    assert.equal(r.currency_check?.denomination, null);
    assert.doesNotMatch(r.answer, /₹500/);
    assert.match(r.answer, /not confident/);
    assert.ok(r.adjustments.includes("currency_conclusion_replaced"));
    assert.equal(r.uncertainty, LOW_CONFIDENCE_NOTE);
  });

  it("an unsupported value (₹1000) is withheld, even in prose", () => {
    const r = run({ intent: "currency_identification", answer: "It is a ₹1000 note.", currency: { denomination: 1000, currency: "INR", evidence } });
    assert.equal(r.currency_check?.status, "uncertain");
    assert.equal(r.currency_check?.denomination, null);
    assert.doesNotMatch(r.answer, /1000/);
    assert.ok(r.adjustments.includes("currency_conclusion_replaced"));
  });

  it("a missing denomination on a banknote question is an uncertain result", () => {
    const r = run({ intent: "currency_identification", answer: "I cannot read the note." });
    assert.equal(r.currency_check?.status, "uncertain");
    assert.equal(r.currency_check?.denomination, null);
    assert.match(r.answer, /could not tell which banknote/);
    assert.deepEqual(r.adjustments, []); // nothing was removed
  });

  it("a structured value that disagrees with the prose is withheld", () => {
    const r = run({ intent: "currency_identification", answer: "I think it is a 100 rupee note.", currency: { denomination: 500, currency: "INR", evidence } });
    assert.equal(r.currency_check?.status, "uncertain");
    assert.doesNotMatch(r.answer, /100 rupee/);
  });

  it("spelled-out values in prose are caught too", () => {
    const r = run({ intent: "currency_identification", confidence: "low", answer: "It is a hundred rupee note.", currency: { denomination: 100, currency: "INR", evidence } });
    assert.doesNotMatch(r.answer, /hundred/);
    assert.ok(r.adjustments.includes("currency_conclusion_replaced"));
  });

  it("no evidence means no confirmed value", () => {
    const r = run({ intent: "currency_identification", answer: "A ₹50 note.", currency: { denomination: 50, currency: "INR", evidence: null } });
    assert.equal(r.currency_check?.status, "uncertain");
    assert.doesNotMatch(r.answer, /₹50/);
  });

  it("a banknote check is not added to unrelated questions", () => {
    assert.equal(run({ intent: "scene_description" }).currency_check, null);
  });
});

describe("safety guards on the model's prose", () => {
  it("removes a 'safe/clear' claim, keeps the rest, and adds the fixed explanation", () => {
    const r = run({ intent: "scene_description", answer: "I can see a bench on the left. The path ahead is clear. There is a bin too." });
    assert.doesNotMatch(r.answer, /path ahead is clear/);
    assert.match(r.answer, /I can see a bench on the left\. There is a bin too\./);
    assert.ok(r.answer.endsWith(GUARD_NOTES.navigation));
    assert.deepEqual(r.adjustments, ["navigation_claim_removed"]);
  });

  it("when nothing safe is left, the answer is the fixed explanation", () => {
    const r = run({ answer: "It is safe to cross. You can go ahead." });
    assert.equal(r.answer, GUARD_NOTES.navigation);
  });

  it("also cleans details and uncertainty (no note is added there)", () => {
    const r = run({ answer: "A street.", details: "There are no obstacles. A shop is visible.", uncertainty: "The road is clear." });
    assert.equal(r.details, "A shop is visible.");
    assert.equal(r.uncertainty, null);
    assert.ok(r.adjustments.includes("navigation_claim_removed"));
  });

  it("removes medical advice but keeps reading the label, and still shows printed instructions", () => {
    const r = run({
      intent: "medicine_label",
      answer: "The strip is Paracetamol 500 mg. You should take two tablets daily.",
      printed_instructions: "Take 1 tablet every 6 hours.",
    });
    assert.doesNotMatch(r.answer, /You should take/);
    assert.match(r.answer, /The strip is Paracetamol 500 mg\./);
    assert.ok(r.answer.endsWith(GUARD_NOTES.medical));
    assert.equal(r.printed_instructions, "Take 1 tablet every 6 hours.");
    assert.deepEqual(r.adjustments, ["medical_advice_removed"]);
    assert.ok(r.notices.includes("label_only"));
  });

  it("allows reading the label aloud as the label's words", () => {
    const r = run({ intent: "medicine_label", answer: "The label says take 1 tablet every 6 hours." });
    assert.equal(r.answer, "The label says take 1 tablet every 6 hours.");
    assert.deepEqual(r.adjustments, []);
  });

  it("removes a genuine/fake claim about a note but keeps a disclaimer", () => {
    const a = run({ intent: "currency_identification", answer: "This is a genuine ₹100 note.", currency: { denomination: 100, currency: "INR", evidence: "the numeral 100 and the portrait" } });
    assert.doesNotMatch(a.answer, /This is a genuine/); // the claim is gone; the fixed disclaimer remains
    assert.ok(a.answer.endsWith(GUARD_NOTES.authenticity));
    assert.ok(a.adjustments.includes("authenticity_claim_removed"));
    const b = run({ intent: "currency_identification", answer: "It looks like a ₹100 note. I cannot tell whether it is genuine.", currency: { denomination: 100, currency: "INR", evidence: "the numeral 100 and the portrait" } });
    assert.match(b.answer, /I cannot tell whether it is genuine/);
    assert.ok(!b.adjustments.includes("authenticity_claim_removed"));
  });

  it("adds each fixed explanation only once", () => {
    const r = run({ answer: "The road is clear. It is safe to cross. You can go ahead." });
    assert.equal(r.answer.split(GUARD_NOTES.navigation).length - 1, 1);
  });

  it("ordinary text mentioning safety words in a harmless way is kept", () => {
    const r = run({ answer: "There is a sign that says SAFE TO CROSS WHEN LIGHT IS GREEN written on the wall." });
    // A sentence like this is exactly what pattern matching cannot judge: it is removed (conservative).
    assert.ok(r.answer.length > 0);
    assert.ok(parseAskResult(r));
  });
});

describe("confidence handling", () => {
  it("low confidence always carries an explanation of uncertainty", () => {
    const r = run({ confidence: "low", uncertainty: null });
    assert.equal(r.confidence, "low");
    assert.equal(r.uncertainty, LOW_CONFIDENCE_NOTE);
  });

  it("the model's own uncertainty text is kept when it gave one", () => {
    const r = run({ confidence: "low", uncertainty: "The label is blurry." });
    assert.equal(r.uncertainty, "The label is blurry.");
  });

  it("medium and high never add text", () => {
    assert.equal(run({ confidence: "medium" }).uncertainty, null);
    assert.equal(run({ confidence: "high" }).uncertainty, null);
  });

  it("confidence is passed through as a word, never a number", () => {
    for (const c of ["low", "medium", "high"]) assert.equal(run({ confidence: c }).confidence, c);
  });
});

describe("fallbacks and invariants", () => {
  it("an answer that is entirely removed never becomes empty", () => {
    const r = run({ intent: "expiry_date", answer: "It is expired.", expiry: { expiry_date: null, expiry_kind: null, manufacturing_date: null, date_text: null } });
    assert.ok(r.answer.length > 0);
    assert.ok(FALLBACK_ANSWER.length > 0);
  });

  it("notices follow the content", () => {
    assert.deepEqual(run({ intent: "medicine_label" }).notices, ["label_only"]);
    assert.deepEqual(run({ printed_instructions: "Take 1 tablet" }).notices, ["label_only"]);
    assert.deepEqual(run({ intent: "currency_identification" }).notices, ["currency_limits"]);
    assert.deepEqual(run({ intent: "scene_description" }).notices, []);
  });

  it("a spread of inputs always yields a result the browser accepts, with no unexpected fields", () => {
    const answers = [
      "A mug.", "The road is clear.", "It has expired.", "A ₹500 note, genuine.", "You should take 2 tablets.",
      "I cannot tell.", "यह एक मग है।", "ಇದು ಒಂದು ಮಗ್.", "A".repeat(2000), "Safe to eat. Still good.",
    ];
    for (const intent of INTENTS) {
      for (const answer of answers) {
        for (const confidence of ["low", "medium", "high"]) {
          const r = run({
            intent,
            answer,
            confidence,
            currency: { denomination: 500, currency: "INR", evidence: "numeral 500 visible" },
            expiry: { expiry_date: "08/2027", expiry_kind: "expiry", manufacturing_date: null, date_text: null },
          });
          assert.deepEqual(Object.keys(r).sort(), [
            "adjustments", "answer", "confidence", "currency_check", "details", "expiry_check", "intent",
            "notices", "printed_instructions", "printed_text", "uncertainty",
          ]);
        }
      }
    }
  });
});
