import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createPrefsStore,
  DEFAULT_PREFS,
  effectiveAutoRead,
  effectiveVoiceAsk,
  isVoiceGuided,
  loadPrefs,
  parsePrefs,
  PREFS_STORAGE_KEY,
  savePrefs,
  serializePrefs,
  type StorageLike,
} from "./preferences.ts";

const memory = (initial: Record<string, string> = {}): StorageLike & { data: Record<string, string> } => {
  const data = { ...initial };
  return { data, getItem: (k) => data[k] ?? null, setItem: (k, v) => void (data[k] = v) };
};

describe("defaults", () => {
  it("screen-reader-first, nothing automatic, no commands", () => {
    assert.deepEqual(DEFAULT_PREFS, { mode: "screen-reader", autoReadAnswers: false, voiceCommands: false, voiceAsk: false });
    assert.equal(isVoiceGuided(DEFAULT_PREFS), false);
    assert.equal(effectiveAutoRead(DEFAULT_PREFS), false);
  });
});

describe("parsePrefs is strict", () => {
  it("accepts exactly the allowed values", () => {
    assert.deepEqual(parsePrefs({ mode: "voice-guided", autoReadAnswers: true, voiceCommands: true, voiceAsk: true }), {
      mode: "voice-guided",
      autoReadAnswers: true,
      voiceCommands: true,
      voiceAsk: true,
    });
  });
  it("falls back per field for anything else, and ignores unknown fields", () => {
    for (const bad of [null, undefined, 5, "x", [], { mode: "other", autoReadAnswers: "yes", voiceCommands: 1, extra: "y" }]) {
      assert.deepEqual(parsePrefs(bad), DEFAULT_PREFS, JSON.stringify(bad));
    }
    assert.deepEqual(Object.keys(parsePrefs({ mode: "voice-guided", question: "private" })).sort(), ["autoReadAnswers", "mode", "voiceAsk", "voiceCommands"]);
  });
});

describe("asking by voice is off by default and needs voice commands", () => {
  it("is off by default", () => {
    assert.equal(DEFAULT_PREFS.voiceAsk, false);
    assert.equal(effectiveVoiceAsk(DEFAULT_PREFS), false);
    assert.equal(parsePrefs({ voiceCommands: true }).voiceAsk, false);
  });
  it("only counts as on when the person turned it on AND voice commands are on", () => {
    assert.equal(effectiveVoiceAsk({ ...DEFAULT_PREFS, voiceCommands: true, voiceAsk: true }), true);
    assert.equal(effectiveVoiceAsk({ ...DEFAULT_PREFS, voiceCommands: false, voiceAsk: true }), false);
    assert.equal(effectiveVoiceAsk({ ...DEFAULT_PREFS, voiceCommands: true, voiceAsk: false }), false);
  });
  it("anything other than exactly true is off (a damaged or edited value cannot enable sending)", () => {
    for (const bad of ["true", 1, "yes", null, {}, []]) assert.equal(parsePrefs({ voiceCommands: true, voiceAsk: bad }).voiceAsk, false, JSON.stringify(bad));
  });
});

describe("automatic reading is a voice-guided feature only", () => {
  it("is off in screen-reader mode even when the preference was saved as on", () => {
    assert.equal(effectiveAutoRead({ mode: "screen-reader", autoReadAnswers: true, voiceCommands: false, voiceAsk: false }), false);
    assert.equal(effectiveAutoRead({ mode: "voice-guided", autoReadAnswers: true, voiceCommands: false, voiceAsk: false }), true);
    assert.equal(effectiveAutoRead({ mode: "voice-guided", autoReadAnswers: false, voiceCommands: false, voiceAsk: false }), false);
  });
});

describe("storage", () => {
  it("writes only the three preference fields under one key", () => {
    const s = memory();
    assert.equal(savePrefs(s, { mode: "voice-guided", autoReadAnswers: true, voiceCommands: false, voiceAsk: false }), true);
    assert.deepEqual(Object.keys(s.data), [PREFS_STORAGE_KEY]);
    assert.deepEqual(JSON.parse(s.data[PREFS_STORAGE_KEY]), { mode: "voice-guided", autoReadAnswers: true, voiceCommands: false, voiceAsk: false });
    assert.equal(serializePrefs({ ...DEFAULT_PREFS, mode: "voice-guided", ...( { question: "secret" } as object) } as never).includes("secret"), false);
  });

  it("loads defaults when storage is empty, corrupt, blocked or absent", () => {
    assert.deepEqual(loadPrefs(memory()), DEFAULT_PREFS);
    assert.deepEqual(loadPrefs(memory({ [PREFS_STORAGE_KEY]: "{not json" })), DEFAULT_PREFS);
    assert.deepEqual(loadPrefs(null), DEFAULT_PREFS);
    const blocked: StorageLike = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
    assert.deepEqual(loadPrefs(blocked), DEFAULT_PREFS);
    assert.equal(savePrefs(blocked, DEFAULT_PREFS), false);
    assert.equal(savePrefs(null, DEFAULT_PREFS), false);
  });

  it("loads what was saved", () => {
    const s = memory();
    savePrefs(s, { mode: "voice-guided", autoReadAnswers: false, voiceCommands: true, voiceAsk: false });
    assert.deepEqual(loadPrefs(s), { mode: "voice-guided", autoReadAnswers: false, voiceCommands: true, voiceAsk: false });
  });
});

describe("createPrefsStore", () => {
  it("writes nothing until a preference is changed", () => {
    const s = memory();
    const store = createPrefsStore(s);
    assert.deepEqual(store.getSnapshot(), DEFAULT_PREFS);
    assert.deepEqual(s.data, {});
  });

  it("updates, persists and notifies subscribers; the snapshot is stable between changes", () => {
    const s = memory();
    const store = createPrefsStore(s);
    let calls = 0;
    const off = store.subscribe(() => calls++);
    const before = store.getSnapshot();
    assert.equal(store.getSnapshot(), before);
    store.update({ mode: "voice-guided" });
    assert.equal(calls, 1);
    assert.equal(store.getSnapshot().mode, "voice-guided");
    assert.notEqual(store.getSnapshot(), before);
    assert.equal(JSON.parse(s.data[PREFS_STORAGE_KEY]).mode, "voice-guided");
    off();
    store.update({ voiceCommands: true, voiceAsk: false });
    assert.equal(calls, 1);
  });

  it("works (in memory) when storage is unavailable", () => {
    const store = createPrefsStore(null);
    store.update({ mode: "voice-guided" });
    assert.equal(store.getSnapshot().mode, "voice-guided");
  });

  it("rejects invalid values passed to update", () => {
    const store = createPrefsStore(memory());
    store.update({ mode: "nonsense" as never });
    assert.equal(store.getSnapshot().mode, "screen-reader");
  });
});
