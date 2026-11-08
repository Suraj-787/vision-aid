import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import * as askRoute from "../../app/api/ask/route.ts";
import { isLiveModeEnabled, looksLikeApiKey } from "./env.ts";
import { DEFAULT_GEMINI_TIMEOUT_MS } from "./ask/gemini.ts";
import { readAskConfig } from "./ask/config.ts";

const KEY = "test-key-0123456789-abcdefghij";
const pkg = JSON.parse(readFileSync(new URL("../../../package.json", import.meta.url), "utf8")) as {
  engines?: { node?: string };
  dependencies?: Record<string, string>;
};

describe("production deployment settings (Milestone 11)", () => {
  it("the ask route declares a maximum duration above the Gemini timeout and within every plan's limit", () => {
    const seconds = askRoute.maxDuration;
    assert.equal(typeof seconds, "number");
    assert.ok(seconds * 1000 > DEFAULT_GEMINI_TIMEOUT_MS + 10_000, "must leave room after the Gemini timeout");
    assert.ok(seconds <= 60, "stay within the smallest documented plan limit");
  });

  it("the Node version is pinned to the one the app is tested on, so a host default cannot change it silently", () => {
    assert.equal(pkg.engines?.node, "22.x");
    assert.ok(Number(process.versions.node.split(".")[0]) >= 22, "tests need Node 22.6 or newer");
  });

  it("no client-exposed variable carries a secret (nothing starts with NEXT_PUBLIC_)", () => {
    const sources = ["../../../.env.example", "../../../next.config.ts"].map((p) => readFileSync(new URL(p, import.meta.url), "utf8"));
    for (const text of sources) assert.doesNotMatch(text.replace(/^\s*#.*$/gm, ""), /NEXT_PUBLIC_[A-Z_]*(KEY|SECRET|TOKEN)/);
  });
});

describe("values pasted into a host's environment-variable form", () => {
  it("a trailing newline, CRLF or surrounding spaces are tolerated", () => {
    for (const suffix of ["\n", "\r\n", "  ", "\t"]) {
      const r = readAskConfig({ GEMINI_API_KEY: `${KEY}${suffix}`, GEMINI_MODEL: `my-model${suffix}` });
      assert.ok(r.ok, JSON.stringify(suffix));
    }
  });

  it("quotes, a pasted NAME= prefix and an empty value are reported as configuration problems, never used", () => {
    assert.equal(readAskConfig({ GEMINI_API_KEY: `"${KEY}"`, GEMINI_MODEL: "m" }).ok, false);
    assert.equal(readAskConfig({ GEMINI_API_KEY: `'${KEY}'`, GEMINI_MODEL: "m" }).ok, false);
    assert.equal(readAskConfig({ GEMINI_API_KEY: `GEMINI_API_KEY=${KEY}`, GEMINI_MODEL: "m" }).ok, false);
    assert.equal(readAskConfig({ GEMINI_API_KEY: "", GEMINI_MODEL: "m" }).ok, false);
    assert.equal(readAskConfig({ GEMINI_API_KEY: KEY, GEMINI_MODEL: "" }).ok, false);
    assert.equal(looksLikeApiKey(`${KEY} extra`), false);
  });

  it("the diagnostic for a bad configuration names variables, never their values", () => {
    const r = readAskConfig({ GEMINI_API_KEY: `"${KEY}"`, GEMINI_MODEL: "m" });
    assert.ok(!r.ok);
    assert.ok(!r.problem.includes(KEY));
  });

  it("the model must be set explicitly: there is no default model on any host", () => {
    const r = readAskConfig({ GEMINI_API_KEY: KEY });
    assert.ok(!r.ok && r.code === "MODEL_NOT_CONFIGURED");
  });
});

/** Builds the minimal environment the flag reads (the full ProcessEnv type has required framework fields). */
const flag = (value: string | undefined) => ({ ENABLE_LIVE_MODE: value }) as unknown as NodeJS.ProcessEnv;

describe("Live Mode stays off unless explicitly enabled", () => {
  it("unset, empty and every non-true value leave it disabled", () => {
    for (const value of [undefined, "", " ", "false", "FALSE", "0", "1", "yes", "on", "enabled", "truee", "tru", "true!"]) {
      assert.equal(isLiveModeEnabled(flag(value)), false, JSON.stringify(value));
    }
  });
  it("only the word true enables it (case and surrounding spaces are ignored, as the code documents)", () => {
    for (const value of ["true", "TRUE", " true ", "true\n"]) assert.equal(isLiveModeEnabled(flag(value)), true, JSON.stringify(value));
  });
  it("the Tap-to-Ask configuration does not depend on the flag", () => {
    assert.equal(readAskConfig({ GEMINI_API_KEY: KEY, GEMINI_MODEL: "m", ENABLE_LIVE_MODE: "false" }).ok, true);
    assert.equal(readAskConfig({ GEMINI_API_KEY: KEY, GEMINI_MODEL: "m", ENABLE_LIVE_MODE: "true" }).ok, true);
  });
});
