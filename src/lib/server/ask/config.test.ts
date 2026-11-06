import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readAskConfig } from "./config.ts";

const KEY = "test-key-0123456789-abcdefghij";

describe("readAskConfig", () => {
  it("reports a missing API key", () => {
    const r = readAskConfig({ GEMINI_MODEL: "some-model" });
    assert.equal(r.ok, false);
    assert.equal(!r.ok && r.code, "API_KEY_NOT_CONFIGURED");
    const blank = readAskConfig({ GEMINI_API_KEY: "   ", GEMINI_MODEL: "some-model" });
    assert.equal(!blank.ok && blank.code, "API_KEY_NOT_CONFIGURED");
  });

  it("reports a missing model and does NOT fall back to any default model", () => {
    const r = readAskConfig({ GEMINI_API_KEY: KEY });
    assert.equal(r.ok, false);
    assert.equal(!r.ok && r.code, "MODEL_NOT_CONFIGURED");
    assert.equal(readAskConfig({ GEMINI_API_KEY: KEY, GEMINI_MODEL: "  " }).ok, false);
  });

  it("never uses the Live Mode model or flag as the Tap-to-Ask model", () => {
    const r = readAskConfig({ GEMINI_API_KEY: KEY, GEMINI_LIVE_MODEL: "gemini-3.8-live", ENABLE_LIVE_MODE: "true" });
    assert.equal(!r.ok && r.code, "MODEL_NOT_CONFIGURED");
  });

  it("rejects a malformed key or model ID", () => {
    assert.equal(readAskConfig({ GEMINI_API_KEY: '"quoted-key-0123456789abcd"', GEMINI_MODEL: "m" }).ok, false);
    assert.equal(readAskConfig({ GEMINI_API_KEY: "short", GEMINI_MODEL: "m" }).ok, false);
    for (const model of ["has space", "models/x", "a/b", "x;rm", "-leading", "a".repeat(101), "<b>"]) {
      const r = readAskConfig({ GEMINI_API_KEY: KEY, GEMINI_MODEL: model });
      assert.equal(!r.ok && r.code, "SERVER_NOT_CONFIGURED", model);
    }
  });

  it("accepts a configured key and model, trimming whitespace", () => {
    const r = readAskConfig({ GEMINI_API_KEY: ` ${KEY}\n`, GEMINI_MODEL: " my-model.v1_2 " });
    assert.ok(r.ok);
    assert.equal(r.apiKey, KEY);
    assert.equal(r.model, "my-model.v1_2");
  });

  it("parses ALLOWED_ORIGINS in every case", () => {
    const r = readAskConfig({ ALLOWED_ORIGINS: "https://A.example, ,https://b.example" });
    assert.deepEqual(r.allowedOrigins, ["https://a.example", "https://b.example"]);
  });

  it("the log detail names variables but never values", () => {
    const r = readAskConfig({ GEMINI_API_KEY: KEY });
    assert.ok(!r.ok);
    assert.match(r.problem, /GEMINI_MODEL/);
    assert.ok(!r.problem.includes(KEY));
    const bad = readAskConfig({ GEMINI_API_KEY: '"' + KEY + '"', GEMINI_MODEL: "m" });
    assert.ok(!bad.ok && !bad.problem.includes(KEY));
  });
});
