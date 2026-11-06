import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  claimsAuthenticity,
  claimsProductSafety,
  givesMedicalAdvice,
  GUARD_NOTES,
  makesNavigationClaim,
  sanitizeProse,
  splitSentences,
  statesExpiryConclusion,
} from "./safety.ts";

const flagged = (fn: (s: string) => boolean, sentences: string[]) => {
  for (const s of sentences) assert.equal(fn(s), true, `should be flagged: ${s}`);
};
const allowed = (fn: (s: string) => boolean, sentences: string[]) => {
  for (const s of sentences) assert.equal(fn(s), false, `should be allowed: ${s}`);
};

describe("splitSentences", () => {
  it("splits on sentence ends and line breaks", () => {
    assert.deepEqual(splitSentences("One. Two! Three?\nFour"), ["One.", "Two!", "Three?", "Four"]);
    assert.deepEqual(splitSentences("  "), []);
    assert.deepEqual(splitSentences("यह एक है। वह दो है।"), ["यह एक है।", "वह दो है।"]);
  });
});

describe("navigation / mobility claims", () => {
  it("flags claims that a place is safe or clear", () => {
    flagged(makesNavigationClaim, [
      "It is safe to cross the road.",
      "You can safely walk forward.",
      "The path ahead is clear.",
      "The road appears clear.",
      "The crossing looks completely safe.",
      "The stairs are free of obstacles.",
      "The way ahead seems clear.",
      "There are no obstacles in front of you.",
    ]);
    flagged(makesNavigationClaim, [
      "You can go ahead.",
      "All clear.",
      "It's okay to step forward.",
      "Nothing in your way.",
      "No visible vehicles are coming.",
      "All obstacles have been detected.",
      "Every hazard is visible in the photo.",
      "The footpath is empty and safe.",
    ]);
  });

  it("allows ordinary scene descriptions", () => {
    allowed(makesNavigationClaim, [
      "I can see a red mug on a wooden table.",
      "There is a door on the left, and it appears to be open.",
      "The photo shows a street with a shop sign.",
      "A person is standing near the desk.",
      "The staircase has a metal railing.",
      "The floor is covered with a patterned rug.",
      "I can see a crossing sign.",
    ]);
  });

  it("allows refusals and disclaimers", () => {
    allowed(makesNavigationClaim, [
      "I cannot tell whether it is safe to cross.",
      "I can't say the path is clear.",
      "VisionAid does not detect all obstacles.",
      "I am unable to confirm that the road is safe.",
      "It is not possible to know the crossing is clear from a photo.",
      "The path is not clear: there is a box in the way.",
    ]);
  });
});

describe("medical advice, dosing and interpretation", () => {
  it("flags advice, dose recommendations and suitability judgements", () => {
    flagged(givesMedicalAdvice, [
      "You should take two tablets every day.",
      "I recommend taking this medicine after meals.",
      "This medicine is safe for children.",
      "This tablet is suitable for you.",
      "You can take this medicine with food.",
      "Take 2 tablets twice a day.",
      "This medication is used to treat fever.",
      "This medicine helps with headaches.",
      "A doctor would prescribe this medicine for infections.",
      "You must not take more than 4 capsules.",
      "The dosage is appropriate for adults and I advise it.",
    ]);
  });

  it("flags direct advice even when the label is mentioned", () => {
    flagged(givesMedicalAdvice, [
      "As the label says, you should take 2 tablets daily.",
      "The box says tablets, and you can take them with water.",
    ]);
  });

  it("allows reading what is printed, framed as the label's words", () => {
    allowed(givesMedicalAdvice, [
      "The label says take 1 tablet every 6 hours.",
      "The box reads Paracetamol 500 mg.",
      "Printed on the strip: Each tablet contains 500 mg.",
      "The package states that the dose is one tablet daily.",
      "I can see a white box with blue text.",
      "The medicine name printed on the front is Crocin.",
    ]);
  });

  it("allows refusals", () => {
    allowed(givesMedicalAdvice, [
      "I cannot say how many tablets you should take.",
      "I can't recommend a dose.",
      "Please ask a pharmacist or doctor about the dosage.",
      "I do not give medical advice about this medicine.",
    ]);
  });
});

describe("banknote authenticity", () => {
  it("flags claims that a note is genuine or fake", () => {
    flagged(claimsAuthenticity, [
      "This is a genuine note.",
      "The note looks authentic.",
      "It appears to be a counterfeit.",
      "This is a fake 500 rupee note.",
      "The note is not fake.",
      "This is a real note.",
      "It is a legitimate banknote.",
      "The security thread proves it is authentic.",
    ]);
  });

  it("allows disclaimers", () => {
    allowed(claimsAuthenticity, [
      "I cannot tell whether the note is genuine or counterfeit.",
      "VisionAid does not check if a note is fake.",
      "I can't verify authenticity from a photo.",
      "I am unable to say if it is genuine.",
      "It is not possible to detect counterfeit notes here.",
      "The note shows the numeral 500 and a portrait.",
    ]);
  });
});

describe("product safety after an expiry check", () => {
  it("flags claims that a product is safe or still good", () => {
    flagged(claimsProductSafety, [
      "It is safe to eat.",
      "This is fine to use.",
      "The product is still good.",
      "It is okay to consume.",
      "It won't harm you.",
      "Still fresh, so you can eat it.",
    ]);
  });

  it("a refusal that mentions harm is still a refusal", () => {
    allowed(claimsProductSafety, ["I cannot say it won't harm you."]);
  });

  it("allows reporting dates and disclaimers", () => {
    allowed(claimsProductSafety, [
      "The expiry date printed is 08/2027.",
      "I cannot say whether it is safe to eat.",
      "I can only report the printed dates.",
      "The box looks new.",
    ]);
  });
});

describe("statesExpiryConclusion", () => {
  it("detects sentences that decide whether something has expired", () => {
    flagged(statesExpiryConclusion, [
      "This product has expired.",
      "It is not expired yet.",
      "The medicine is expired.",
      "It hasn't expired.",
      "It is out of date.",
      "It is still valid.",
      "It is past its expiry date.",
      "The date is in date.",
    ]);
  });

  it("allows reporting the printed date without deciding", () => {
    allowed(statesExpiryConclusion, [
      "The expiry date is printed as 08/2027.",
      "I can see EXP 15 MAR 2027 on the lid.",
      "It expires in August 2027.",
      "There is also a manufacturing date.",
    ]);
  });
});

describe("sanitizeProse", () => {
  it("removes only the offending sentences and reports why", () => {
    const r = sanitizeProse("I can see a bench on the left. The path ahead is clear. There is a bin too.");
    assert.equal(r.text, "I can see a bench on the left. There is a bin too.");
    assert.deepEqual(r.triggered, ["navigation"]);
    assert.equal(r.dropped, false);
  });

  it("returns null when nothing is left", () => {
    const r = sanitizeProse("It is safe to cross. You can go ahead.");
    assert.equal(r.text, null);
    assert.deepEqual(r.triggered, ["navigation"]);
  });

  it("reports every guard that fired", () => {
    const r = sanitizeProse("It is a genuine note. You should take two tablets. It is safe to eat. The road is clear.");
    assert.equal(r.text, null);
    assert.deepEqual([...r.triggered].sort(), ["authenticity", "expiry_safety", "medical", "navigation"]);
  });

  it("leaves clean text untouched and handles null and empty input", () => {
    assert.deepEqual(sanitizeProse("A red mug."), { text: "A red mug.", triggered: [], dropped: false });
    assert.deepEqual(sanitizeProse(null), { text: null, triggered: [], dropped: false });
    assert.deepEqual(sanitizeProse(""), { text: null, triggered: [], dropped: false });
  });

  it("applies a caller's extra rule and reports that it dropped something", () => {
    const r = sanitizeProse("It has expired. The date is 08/2025.", statesExpiryConclusion);
    assert.equal(r.text, "The date is 08/2025.");
    assert.equal(r.dropped, true);
    assert.deepEqual(r.triggered, []);
  });

  it("the fixed notes themselves pass every guard", () => {
    for (const note of Object.values(GUARD_NOTES)) {
      assert.equal(sanitizeProse(note).text, note);
    }
  });
});
