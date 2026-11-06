import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CONFIDENCES, INTENTS } from "./ask-result.ts";
import { EXPIRY_KINDS } from "./expiry.ts";
import { MODEL_LIMITS, parseModelOutput, parseModelText } from "./model-output.ts";

const base = () => ({
  intent: "scene_description",
  answer: "A red mug on a table.",
  details: null,
  uncertainty: null,
  confidence: "medium",
  printed_text: null,
  printed_instructions: null,
  currency: { denomination: null, currency: null, evidence: null },
  expiry: { expiry_date: null, expiry_kind: null, manufacturing_date: null, date_text: null },
});
const make = (patch: Record<string, unknown>) => ({ ...base(), ...patch });
const without = (key: string) => {
  const o: Record<string, unknown> = base();
  delete o[key];
  return o;
};

describe("intent validation", () => {
  it("accepts every supported intent", () => {
    for (const intent of INTENTS) {
      const out = parseModelOutput(make({ intent }));
      assert.ok(out, intent);
      assert.equal(out.intent, intent);
    }
    assert.equal(INTENTS.length, 7);
    assert.deepEqual([...INTENTS], [
      "scene_description", "text_reading", "medicine_label", "currency_identification",
      "expiry_date", "general_question", "unknown",
    ]);
  });

  it("accepts the fallback intents for unknown and ambiguous questions", () => {
    assert.equal(parseModelOutput(make({ intent: "unknown" }))?.intent, "unknown");
    assert.equal(parseModelOutput(make({ intent: "general_question" }))?.intent, "general_question");
  });

  it("rejects an invalid intent value (never coerced or invented)", () => {
    for (const intent of ["banana", "SCENE_DESCRIPTION", "scene description", "scene_description ", "", "navigation", "safety_check", "currency", "expiry"]) {
      assert.equal(parseModelOutput(make({ intent })), null, JSON.stringify(intent));
    }
  });

  it("rejects a missing or wrongly typed intent", () => {
    assert.equal(parseModelOutput(without("intent")), null);
    for (const intent of [null, undefined, 3, true, ["unknown"], { v: "unknown" }]) {
      assert.equal(parseModelOutput(make({ intent })), null, JSON.stringify(intent));
    }
  });
});

describe("confidence validation", () => {
  it("accepts low, medium and high only", () => {
    for (const confidence of CONFIDENCES) assert.equal(parseModelOutput(make({ confidence }))?.confidence, confidence);
    assert.deepEqual([...CONFIDENCES], ["low", "medium", "high"]);
  });

  it("rejects numbers, percentages, other words and missing values", () => {
    for (const confidence of ["certain", "very high", "HIGH", "85%", "0.9", 0.9, 1, 85, null, undefined, true, ["high"]]) {
      assert.equal(parseModelOutput(make({ confidence })), null, JSON.stringify(confidence));
    }
    assert.equal(parseModelOutput(without("confidence")), null);
  });
});

describe("response validation: valid output", () => {
  it("accepts a valid structured response with null optional fields", () => {
    const out = parseModelOutput(base());
    assert.ok(out);
    assert.equal(out.details, null);
    assert.equal(out.uncertainty, null);
    assert.equal(out.printed_text, null);
    assert.equal(out.printed_instructions, null);
    assert.deepEqual(out.currency, { denomination: null, currency: null, evidence: null });
    assert.deepEqual(out.expiry, { expiry_date: null, expiry_kind: null, manufacturing_date: null, date_text: null });
  });

  it("accepts a fully populated response", () => {
    const out = parseModelOutput(
      make({
        intent: "expiry_date",
        details: "d",
        uncertainty: "u",
        printed_text: "EXP 08/2027\nMFG 02/2026",
        printed_instructions: "Take 1 tablet",
        currency: { denomination: 500, currency: "INR", evidence: "numeral 500" },
        expiry: { expiry_date: "08/2027", expiry_kind: "expiry", manufacturing_date: "02/2026", date_text: "MFG 02/2026 EXP 08/2027" },
      }),
    );
    assert.ok(out);
    assert.equal(out.printed_text, "EXP 08/2027\nMFG 02/2026");
    assert.equal(out.currency.denomination, 500);
    assert.equal(out.expiry.expiry_kind, "expiry");
  });

  it("trims strings, turns blank optional strings into null, and keeps non-Latin text", () => {
    const out = parseModelOutput(make({ answer: "  Hi  ", details: "   ", printed_text: " ಇದು\nयह ", uncertainty: "\n" }));
    assert.ok(out);
    assert.equal(out.answer, "Hi");
    assert.equal(out.details, null);
    assert.equal(out.uncertainty, null);
    assert.equal(out.printed_text, "ಇದು\nयह");
  });

  it("treats a null currency or expiry object as all-null", () => {
    const out = parseModelOutput(make({ currency: null, expiry: null }));
    assert.ok(out);
    assert.equal(out.currency.denomination, null);
    assert.equal(out.expiry.expiry_date, null);
  });

  it("passes any numeric denomination through for the currency check to judge", () => {
    for (const denomination of [10, 500, 1000, 2000, 5, 0, -10, 10.5]) {
      const out = parseModelOutput(make({ currency: { denomination, currency: "INR", evidence: "x" } }));
      assert.equal(out?.currency.denomination, denomination, String(denomination));
    }
  });
});

describe("response validation: required fields", () => {
  it("rejects a missing top-level field", () => {
    for (const key of Object.keys(base())) {
      assert.equal(parseModelOutput(without(key)), null, `missing ${key}`);
    }
  });

  it("rejects missing nested fields", () => {
    for (const key of ["denomination", "currency", "evidence"]) {
      const o = base();
      delete (o.currency as Record<string, unknown>)[key];
      assert.equal(parseModelOutput(o), null, `currency.${key}`);
    }
    for (const key of ["expiry_date", "expiry_kind", "manufacturing_date", "date_text"]) {
      const o = base();
      delete (o.expiry as Record<string, unknown>)[key];
      assert.equal(parseModelOutput(o), null, `expiry.${key}`);
    }
  });

  it("rejects a missing, empty, blank or non-string answer", () => {
    for (const answer of [undefined, "", "   ", null, 5, ["a"], {}]) {
      assert.equal(parseModelOutput(make({ answer })), null, JSON.stringify(answer));
    }
  });

  it("rejects wrong types in optional text fields", () => {
    for (const key of ["details", "uncertainty", "printed_text", "printed_instructions"]) {
      for (const v of [5, true, ["a"], { t: 1 }]) assert.equal(parseModelOutput(make({ [key]: v })), null, `${key}=${JSON.stringify(v)}`);
    }
  });

  it("rejects wrong types in nested fields", () => {
    assert.equal(parseModelOutput(make({ currency: { denomination: "500", currency: "INR", evidence: "x" } })), null);
    assert.equal(parseModelOutput(make({ currency: { denomination: true, currency: null, evidence: null } })), null);
    assert.equal(parseModelOutput(make({ currency: { denomination: null, currency: 5, evidence: null } })), null);
    assert.equal(parseModelOutput(make({ expiry: { expiry_date: 2027, expiry_kind: null, manufacturing_date: null, date_text: null } })), null);
    assert.equal(parseModelOutput(make({ currency: "INR" })), null);
    assert.equal(parseModelOutput(make({ expiry: ["08/2027"] })), null);
  });

  it("rejects an invalid expiry kind", () => {
    for (const kind of ["mfg", "EXP", "expired", "best before", "", 1, true]) {
      assert.equal(parseModelOutput(make({ expiry: { expiry_date: "08/2027", expiry_kind: kind, manufacturing_date: null, date_text: null } })), null, JSON.stringify(kind));
    }
    for (const kind of [...EXPIRY_KINDS, null]) {
      assert.ok(parseModelOutput(make({ expiry: { expiry_date: "08/2027", expiry_kind: kind, manufacturing_date: null, date_text: null } })), String(kind));
    }
  });
});

describe("response validation: unexpected fields", () => {
  it("drops unknown top-level and nested fields so they can never reach the UI", () => {
    const out = parseModelOutput({
      ...base(),
      system_prompt: "leak",
      script: "<script>alert(1)</script>",
      currency: { denomination: null, currency: null, evidence: null, authentic: true },
      expiry: { expiry_date: null, expiry_kind: null, manufacturing_date: null, date_text: null, safe_to_use: true },
    });
    assert.ok(out);
    assert.deepEqual(Object.keys(out).sort(), Object.keys(base()).sort());
    assert.deepEqual(Object.keys(out.currency), ["denomination", "currency", "evidence"]);
    assert.deepEqual(Object.keys(out.expiry), ["expiry_date", "expiry_kind", "manufacturing_date", "date_text"]);
    assert.ok(!JSON.stringify(out).includes("leak"));
  });
});

describe("response validation: field length limits", () => {
  const at = (n: number) => "a".repeat(n);

  it("accepts a value exactly at the limit and rejects one over, for every field", () => {
    const cases: Array<[string, (v: string) => Record<string, unknown>, number]> = [
      ["answer", (v) => make({ answer: v }), MODEL_LIMITS.answer],
      ["details", (v) => make({ details: v }), MODEL_LIMITS.details],
      ["uncertainty", (v) => make({ uncertainty: v }), MODEL_LIMITS.uncertainty],
      ["printed_text", (v) => make({ printed_text: v }), MODEL_LIMITS.printed_text],
      ["printed_instructions", (v) => make({ printed_instructions: v }), MODEL_LIMITS.printed_instructions],
      ["currency.evidence", (v) => make({ currency: { denomination: null, currency: null, evidence: v } }), MODEL_LIMITS.currency_evidence],
      ["currency.currency", (v) => make({ currency: { denomination: null, currency: v, evidence: null } }), MODEL_LIMITS.currency_code],
      ["expiry.expiry_date", (v) => make({ expiry: { expiry_date: v, expiry_kind: null, manufacturing_date: null, date_text: null } }), MODEL_LIMITS.date],
      ["expiry.manufacturing_date", (v) => make({ expiry: { expiry_date: null, expiry_kind: null, manufacturing_date: v, date_text: null } }), MODEL_LIMITS.date],
      ["expiry.date_text", (v) => make({ expiry: { expiry_date: null, expiry_kind: null, manufacturing_date: null, date_text: v } }), MODEL_LIMITS.date_text],
    ];
    for (const [name, build, limit] of cases) {
      assert.ok(parseModelOutput(build(at(limit))), `${name} at limit`);
      assert.equal(parseModelOutput(build(at(limit + 1))), null, `${name} over limit`);
    }
  });
});

describe("parseModelText: malformed model output", () => {
  it("reports empty output", () => {
    for (const t of [undefined, null, "", "   \n"]) assert.deepEqual(parseModelText(t), { ok: false, reason: "empty" });
  });

  it("reports non-JSON output, including fenced and truncated JSON", () => {
    assert.deepEqual(parseModelText("Sure! It is a mug."), { ok: false, reason: "not_json" });
    assert.deepEqual(parseModelText("```json\n" + JSON.stringify(base()) + "\n```"), { ok: false, reason: "not_json" });
    assert.deepEqual(parseModelText(JSON.stringify(base()).slice(0, 80)), { ok: false, reason: "not_json" });
    assert.deepEqual(parseModelText("{'answer': 'single quotes'}"), { ok: false, reason: "not_json" });
  });

  it("reports JSON of the wrong shape", () => {
    for (const t of ["[]", "null", "42", '"text"', "{}", '{"answer":"x"}', '{"text":"hello"}', JSON.stringify({ ...base(), intent: "banana" })]) {
      assert.deepEqual(parseModelText(t), { ok: false, reason: "invalid_shape" }, t);
    }
  });

  it("parses valid JSON text", () => {
    const r = parseModelText(JSON.stringify(base()));
    assert.ok(r.ok);
    assert.equal(r.output.answer, "A red mug on a table.");
  });
});
