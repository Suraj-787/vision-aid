import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  detectAnswerLanguage,
  dominantScript,
  scriptCounts,
  segmentByLanguage,
} from "./script.ts";
import { DEFAULT_LANG, isSupportedLang, langInfo, SUPPORTED_LANGS } from "./types.ts";

// Simple sample sentences written for these tests (not reviewed by a native speaker).
const HI = "यह एक सफेद डिब्बा है।";
const HI2 = "मुझे तारीख साफ़ दिखाई नहीं दे रही।";
const KN = "ಇದು ಒಂದು ಬಿಳಿ ಪೆಟ್ಟಿಗೆ.";
const KN2 = "ದಿನಾಂಕ ಸ್ಪಷ್ಟವಾಗಿ ಕಾಣುತ್ತಿಲ್ಲ.";
const EN = "I can see a white box.";

describe("supported languages", () => {
  it("are exactly English (India), Hindi and Kannada", () => {
    assert.deepEqual(SUPPORTED_LANGS.map((l) => l.code), ["en-IN", "hi-IN", "kn-IN"]);
    assert.equal(DEFAULT_LANG, "en-IN");
  });

  it("isSupportedLang accepts only those codes, exactly", () => {
    for (const code of ["en-IN", "hi-IN", "kn-IN"]) assert.equal(isSupportedLang(code), true, code);
    for (const bad of ["en", "hi", "kn", "en-US", "en-in", "EN-IN", "hi_IN", "ta-IN", "fr-FR", "", " en-IN", "en-IN ", "en-IN;x", null, undefined, 5, {}, ["en-IN"], true]) {
      assert.equal(isSupportedLang(bad), false, JSON.stringify(bad));
    }
  });

  it("each language has native name, script and an HTML lang code", () => {
    assert.equal(langInfo("hi-IN").nativeName, "हिन्दी");
    assert.equal(langInfo("kn-IN").nativeName, "ಕನ್ನಡ");
    assert.equal(langInfo("hi-IN").htmlLang, "hi");
    assert.equal(langInfo("kn-IN").scriptName, "Kannada");
    assert.equal(langInfo("en-IN").htmlLang, "en");
    for (const l of SUPPORTED_LANGS) assert.ok(l.label.includes(l.englishName), l.code);
  });
});

describe("script detection", () => {
  it("counts letters by script and ignores digits and punctuation", () => {
    assert.deepEqual(scriptCounts("EXP 08/2027!"), { latin: 3, devanagari: 0, kannada: 0 });
    assert.deepEqual(scriptCounts("०८/२०२७ ।"), { latin: 0, devanagari: 0, kannada: 0 }); // Devanagari digits + danda
    assert.deepEqual(scriptCounts("೦೮ ೨೦೨೭"), { latin: 0, devanagari: 0, kannada: 0 }); // Kannada digits
    assert.equal(scriptCounts(HI).devanagari > 10, true);
    assert.equal(scriptCounts(KN).kannada > 10, true);
  });

  it("finds the dominant script", () => {
    assert.equal(dominantScript(EN).script, "latin");
    assert.equal(dominantScript(HI).script, "devanagari");
    assert.equal(dominantScript(KN).script, "kannada");
    assert.deepEqual(dominantScript("08/2027 ..."), { script: null, mixed: false });
    assert.deepEqual(dominantScript(""), { script: null, mixed: false });
  });

  it("marks text with a substantial second script as mixed", () => {
    assert.equal(dominantScript(HI).mixed, false);
    assert.equal(dominantScript("यह Paracetamol 500 mg की गोली है").mixed, true);
    assert.equal(dominantScript("The label on the front of the box clearly says क्रोसिन and nothing else").mixed, false); // one short word is under 20%
    assert.equal(dominantScript("This says पैरासिटामोल").mixed, true); // but a long word in a short sentence is not
  });

  it("detects the answer's language", () => {
    assert.equal(detectAnswerLanguage(EN), "en-IN");
    assert.equal(detectAnswerLanguage(HI), "hi-IN");
    assert.equal(detectAnswerLanguage(KN), "kn-IN");
    assert.equal(detectAnswerLanguage("1234 ..."), null);
    assert.equal(detectAnswerLanguage(`${EN} ${HI} ${HI2}`), "hi-IN"); // majority of letters
  });
});

describe("segmentByLanguage", () => {
  it("returns one segment for single-language text", () => {
    assert.deepEqual(segmentByLanguage(EN), [{ text: EN, lang: "en-IN", mixed: false }]);
    assert.deepEqual(segmentByLanguage(`${HI} ${HI2}`).map((s) => s.lang), ["hi-IN"]);
    assert.equal(segmentByLanguage(`${HI} ${HI2}`)[0].text, `${HI} ${HI2}`);
  });

  it("splits an English lead followed by Hindi, then Kannada", () => {
    const segs = segmentByLanguage(`${EN} ${HI} ${HI2} ${KN} ${KN2}`);
    assert.deepEqual(segs.map((s) => s.lang), ["en-IN", "hi-IN", "kn-IN"]);
    assert.equal(segs[0].text, EN);
    assert.equal(segs[1].text, `${HI} ${HI2}`);
    assert.equal(segs[2].text, `${KN} ${KN2}`);
  });

  it("keeps order when languages alternate", () => {
    const segs = segmentByLanguage(`${HI} ${EN} ${HI2}`);
    assert.deepEqual(segs.map((s) => s.lang), ["hi-IN", "en-IN", "hi-IN"]);
  });

  it("splits Hindi sentences on the danda", () => {
    assert.deepEqual(segmentByLanguage("यह पहला है। यह दूसरा है।").map((s) => s.text), ["यह पहला है। यह दूसरा है।"]);
    // sentence boundaries still work for language changes
    assert.equal(segmentByLanguage("यह पहला है। It is second.").length, 2);
  });

  it("attaches a sentence with no letters to its neighbour instead of speaking it alone", () => {
    const segs = segmentByLanguage(`${HI} 08/2027.`);
    assert.equal(segs.length, 1);
    assert.equal(segs[0].lang, "hi-IN");
    assert.ok(segs[0].text.endsWith("08/2027."));
    const lead = segmentByLanguage(`08/2027. ${KN}`);
    assert.equal(lead.length, 1);
    assert.equal(lead[0].lang, "kn-IN");
    assert.ok(lead[0].text.startsWith("08/2027."));
  });

  it("handles empty and letterless text", () => {
    assert.deepEqual(segmentByLanguage(""), []);
    assert.deepEqual(segmentByLanguage("   "), []);
    assert.deepEqual(segmentByLanguage("12345"), [{ text: "12345", lang: "en-IN", mixed: false }]);
  });

  it("flags mixed-script sentences", () => {
    const segs = segmentByLanguage("यह Paracetamol 500 mg की गोली है");
    assert.equal(segs[0].mixed, true);
  });
});
