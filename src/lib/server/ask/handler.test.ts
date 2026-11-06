import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ApiError } from "@google/genai";
import { MAX_IMAGE_BYTES, MAX_QUESTION_LENGTH } from "@/lib/ask/ask-api";
import { parseAskResult } from "@/lib/ask/ask-result";
import { SlidingWindowLimiter } from "@/lib/server/rate-limit";
import { readAskConfig, type AskConfig } from "./config.ts";
import type { GeminiClient, GeminiInput, GeminiOutput } from "./gemini.ts";
import { handleAsk, type AskDeps } from "./handler.ts";
import { askRequest, makeJpeg, modelOutput, PNG_BYTES, toBase64, VALID_ANSWER, VALID_MODEL_OUTPUT } from "./test-utils.ts";

const API_KEY = "SECRETKEY-0123456789-abcdefghijklmnop";
const QUESTION = "QSECRET what does the medicine box say?";
const IMAGE = toBase64(makeJpeg());
const MODEL_TEXT_MARKER = "MODELSECRET";

const okConfig = (): AskConfig =>
  readAskConfig({ GEMINI_API_KEY: API_KEY, GEMINI_MODEL: "test-model-1" });

interface Harness {
  deps: AskDeps;
  logs: string[];
  calls: GeminiInput[];
  responses: Array<{ status: number; text: string; headers: string }>;
}

function harness(
  generate: (input: GeminiInput) => Promise<GeminiOutput> = async () => ({
    text: JSON.stringify(VALID_MODEL_OUTPUT),
    finishReason: "STOP",
  }),
  overrides: Partial<AskDeps> = {},
): Harness {
  const logs: string[] = [];
  const calls: GeminiInput[] = [];
  const gemini: GeminiClient = {
    generate: async (input) => {
      calls.push(input);
      return generate(input);
    },
  };
  const deps: AskDeps = {
    readConfig: okConfig,
    gemini,
    perClient: new SlidingWindowLimiter(20, 600_000),
    overall: new SlidingWindowLimiter(120, 3_600_000),
    inFlight: new Set(),
    now: (() => {
      let t = 1_000_000;
      return () => (t += 5);
    })(),
    log: (line) => logs.push(line),
    ...overrides,
  };
  return { deps, logs, calls, responses: [] };
}

async function call(h: Harness, request: Request) {
  const res = await handleAsk(request, h.deps);
  const text = await res.text();
  const headers = [...res.headers].map(([k, v]) => `${k}: ${v}`).join("\n");
  h.responses.push({ status: res.status, text, headers });
  let json: Record<string, unknown> | null = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* not JSON */
  }
  return { status: res.status, json, text, headers: res.headers };
}

const valid = () => askRequest({ image: IMAGE, question: QUESTION });
const errorCode = (r: { json: Record<string, unknown> | null }) =>
  (r.json?.error as { code?: string } | undefined)?.code;

describe("successful request", () => {
  it("returns the validated structured answer with 200 and no-store", async () => {
    const h = harness();
    const r = await call(h, valid());
    assert.equal(r.status, 200);
    assert.deepEqual(parseAskResult(r.json), VALID_ANSWER);
    assert.equal(r.headers.get("cache-control"), "no-store");
    assert.equal(r.headers.get("content-type")?.startsWith("application/json"), true);
  });

  it("makes exactly ONE Gemini call with the configured model, image and trimmed question", async () => {
    const h = harness();
    await call(h, askRequest({ image: IMAGE, question: `  ${QUESTION}  ` }));
    assert.equal(h.calls.length, 1);
    assert.equal(h.calls[0].model, "test-model-1");
    assert.equal(h.calls[0].apiKey, API_KEY);
    assert.equal(h.calls[0].imageBase64, IMAGE);
    assert.equal(h.calls[0].question, QUESTION);
  });

  it("strips fields the model was not asked for", async () => {
    const h = harness(async () => ({ text: JSON.stringify({ ...VALID_MODEL_OUTPUT, system: "x", __proto__x: 1 }) }));
    const r = await call(h, valid());
    assert.deepEqual(Object.keys(r.json ?? {}).sort(), Object.keys(VALID_ANSWER).sort());
  });

  it("accepts an image/jpeg data URL", async () => {
    const h = harness();
    const r = await call(h, askRequest({ image: `data:image/jpeg;base64,${IMAGE}`, question: "q" }));
    assert.equal(r.status, 200);
    assert.equal(h.calls[0].imageBase64, IMAGE);
  });
});

describe("configuration errors (no Gemini call is made)", () => {
  it("missing API key -> 500 API_KEY_NOT_CONFIGURED", async () => {
    const h = harness(undefined, { readConfig: () => readAskConfig({ GEMINI_MODEL: "m" }) });
    const r = await call(h, valid());
    assert.equal(r.status, 500);
    assert.equal(errorCode(r), "API_KEY_NOT_CONFIGURED");
    assert.equal(h.calls.length, 0);
  });

  it("missing model ID -> 500 MODEL_NOT_CONFIGURED, with no silent fallback", async () => {
    const h = harness(undefined, { readConfig: () => readAskConfig({ GEMINI_API_KEY: API_KEY }) });
    const r = await call(h, valid());
    assert.equal(r.status, 500);
    assert.equal(errorCode(r), "MODEL_NOT_CONFIGURED");
    assert.match(String((r.json?.error as { message: string }).message), /GEMINI_MODEL/);
    assert.equal(h.calls.length, 0);
  });

  it("invalid configuration -> 500 SERVER_NOT_CONFIGURED", async () => {
    const h = harness(undefined, { readConfig: () => readAskConfig({ GEMINI_API_KEY: API_KEY, GEMINI_MODEL: "bad model!" }) });
    const r = await call(h, valid());
    assert.equal(errorCode(r), "SERVER_NOT_CONFIGURED");
    assert.equal(h.calls.length, 0);
  });

  it("the server log says which variable is missing, but never a value", async () => {
    const h = harness(undefined, { readConfig: () => readAskConfig({ GEMINI_API_KEY: API_KEY }) });
    await call(h, valid());
    assert.ok(h.logs.some((l) => l.includes("GEMINI_MODEL is not set")));
    assert.ok(!h.logs.join("\n").includes(API_KEY));
  });
});

describe("request guards", () => {
  it("cross-origin and missing-origin requests -> 403", async () => {
    const h = harness();
    assert.equal((await call(h, askRequest({ image: IMAGE, question: "q" }, { origin: "https://evil.example" }))).status, 403);
    const none = await call(h, askRequest({ image: IMAGE, question: "q" }, { origin: null }));
    assert.equal(none.status, 403);
    assert.equal(errorCode(none), "FORBIDDEN_ORIGIN");
    assert.equal(h.calls.length, 0);
  });

  it("origin is enforced even when the server is misconfigured", async () => {
    const h = harness(undefined, { readConfig: () => readAskConfig({}) });
    const r = await call(h, askRequest({ image: IMAGE, question: "q" }, { origin: "https://evil.example" }));
    assert.equal(r.status, 403);
  });

  it("wrong content type -> 415", async () => {
    const h = harness();
    for (const contentType of ["text/plain", "multipart/form-data", null]) {
      const r = await call(h, askRequest(JSON.stringify({ image: IMAGE, question: "q" }), { contentType }));
      assert.equal(r.status, 415, String(contentType));
      assert.equal(errorCode(r), "UNSUPPORTED_MEDIA_TYPE");
    }
    assert.equal(h.calls.length, 0);
  });

  it("invalid body cases map to the right status and code", async () => {
    const h = harness();
    const cases: Array<[string, unknown, number, string]> = [
      ["invalid JSON", "{not json", 400, "INVALID_JSON"],
      ["empty body", "", 400, "INVALID_JSON"],
      ["array body", [], 400, "INVALID_REQUEST"],
      ["missing image", { question: "q" }, 400, "MISSING_IMAGE"],
      ["missing question", { image: IMAGE }, 400, "MISSING_QUESTION"],
      ["blank question", { image: IMAGE, question: "   " }, 400, "MISSING_QUESTION"],
      ["question too long", { image: IMAGE, question: "a".repeat(MAX_QUESTION_LENGTH + 1) }, 400, "QUESTION_TOO_LONG"],
      ["bad base64", { image: "%%%not-base64%%%", question: "q" }, 400, "INVALID_IMAGE"],
      ["not a jpeg", { image: toBase64(Buffer.from("plain text, not an image at all")), question: "q" }, 400, "INVALID_IMAGE"],
      ["png", { image: toBase64(PNG_BYTES), question: "q" }, 415, "UNSUPPORTED_IMAGE_FORMAT"],
      ["png data url", { image: `data:image/png;base64,${IMAGE}`, question: "q" }, 415, "UNSUPPORTED_IMAGE_FORMAT"],
      ["image too large", { image: toBase64(makeJpeg({ padding: MAX_IMAGE_BYTES })), question: "q" }, 413, "IMAGE_TOO_LARGE"],
      ["extra field", { image: IMAGE, question: "q", model: "x" }, 400, "INVALID_REQUEST"],
    ];
    for (const [name, body, status, code] of cases) {
      const r = await call(h, askRequest(body as never));
      assert.equal(r.status, status, name);
      assert.equal(errorCode(r), code, name);
    }
    assert.equal(h.calls.length, 0, "no invalid request reached Gemini");
  });

  it("oversized body -> 413 before it is fully read", async () => {
    const h = harness();
    const huge = JSON.stringify({ image: "A".repeat(5 * 1024 * 1024), question: "q" });
    const r = await call(h, askRequest(huge));
    assert.equal(r.status, 413);
    assert.equal(errorCode(r), "PAYLOAD_TOO_LARGE");
    assert.equal(h.calls.length, 0);
  });
});

describe("rate limiting and duplicate prevention", () => {
  it("rejects a second request while one is in flight, then allows it afterwards", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    const h = harness(async () => {
      await gate;
      return { text: JSON.stringify(VALID_MODEL_OUTPUT) };
    });
    const first = call(h, valid());
    await new Promise((r) => setTimeout(r, 10));
    const second = await call(h, valid());
    assert.equal(second.status, 429);
    assert.equal(errorCode(second), "REQUEST_IN_PROGRESS");
    release();
    assert.equal((await first).status, 200);
    assert.equal(h.calls.length, 1, "the duplicate never reached Gemini");
    assert.equal(h.deps.inFlight.size, 0, "in-flight marker cleared");
    assert.equal((await call(h, valid())).status, 200);
  });

  it("clears the in-flight marker even when Gemini fails", async () => {
    const h = harness(async () => {
      throw new Error("boom");
    });
    await call(h, valid());
    assert.equal(h.deps.inFlight.size, 0);
  });

  it("enforces the per-client rate limit with Retry-After and does not call Gemini", async () => {
    const h = harness(undefined, { perClient: new SlidingWindowLimiter(2, 600_000) });
    assert.equal((await call(h, valid())).status, 200);
    assert.equal((await call(h, valid())).status, 200);
    const limited = await call(h, valid());
    assert.equal(limited.status, 429);
    assert.equal(errorCode(limited), "RATE_LIMITED");
    assert.ok(Number(limited.headers.get("retry-after")) > 0);
    assert.equal(h.calls.length, 2);
  });

  it("enforces the overall limit across clients", async () => {
    const h = harness(undefined, { overall: new SlidingWindowLimiter(1, 3_600_000) });
    const a = await call(h, askRequest({ image: IMAGE, question: "q" }, { headers: { "x-forwarded-for": "1.1.1.1" } }));
    const b = await call(h, askRequest({ image: IMAGE, question: "q" }, { headers: { "x-forwarded-for": "2.2.2.2" } }));
    assert.equal(a.status, 200);
    assert.equal(b.status, 429);
  });

  it("invalid requests do not consume rate-limit slots", async () => {
    const h = harness(undefined, { perClient: new SlidingWindowLimiter(1, 600_000) });
    for (let i = 0; i < 5; i++) await call(h, askRequest({ image: IMAGE }));
    assert.equal((await call(h, valid())).status, 200);
  });
});

describe("Gemini failures map to safe errors (and are never retried automatically)", () => {
  const cases: Array<[string, () => Error, number, string]> = [
    ["quota / rate limit", () => new ApiError({ message: "RESOURCE_EXHAUSTED", status: 429 }), 429, "UPSTREAM_QUOTA"],
    ["authentication", () => new ApiError({ message: "unauthorized", status: 401 }), 502, "UPSTREAM_AUTH"],
    ["invalid API key (400)", () => new ApiError({ message: "API key not valid", status: 400 }), 502, "UPSTREAM_AUTH"],
    ["service unavailable", () => new ApiError({ message: "unavailable", status: 503 }), 503, "UPSTREAM_UNAVAILABLE"],
    ["upstream timeout", () => Object.assign(new Error("timed out"), { name: "TimeoutError" }), 504, "UPSTREAM_TIMEOUT"],
    ["unknown model", () => new ApiError({ message: "model not found", status: 404 }), 502, "UPSTREAM_ERROR"],
    ["network failure", () => new TypeError("fetch failed"), 503, "UPSTREAM_UNAVAILABLE"],
    ["unexpected error", () => new Error("kaboom"), 502, "UPSTREAM_ERROR"],
  ];
  for (const [name, make, status, code] of cases) {
    it(`${name} -> ${status} ${code}`, async () => {
      const h = harness(async () => {
        throw make();
      });
      const r = await call(h, valid());
      assert.equal(r.status, status);
      assert.equal(errorCode(r), code);
      assert.equal(h.calls.length, 1, "exactly one attempt: no automatic retry");
    });
  }

  it("quota errors carry Retry-After", async () => {
    const h = harness(async () => {
      throw new ApiError({ message: "RESOURCE_EXHAUSTED", status: 429 });
    });
    assert.equal((await call(h, valid())).headers.get("retry-after"), "60");
  });
});

describe("invalid or unusable model output -> controlled error, never raw content", () => {
  const bad: Array<[string, GeminiOutput]> = [
    ["empty text", { text: "" }],
    ["no text", { text: undefined, finishReason: "STOP" }],
    ["plain prose", { text: `${MODEL_TEXT_MARKER} here is a nice answer` }],
    ["fenced JSON", { text: "```json\n" + JSON.stringify(VALID_MODEL_OUTPUT) + "\n```" }],
    ["truncated JSON", { text: `{"answer": "${MODEL_TEXT_MARKER} cut off` }],
    ["JSON array", { text: "[]" }],
    ["answer missing", { text: JSON.stringify({ ...modelOutput({ details: MODEL_TEXT_MARKER }), answer: undefined }) }],
    ["answer empty", { text: JSON.stringify({ ...VALID_MODEL_OUTPUT, answer: "  " }) }],
    ["wrong field type", { text: JSON.stringify({ ...VALID_MODEL_OUTPUT, details: { x: MODEL_TEXT_MARKER } }) }],
    ["incomplete (fields missing)", { text: JSON.stringify({ answer: `${MODEL_TEXT_MARKER} only an answer` }) }],
    ["answer too long", { text: JSON.stringify({ ...VALID_MODEL_OUTPUT, answer: MODEL_TEXT_MARKER.repeat(500) }) }],
  ];
  for (const [name, output] of bad) {
    it(`${name} -> 502 INVALID_MODEL_RESPONSE`, async () => {
      const h = harness(async () => output);
      const r = await call(h, valid());
      assert.equal(r.status, 502);
      assert.equal(errorCode(r), "INVALID_MODEL_RESPONSE");
      assert.ok(!r.text.includes(MODEL_TEXT_MARKER), "model text is not echoed");
      assert.ok(!h.logs.join("\n").includes(MODEL_TEXT_MARKER), "model text is not logged");
    });
  }

  it("a blocked prompt -> 422 RESPONSE_BLOCKED", async () => {
    const h = harness(async () => ({ text: undefined, blockReason: "IMAGE_SAFETY" }));
    const r = await call(h, valid());
    assert.equal(r.status, 422);
    assert.equal(errorCode(r), "RESPONSE_BLOCKED");
  });

  it("an empty answer cut off by a safety stop -> 422 RESPONSE_BLOCKED", async () => {
    const h = harness(async () => ({ text: "", finishReason: "SAFETY" }));
    assert.equal(errorCode(await call(h, valid())), "RESPONSE_BLOCKED");
  });
});

describe("unexpected internal errors", () => {
  it("an unexpected exception -> 500 INTERNAL_ERROR with no details and no Gemini call", async () => {
    const h = harness(undefined, {
      readConfig: () => {
        throw new Error(`boom ${API_KEY} ${QUESTION}`);
      },
    });
    const r = await call(h, valid());
    assert.equal(r.status, 500);
    assert.equal(errorCode(r), "INTERNAL_ERROR");
    assert.equal(h.calls.length, 0);
    assert.ok(!r.text.includes("boom") && !r.text.includes(API_KEY) && !r.text.includes("QSECRET"));
    assert.ok(!h.logs.join("\n").includes(API_KEY) && !h.logs.join("\n").includes("QSECRET"));
    assert.deepEqual(h.logs, ["[ask] unexpected error: Error"]);
  });

  it("still responds when logging itself fails, and clears the in-flight marker", async () => {
    const h = harness(undefined, {
      log: () => {
        throw new Error("log sink down");
      },
      perClient: {
        take: () => {
          throw new Error("limiter bug");
        },
      },
    });
    const r = await call(h, valid());
    assert.equal(errorCode(r), "INTERNAL_ERROR");
    assert.equal(h.deps.inFlight.size, 0);
  });
});

describe("privacy: no secrets or request content leak into responses or logs", () => {
  it("across success and every failure path", async () => {
    const leaky = (status: number) => async () => {
      // An upstream error whose message embeds everything sensitive.
      throw new ApiError({ message: `bad request key=${API_KEY} question=${QUESTION} image=${IMAGE}`, status });
    };
    const scenarios: Array<[Harness, Request]> = [
      [harness(), valid()],
      [harness(leaky(429)), valid()],
      [harness(leaky(401)), valid()],
      [harness(leaky(503)), valid()],
      [harness(leaky(400)), valid()],
      [harness(async () => ({ text: `${QUESTION} ${API_KEY}` })), valid()],
      [harness(undefined, { readConfig: () => readAskConfig({ GEMINI_API_KEY: API_KEY }) }), valid()],
      [harness(undefined, { readConfig: () => readAskConfig({ GEMINI_API_KEY: `"${API_KEY}"`, GEMINI_MODEL: "m" }) }), valid()],
      [harness(), askRequest({ image: IMAGE, question: QUESTION, extra: 1 })],
      [harness(), askRequest(`{"image":"${IMAGE}","question":"${QUESTION}`)],
      [harness(), askRequest({ image: toBase64(PNG_BYTES), question: QUESTION })],
      [harness(), askRequest({ image: IMAGE, question: QUESTION }, { origin: "https://evil.example" })],
    ];
    for (const [h, req] of scenarios) {
      await call(h, req);
      const everything = [...h.responses.map((r) => r.text + r.headers), ...h.logs].join("\n");
      assert.ok(!everything.includes(API_KEY), "API key leaked");
      assert.ok(!everything.includes("QSECRET"), "question leaked");
      assert.ok(!everything.includes(IMAGE.slice(0, 40)), "image data leaked");
      assert.ok(!/stack|\bat \w+.*\(.*:\d+:\d+\)/i.test(everything), "stack trace leaked");
    }
  });

  it("log lines are short event strings", async () => {
    const h = harness();
    await call(h, valid());
    assert.ok(h.logs.length >= 1);
    for (const line of h.logs) assert.ok(line.length < 120 && line.startsWith("[ask]"), line);
  });
});

describe("Milestone 6: post-processing through the handler", () => {
  const FIXED_NOW = Date.UTC(2026, 10, 6, 12, 0, 0); // 6 November 2026, 12:00 UTC
  const fixedNow = { now: () => FIXED_NOW };
  const expiryModel = (over: Record<string, unknown> = {}) =>
    modelOutput({
      intent: "expiry_date",
      answer: "The expiry date is printed as 08/2027.",
      expiry: { expiry_date: "EXP 08/2027", expiry_kind: "expiry", manufacturing_date: "MFG 02/2026", date_text: "MFG 02/2026 EXP 08/2027" },
      ...over,
    });
  const ask = (h: Harness, body: Record<string, unknown> = {}) =>
    call(h, askRequest({ image: IMAGE, question: "q", ...body }));
  const answerOf = (r: { json: Record<string, unknown> | null }) => {
    const parsed = parseAskResult(r.json);
    assert.ok(parsed, "response must pass the browser's validation");
    return parsed;
  };

  it("returns the richer structured answer, accepted by the same validation the browser uses", async () => {
    const h = harness(async () => ({ text: JSON.stringify(expiryModel()) }), fixedNow);
    const r = await ask(h);
    assert.equal(r.status, 200);
    const a = answerOf(r);
    assert.equal(a.intent, "expiry_date");
    assert.equal(a.confidence, "high");
    assert.equal(a.expiry_check?.status, "not_expired");
    assert.equal(a.expiry_check?.printed_text, "EXP 08/2027");
    assert.equal(a.expiry_check?.manufacturing_text, "MFG 02/2026");
    assert.ok(a.notices.includes("expiry_limits"));
    assert.equal(h.calls.length, 1, "still exactly one Gemini request");
  });

  it("uses the device's local date as 'today' and reports it", async () => {
    const h = harness(async () => ({ text: JSON.stringify(expiryModel({ expiry: { expiry_date: "30/11/2026", expiry_kind: "expiry", manufacturing_date: null, date_text: null } })) }), fixedNow);
    const onTheDay = answerOf(await ask(h, { local_date: "2026-11-30" }));
    // 30 Nov is 24 days from FIXED_NOW, beyond the allowed skew: the server date is used instead.
    assert.equal(onTheDay.expiry_check?.checked_on_source, "server");
    assert.equal(onTheDay.expiry_check?.checked_on, "2026-11-06");
    const plausible = answerOf(await ask(h, { local_date: "2026-11-07" }));
    assert.equal(plausible.expiry_check?.checked_on, "2026-11-07");
    assert.equal(plausible.expiry_check?.checked_on_source, "device");
    assert.equal(plausible.expiry_check?.status, "not_expired");
  });

  it("near midnight the user's own date decides (India is already on the next day)", async () => {
    const late = Date.UTC(2026, 10, 15, 20, 30); // 15 Nov 20:30 UTC = 16 Nov 02:00 IST
    const h = harness(async () => ({ text: JSON.stringify(expiryModel({ expiry: { expiry_date: "15/11/2026", expiry_kind: "expiry", manufacturing_date: null, date_text: null } })) }), { now: () => late });
    const india = answerOf(await ask(h, { local_date: "2026-11-16" }));
    assert.equal(india.expiry_check?.status, "expired"); // 16 Nov: the printed 15 Nov has passed
    assert.equal(india.expiry_check?.checked_on_source, "device");
    const noDate = answerOf(await ask(h));
    assert.equal(noDate.expiry_check?.status, "not_expired"); // the server's UTC date is still 15 Nov
    assert.equal(noDate.expiry_check?.checked_on_source, "server");
  });

  it("ignores an implausible or impossible device date instead of trusting it", async () => {
    const h = harness(async () => ({ text: JSON.stringify(expiryModel()) }), fixedNow);
    for (const local_date of ["2030-01-01", "1999-12-31", "2026-02-30", "2026-13-01"]) {
      const a = answerOf(await ask(h, { local_date }));
      assert.equal(a.expiry_check?.checked_on_source, "server", local_date);
      assert.equal(a.expiry_check?.checked_on, "2026-11-06", local_date);
    }
  });

  it("rejects a malformed local_date field", async () => {
    const h = harness(undefined, fixedNow);
    for (const local_date of ["2026-1-6", "06/11/2026", 20261106, "", "today", ["2026-11-06"], {}]) {
      const r = await ask(h, { local_date });
      assert.equal(r.status, 400, JSON.stringify(local_date));
      assert.equal(errorCode(r), "INVALID_REQUEST");
    }
    assert.equal(h.calls.length, 0);
  });

  it("local_date is optional and null is accepted", async () => {
    const h = harness(undefined, fixedNow);
    assert.equal((await ask(h)).status, 200);
    assert.equal((await ask(h, { local_date: null })).status, 200);
  });

  it("replaces a wrong expiry conclusion from the model with the deterministic result", async () => {
    const h = harness(async () => ({ text: JSON.stringify(expiryModel({ answer: "This product has expired." })) }), fixedNow);
    const a = answerOf(await ask(h));
    assert.equal(a.expiry_check?.status, "not_expired");
    assert.doesNotMatch(a.answer, /has expired/);
    assert.ok(a.adjustments.includes("expiry_conclusion_replaced"));
  });

  it("a manufacturing date alone is unclear through the whole route", async () => {
    const h = harness(async () => ({ text: JSON.stringify(expiryModel({ expiry: { expiry_date: null, expiry_kind: null, manufacturing_date: "MFG 03/2019", date_text: "MFG 03/2019" } })) }), fixedNow);
    const a = answerOf(await ask(h));
    assert.equal(a.expiry_check?.status, "unclear");
    assert.match(a.expiry_check?.explanation ?? "", /not an expiry date/);
  });

  it("a banknote value the model suggests but the checks do not support is withheld", async () => {
    const h = harness(async () => ({ text: JSON.stringify(modelOutput({ intent: "currency_identification", answer: "It is a ₹2000 note.", currency: { denomination: 2000, currency: "INR", evidence: "numeral 2000 visible" } })) }), fixedNow);
    const a = answerOf(await ask(h));
    assert.equal(a.currency_check?.status, "uncertain");
    assert.equal(a.currency_check?.denomination, null);
    assert.doesNotMatch(a.answer, /2000/);
  });

  it("an identified note is returned with its evidence and notice", async () => {
    const h = harness(async () => ({ text: JSON.stringify(modelOutput({ intent: "currency_identification", answer: "This looks like a ₹100 note.", currency: { denomination: 100, currency: "INR", evidence: "numeral 100 and portrait" } })) }), fixedNow);
    const a = answerOf(await ask(h));
    assert.equal(a.currency_check?.status, "identified");
    assert.equal(a.currency_check?.denomination, 100);
    assert.ok(a.notices.includes("currency_limits"));
  });

  it("removes safety and medical claims that the model slipped in", async () => {
    const h = harness(async () => ({ text: JSON.stringify(modelOutput({ intent: "scene_description", answer: "A zebra crossing. It is safe to cross. You should take two tablets." })) }), fixedNow);
    const a = answerOf(await ask(h));
    assert.doesNotMatch(a.answer, /safe to cross|should take/);
    assert.ok(a.adjustments.includes("navigation_claim_removed"));
    assert.ok(a.adjustments.includes("medical_advice_removed"));
    assert.match(a.answer, /A zebra crossing\./);
  });

  it("rejects model output with an invalid intent, confidence or shape", async () => {
    const bad: Array<[string, unknown]> = [
      ["invalid intent", { ...VALID_MODEL_OUTPUT, intent: "banana" }],
      ["missing intent", { ...VALID_MODEL_OUTPUT, intent: undefined }],
      ["invalid confidence", { ...VALID_MODEL_OUTPUT, confidence: "certain" }],
      ["numeric confidence", { ...VALID_MODEL_OUTPUT, confidence: 0.92 }],
      ["missing currency block", { ...VALID_MODEL_OUTPUT, currency: undefined }],
      ["missing expiry block", { ...VALID_MODEL_OUTPUT, expiry: undefined }],
      ["denomination as text", modelOutput({ currency: { denomination: "500" } })],
      ["invalid expiry kind", modelOutput({ expiry: { expiry_date: "08/2027", expiry_kind: "mfg" } })],
      ["over-long evidence", modelOutput({ currency: { denomination: 10, currency: "INR", evidence: "e".repeat(600) } })],
    ];
    for (const [name, output] of bad) {
      const h = harness(async () => ({ text: JSON.stringify(output) }), fixedNow);
      const r = await ask(h);
      assert.equal(r.status, 502, name);
      assert.equal(errorCode(r), "INVALID_MODEL_RESPONSE", name);
    }
  });

  it("logs the intent but never the answer, dates or printed text", async () => {
    const h = harness(async () => ({ text: JSON.stringify(expiryModel({ answer: "SECRETANSWER", printed_text: "SECRETPRINT" })) }), fixedNow);
    await ask(h);
    const logs = h.logs.join("\n");
    assert.match(logs, /intent expiry_date/);
    assert.ok(!/SECRETANSWER|SECRETPRINT|08\/2027|MFG/.test(logs), logs);
  });
});

describe("answer language and multilingual text (Milestone 7)", () => {
  it("an older client that sends no response_language still works, and Gemini gets null", async () => {
    const h = harness();
    const r = await call(h, valid());
    assert.equal(r.status, 200);
    assert.equal(h.calls[0].responseLanguage, null);
  });

  it("passes an allow-listed language to the single Gemini call", async () => {
    const h = harness();
    const r = await call(h, askRequest({ image: IMAGE, question: QUESTION, response_language: "kn-IN" }));
    assert.equal(r.status, 200);
    assert.equal(h.calls.length, 1);
    assert.equal(h.calls[0].responseLanguage, "kn-IN");
  });

  it("rejects an unsupported language before any Gemini call or rate-limit slot is used", async () => {
    const h = harness();
    const r = await call(h, askRequest({ image: IMAGE, question: QUESTION, response_language: "fr-FR" }));
    assert.equal(r.status, 400);
    assert.equal(errorCode(r), "INVALID_REQUEST");
    assert.equal(h.calls.length, 0);
  });

  const HI_LABEL = "पैरासिटामोल 500 मिलीग्राम\nदिन में दो बार";
  const KN_LABEL = "ಪ್ಯಾರಾಸಿಟಮಾಲ್ 500 ಮಿಗ್ರಾಂ [unreadable]";

  it("returns printed Hindi and Kannada text exactly as the model copied it (no transliteration, no change)", async () => {
    for (const printed of [HI_LABEL, KN_LABEL]) {
      const h = harness(async () => ({ text: JSON.stringify(modelOutput({ printed_text: printed })), finishReason: "STOP" }));
      const r = await call(h, askRequest({ image: IMAGE, question: QUESTION, response_language: "hi-IN" }));
      assert.equal(r.status, 200);
      assert.equal(r.json?.printed_text, printed);
    }
  });

  it("copies printed Hindi dosage instructions unchanged and keeps them apart from the AI's own words", async () => {
    const instructions = "भोजन के बाद एक गोली लें";
    const h = harness(async () => ({
      text: JSON.stringify(modelOutput({ intent: "medicine_label", answer: "लेबल पर कुछ निर्देश छपे हैं।", printed_instructions: instructions })),
      finishReason: "STOP",
    }));
    const r = await call(h, askRequest({ image: IMAGE, question: QUESTION, response_language: "hi-IN" }));
    assert.equal(r.json?.printed_instructions, instructions);
    assert.ok((r.json?.notices as string[]).includes("label_only"));
  });

  it("removes an unsafe Hindi sentence from the AI's answer and says so", async () => {
    const h = harness(async () => ({
      text: JSON.stringify(modelOutput({ answer: "तस्वीर में एक सड़क है। सड़क साफ़ है, आप पार कर सकते हैं।" })),
      finishReason: "STOP",
    }));
    const r = await call(h, askRequest({ image: IMAGE, question: QUESTION, response_language: "hi-IN" }));
    assert.equal(r.status, 200);
    assert.doesNotMatch(String(r.json?.answer), /पार कर सकते/);
    assert.match(String(r.json?.answer), /तस्वीर में एक सड़क है/);
    assert.ok((r.json?.adjustments as string[]).includes("navigation_claim_removed"));
  });

  it("does not log the language, question, answer or printed text", async () => {
    const h = harness(async () => ({ text: JSON.stringify(modelOutput({ printed_text: HI_LABEL })), finishReason: "STOP" }));
    await call(h, askRequest({ image: IMAGE, question: QUESTION, response_language: "hi-IN" }));
    const logged = h.logs.join("\n");
    assert.doesNotMatch(logged, /पैरासिटामोल|hi-IN|QSECRET/);
  });
});
