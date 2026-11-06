import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AskResult } from "../ask/ask-result.ts";
import { checkCurrency } from "../ask/currency.ts";
import { checkExpiry, expiryHeadline } from "../ask/expiry.ts";
import { planPlayback } from "./plan.ts";
import { buildSpokenSegments, chunkForSpeech, cleanForSpeech, MAX_CHUNK_CHARS, spokenParts } from "./spoken-text.ts";
import type { VoiceLike } from "./voices.ts";

const HI = "यह एक सफेद डिब्बा है।";
const KN = "ಇದು ಒಂದು ಬಿಳಿ ಪೆಟ್ಟಿಗೆ.";
const TODAY = { year: 2026, month: 11, day: 6 };

const result = (over: Partial<AskResult> = {}): AskResult => ({
  intent: "scene_description",
  answer: "I can see a white box on a table.",
  details: "SECRET-DETAILS about the table.",
  uncertainty: null,
  confidence: "high",
  printed_text: "PRINTED-TEXT-MARKER",
  printed_instructions: "PRINTED-INSTRUCTIONS-MARKER",
  currency_check: null,
  expiry_check: null,
  notices: ["label_only", "expiry_limits", "currency_limits"],
  adjustments: ["navigation_claim_removed"],
  ...over,
});
const spoken = (r: AskResult) => spokenParts(r).join(" | ");
const expiry = (text: string | null, kind: "expiry" | "best_before" = "expiry") =>
  checkExpiry({ expiryText: text, expiryKind: text ? kind : null, manufacturingText: null, dateText: null }, TODAY, "device");

describe("what is spoken", () => {
  it("is the answer, built from validated fields only", () => {
    assert.deepEqual(spokenParts(result()), ["I can see a white box on a table."]);
  });

  it("never includes intent, confidence, notices, adjustments, details or printed text", () => {
    const text = spoken(result({ intent: "medicine_label", confidence: "low", uncertainty: null }));
    for (const forbidden of ["medicine_label", "scene_description", "low", "high", "label_only", "navigation_claim_removed", "SECRET-DETAILS", "PRINTED-TEXT-MARKER", "PRINTED-INSTRUCTIONS-MARKER", "Confidence", "Understood as", "Ask another"]) {
      assert.ok(!text.includes(forbidden), forbidden);
    }
  });

  it("includes what is unclear", () => {
    assert.deepEqual(spokenParts(result({ uncertainty: "The label is blurry." })), ["I can see a white box on a table.", "The label is blurry."]);
  });

  it("does not repeat a sentence the answer already contains", () => {
    assert.deepEqual(spokenParts(result({ answer: "The label is blurry. A white box.", uncertainty: "The label is blurry." })), ["The label is blurry. A white box."]);
  });

  it("empty, blank or control-character-only answers produce nothing to say", () => {
    for (const answer of ["", "   ", "\n\t", "​\u0007"]) {
      assert.deepEqual(spokenParts(result({ answer })), [], JSON.stringify(answer));
      assert.deepEqual(buildSpokenSegments(result({ answer })), []);
    }
  });

  it("a result with missing optional parts is spoken without gaps", () => {
    assert.deepEqual(spokenParts(result({ uncertainty: null, expiry_check: null, currency_check: null })), ["I can see a white box on a table."]);
  });

  it("cleans whitespace and control characters", () => {
    assert.equal(cleanForSpeech("  a \n\n b\t c ​ "), "a b c");
    assert.equal(cleanForSpeech("a\u0007b"), "ab");
  });
});

describe("expiry in speech", () => {
  it("is spoken when the answer left the status out", () => {
    const check = expiry("08/2027");
    const parts = spokenParts(result({ intent: "medicine_label", answer: "A medicine strip.", expiry_check: check }));
    assert.equal(parts.length, 2);
    assert.equal(parts[1], check.explanation);
    assert.match(parts[1], /has not passed yet/);
  });

  it("is not repeated when the answer already states the status", () => {
    const check = expiry("08/2025");
    const answer = `${expiryHeadline(check)} The label also lists a batch number.`;
    assert.deepEqual(spokenParts(result({ intent: "expiry_date", answer, expiry_check: check })), [answer]);
  });

  it("an unclear result always has its reason spoken", () => {
    const check = expiry(null);
    const answer = expiryHeadline(check);
    const parts = spokenParts(result({ intent: "expiry_date", answer, expiry_check: check }));
    assert.equal(parts.length, 2);
    assert.match(parts[1], /could not find a printed expiry date/);
  });

  it("never says anything about safety", () => {
    for (const c of [expiry("08/2027"), expiry("08/2025"), expiry(null)]) {
      assert.doesNotMatch(spoken(result({ expiry_check: c })), /\bsafe\b/i);
    }
  });
});

describe("currency in speech", () => {
  const evidence = "the printed numeral 500 and the portrait";
  const identified = (answer: string) =>
    result({
      intent: "currency_identification",
      answer,
      currency_check: checkCurrency({ denomination: 500, currency: "INR", evidence }, { confidence: "high", asksAboutCurrency: true, answerText: answer }),
    });

  it("an identified note already named in the answer is not repeated, but the limit reminder is spoken", () => {
    const parts = spokenParts(identified("This looks like a ₹500 note."));
    assert.equal(parts[0], "This looks like a ₹500 note.");
    assert.equal(parts.length, 2);
    assert.match(parts[1], /cannot tell whether a note is genuine or counterfeit/);
  });

  it("an identified note the answer did not name is stated", () => {
    const parts = spokenParts(identified("It has a portrait on it."));
    assert.match(parts[1], /looks like a ₹500 note/);
  });

  it("an uncertain note speaks the retake tip once, with no value", () => {
    const uncertain = result({
      intent: "currency_identification",
      answer: "I cannot read it.",
      currency_check: checkCurrency({ denomination: null, currency: null, evidence: null }, { confidence: "low", asksAboutCurrency: true, answerText: "" }),
    });
    const parts = spokenParts(uncertain);
    assert.match(parts[1], /could not tell which banknote/);
    assert.doesNotMatch(spoken(uncertain), /₹\d/);
    assert.ok(!spoken(uncertain).includes("genuine")); // the reminder is only for identified notes
  });
});

describe("language segments", () => {
  it("a Hindi answer is one Hindi segment", () => {
    assert.deepEqual(buildSpokenSegments(result({ answer: HI })).map((s) => s.lang), ["hi-IN"]);
  });

  it("the app's English statements are separated from a Hindi or Kannada answer", () => {
    const check = expiry("08/2027");
    const segs = buildSpokenSegments(result({ intent: "medicine_label", answer: HI, expiry_check: check }));
    assert.deepEqual(segs.map((s) => s.lang), ["hi-IN", "en-IN"]);
    assert.equal(segs[1].text, check.explanation);
    const kn = buildSpokenSegments(result({ answer: `${expiryHeadline(check)} ${KN}`, expiry_check: check }));
    assert.deepEqual(kn.map((s) => s.lang), ["en-IN", "kn-IN"]);
  });

  it("merges neighbouring parts that share a language", () => {
    const segs = buildSpokenSegments(result({ answer: "One.", uncertainty: "Two." }));
    assert.equal(segs.length, 1);
    assert.equal(segs[0].text, "One. Two.");
  });
});

describe("chunking for speech", () => {
  it("keeps short text as one chunk", () => {
    assert.deepEqual(chunkForSpeech("One. Two. Three."), ["One. Two. Three."]);
  });

  it("splits at sentence boundaries under the limit", () => {
    const sentence = "This is a sentence of moderate length that fills space nicely.";
    const chunks = chunkForSpeech(Array(8).fill(sentence).join(" "));
    assert.ok(chunks.length > 1);
    for (const c of chunks) assert.ok(c.length <= MAX_CHUNK_CHARS, `${c.length}`);
    assert.equal(chunks.join(" "), Array(8).fill(sentence).join(" "));
  });

  it("splits a single very long sentence on commas and spaces, losing nothing", () => {
    const long = Array.from({ length: 120 }, (_, i) => `word${i}`).join(" ") + ".";
    const chunks = chunkForSpeech(long);
    assert.ok(chunks.length > 2);
    for (const c of chunks) assert.ok(c.length <= MAX_CHUNK_CHARS);
    assert.equal(chunks.join(" "), long);
  });

  it("chunks Hindi and Kannada text too", () => {
    const hindi = Array(30).fill(HI).join(" ");
    const chunks = chunkForSpeech(hindi);
    assert.ok(chunks.length > 1);
    for (const c of chunks) assert.ok(c.length <= MAX_CHUNK_CHARS);
    assert.equal(chunks.join(" "), hindi);
  });

  it("handles empty text", () => {
    assert.deepEqual(chunkForSpeech(""), []);
  });
});

describe("planPlayback", () => {
  const v = (name: string, lang: string, localService = true): VoiceLike => ({ name, lang, localService, default: false });
  const segs = (r: AskResult) => buildSpokenSegments(r);

  it("plans chunks with the matching voice per language", () => {
    const check = expiry("08/2027");
    const plan = planPlayback(segs(result({ intent: "medicine_label", answer: HI, expiry_check: check })), [v("Lekha", "hi-IN"), v("Veena", "en-IN")]);
    assert.deepEqual(plan.chunks.map((c) => [c.voice.name, c.lang]), [["Lekha", "hi-IN"], ["Veena", "en-IN"]]);
    assert.deepEqual(plan.skipped, []);
    assert.deepEqual(plan.notes, []);
  });

  it("a language with no voice is skipped and the user is told; other languages still play", () => {
    const check = expiry("08/2027");
    const plan = planPlayback(segs(result({ intent: "medicine_label", answer: HI, expiry_check: check })), [v("Samantha", "en-US")]);
    assert.deepEqual(plan.chunks.map((c) => c.voice.name), ["Samantha"]); // English only
    assert.equal(plan.skipped.length, 1);
    assert.equal(plan.skipped[0].lang, "hi-IN");
    assert.ok(plan.notes.some((n) => /No Hindi voice is installed/.test(n) && /not read aloud/.test(n)));
  });

  it("never reads Hindi or Kannada with an English voice", () => {
    for (const answer of [HI, KN]) {
      const plan = planPlayback(segs(result({ answer })), [v("Samantha", "en-US"), v("Veena", "en-IN")]);
      assert.equal(plan.chunks.length, 0);
      assert.equal(plan.skipped.length, 1);
    }
  });

  it("no voices at all: nothing to play", () => {
    assert.equal(planPlayback(segs(result()), []).chunks.length, 0);
  });

  it("notes a same-language fallback voice and an online voice", () => {
    const plan = planPlayback(segs(result()), [v("Samantha", "en-US", false)]);
    assert.equal(plan.chunks.length, 1);
    assert.ok(plan.notes.some((n) => /Using the voice "Samantha" \(en-US\) for English/.test(n)));
    assert.ok(plan.notes.some((n) => /may use an online service/.test(n)));
  });

  it("does not warn about online voices when the voice is local", () => {
    assert.deepEqual(planPlayback(segs(result()), [v("Veena", "en-IN", true)]).notes, []);
  });

  it("warns about mixed-script text", () => {
    const plan = planPlayback([{ text: "यह Paracetamol 500 mg की गोली है", lang: "hi-IN", mixed: true }], [v("Lekha", "hi-IN")]);
    assert.ok(plan.notes.some((n) => /another script/.test(n)));
    assert.equal(plan.chunks.length, 1);
  });

  it("never reports the same note twice", () => {
    const long = Array(30).fill("Sentence number one is here.").join(" ");
    const plan = planPlayback(segs(result({ answer: long })), [v("Samantha", "en-US", false)]);
    assert.ok(plan.chunks.length > 1);
    assert.equal(plan.notes.length, 2);
  });
});
