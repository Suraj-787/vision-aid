import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ApiError } from "@google/genai";
import { MAX_IMAGE_BYTES, MAX_QUESTION_LENGTH } from "@/lib/ask/ask-api";
import { parseAskResult } from "@/lib/ask/ask-result";
import { SlidingWindowLimiter } from "@/lib/server/rate-limit";
import { readAskConfig, type AskConfig } from "./config.ts";
import type { GeminiClient, GeminiInput, GeminiOutput } from "./gemini.ts";
import { handleAsk, type AskDeps } from "./handler.ts";
import { askRequest, makeJpeg, PNG_BYTES, toBase64, VALID_ANSWER } from "./test-utils.ts";

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
    text: JSON.stringify(VALID_ANSWER),
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
    const h = harness(async () => ({ text: JSON.stringify({ ...VALID_ANSWER, system: "x", __proto__x: 1 }) }));
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
      return { text: JSON.stringify(VALID_ANSWER) };
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
    ["fenced JSON", { text: "```json\n" + JSON.stringify(VALID_ANSWER) + "\n```" }],
    ["truncated JSON", { text: `{"answer": "${MODEL_TEXT_MARKER} cut off` }],
    ["JSON array", { text: "[]" }],
    ["answer missing", { text: JSON.stringify({ details: MODEL_TEXT_MARKER, uncertainty: null, printed_text: null, printed_instructions: null }) }],
    ["answer empty", { text: JSON.stringify({ ...VALID_ANSWER, answer: "  " }) }],
    ["wrong field type", { text: JSON.stringify({ ...VALID_ANSWER, details: { x: MODEL_TEXT_MARKER } }) }],
    ["incomplete (fields missing)", { text: JSON.stringify({ answer: `${MODEL_TEXT_MARKER} only an answer` }) }],
    ["answer too long", { text: JSON.stringify({ ...VALID_ANSWER, answer: MODEL_TEXT_MARKER.repeat(500) }) }],
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
