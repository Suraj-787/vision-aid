import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { describeVoiceSupport, normalizeLangTag, pickVoice, type VoiceLike } from "./voices.ts";

const v = (name: string, lang: string, localService = true, isDefault = false): VoiceLike => ({
  name,
  lang,
  localService,
  default: isDefault,
});

describe("normalizeLangTag", () => {
  it("lowercases and fixes underscores", () => {
    assert.equal(normalizeLangTag("hi_IN"), "hi-in");
    assert.equal(normalizeLangTag(" EN-in "), "en-in");
  });
});

describe("pickVoice", () => {
  it("finds an exact language and region match", () => {
    const voices = [v("A", "en-US"), v("B", "hi-IN"), v("C", "kn-IN")];
    assert.equal(pickVoice(voices, "hi-IN").voice?.name, "B");
    assert.equal(pickVoice(voices, "hi-IN").kind, "exact");
    assert.equal(pickVoice(voices, "kn-IN").voice?.name, "C");
  });

  it("matches Android-style tags (underscore, three-letter codes)", () => {
    assert.equal(pickVoice([v("X", "hi_IN")], "hi-IN").kind, "exact");
    assert.equal(pickVoice([v("X", "hin-IND-x-hid-local")], "hi-IN").kind, "exact");
    assert.equal(pickVoice([v("X", "kan-IND")], "kn-IN").kind, "exact");
    assert.equal(pickVoice([v("X", "eng-IND")], "en-IN").kind, "exact");
  });

  it("accepts another English region as a same-language fallback, and says so", () => {
    const m = pickVoice([v("US", "en-US"), v("GB", "en-GB")], "en-IN");
    assert.equal(m.kind, "same-language");
    assert.ok(m.voice);
  });

  it("prefers an exact match over a same-language one", () => {
    assert.equal(pickVoice([v("US", "en-US", true, true), v("IN", "en-IN", false)], "en-IN").voice?.name, "IN");
  });

  it("NEVER falls back to a voice for a different language", () => {
    const englishOnly = [v("US", "en-US"), v("GB", "en-GB")];
    assert.deepEqual(pickVoice(englishOnly, "hi-IN"), { kind: "none", voice: null });
    assert.deepEqual(pickVoice(englishOnly, "kn-IN"), { kind: "none", voice: null });
    assert.deepEqual(pickVoice([v("HI", "hi-IN")], "kn-IN"), { kind: "none", voice: null });
    assert.deepEqual(pickVoice([v("HI", "hi-IN")], "en-IN"), { kind: "none", voice: null });
    assert.deepEqual(pickVoice([], "en-IN"), { kind: "none", voice: null });
  });

  it("a bare language code with no region is a same-language match", () => {
    assert.equal(pickVoice([v("Plain", "hi")], "hi-IN").kind, "same-language");
  });

  it("prefers local voices (no online service), then the default voice, then name order", () => {
    const voices = [v("Z-online", "hi-IN", false, true), v("B-local", "hi-IN", true), v("A-local-default", "hi-IN", true, true)];
    assert.equal(pickVoice(voices, "hi-IN").voice?.name, "A-local-default");
    assert.equal(pickVoice([v("Z-online", "hi-IN", false, true), v("B-local", "hi-IN", true)], "hi-IN").voice?.name, "B-local");
    assert.equal(pickVoice([v("B", "hi-IN"), v("A", "hi-IN")], "hi-IN").voice?.name, "A");
  });

  it("does not mutate the voice list", () => {
    const voices = [v("B", "hi-IN"), v("A", "hi-IN")];
    pickVoice(voices, "hi-IN");
    assert.deepEqual(voices.map((x) => x.name), ["B", "A"]);
  });
});

describe("describeVoiceSupport (what the user is told)", () => {
  const settled = { synthesisSupported: true, settled: true };

  it("unsupported browser", () => {
    const s = describeVoiceSupport("hi-IN", [], { synthesisSupported: false, settled: true });
    assert.equal(s.level, "unsupported");
    assert.match(s.message, /not available in this browser/);
    assert.match(s.message, /shown as text/);
  });

  it("still looking for voices, then none found", () => {
    assert.equal(describeVoiceSupport("en-IN", [], { synthesisSupported: true, settled: false }).level, "checking");
    const none = describeVoiceSupport("hi-IN", [], settled);
    assert.equal(none.level, "missing");
    assert.match(none.message, /No voices were found/);
  });

  it("a matching voice is available", () => {
    const s = describeVoiceSupport("hi-IN", [v("Lekha", "hi-IN")], settled);
    assert.equal(s.level, "available");
    assert.match(s.message, /A Hindi voice is available \(Lekha\)/);
  });

  it("a voice for another region is reported as a fallback", () => {
    const s = describeVoiceSupport("en-IN", [v("Samantha", "en-US")], settled);
    assert.equal(s.level, "fallback");
    assert.match(s.message, /another region/);
    assert.match(s.message, /Samantha, en-US/);
  });

  it("a missing language says so clearly, without switching language", () => {
    for (const [lang, name] of [["hi-IN", "Hindi"], ["kn-IN", "Kannada"]] as const) {
      const s = describeVoiceSupport(lang, [v("Samantha", "en-US")], settled);
      assert.equal(s.level, "missing", lang);
      assert.match(s.message, new RegExp(`No ${name} voice is installed on this device`));
      assert.match(s.message, /shown as text/);
      assert.match(s.message, /speech or language settings/);
      assert.doesNotMatch(s.message, /English voice will be used/i);
    }
  });
});
