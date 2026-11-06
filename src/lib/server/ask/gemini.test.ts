import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, beforeEach, describe, it } from "node:test";
import { SlidingWindowLimiter } from "@/lib/server/rate-limit";
import { readAskConfig } from "./config.ts";
import { classifyUpstreamError } from "./errors.ts";
import { createGeminiClient } from "./gemini.ts";
import { handleAsk, type AskDeps } from "./handler.ts";
import { askRequest, makeJpeg, toBase64, VALID_ANSWER, VALID_MODEL_OUTPUT } from "./test-utils.ts";
import { MODEL_OUTPUT_KEYS } from "./prompt.ts";

/**
 * These tests run the REAL @google/genai SDK against a local fake server, so the
 * exact HTTP request Gemini would receive is checked without any network access
 * or real API calls.
 */

interface Recorded {
  method: string;
  url: string;
  headers: IncomingMessage["headers"];
  body: string;
}

const API_KEY = "FAKEKEY-0123456789-abcdefghijklmnop";
const MODEL = "test-model-1";
const IMAGE = toBase64(makeJpeg());
const QUESTION = "What does the label say?";

let server: ReturnType<typeof createServer>;
let baseUrl = "";
let requests: Recorded[] = [];
let respond: (req: IncomingMessage, res: ServerResponse) => void = () => {};

const okBody = (text: string) =>
  JSON.stringify({
    candidates: [{ content: { role: "model", parts: [{ text }] }, finishReason: "STOP" }],
  });

function json(res: ServerResponse, status: number, body: string) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(body);
}

before(async () => {
  server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      requests.push({ method: req.method ?? "", url: req.url ?? "", headers: req.headers, body: Buffer.concat(chunks).toString("utf8") });
      respond(req, res);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  server.closeAllConnections?.();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  requests = [];
  respond = (_req, res) => json(res, 200, okBody(JSON.stringify(VALID_MODEL_OUTPUT)));
});

const input = { apiKey: API_KEY, model: MODEL, imageBase64: IMAGE, question: QUESTION };

describe("the request sent to Gemini (real SDK, fake server)", () => {
  it("uses models.generateContent for the configured model, with the key only in a header", async () => {
    const out = await createGeminiClient({ baseUrl }).generate(input);
    assert.equal(requests.length, 1);
    const [req] = requests;
    assert.equal(req.method, "POST");
    assert.match(req.url, new RegExp(`/models/${MODEL}:generateContent$`));
    assert.doesNotMatch(req.url, /streamGenerateContent|live|interactions/i);
    assert.equal(req.headers["x-goog-api-key"], API_KEY);
    assert.ok(!req.url.includes(API_KEY), "key is not in the URL");
    assert.ok(!req.body.includes(API_KEY), "key is not in the body");
    assert.deepEqual(JSON.parse(out.text ?? ""), VALID_MODEL_OUTPUT);
    assert.equal(out.finishReason, "STOP");
  });

  it("sends the JPEG inline, image first and then the question text", async () => {
    await createGeminiClient({ baseUrl }).generate(input);
    const body = JSON.parse(requests[0].body);
    const parts = body.contents[0].parts;
    assert.equal(body.contents.length, 1);
    assert.equal(parts.length, 2);
    assert.deepEqual(parts[0], { inlineData: { mimeType: "image/jpeg", data: IMAGE } });
    assert.match(parts[1].text, new RegExp(QUESTION));
    assert.match(parts[1].text, /<question>/);
  });

  it("asks for structured JSON with the response schema and the safety system instruction", async () => {
    await createGeminiClient({ baseUrl }).generate(input);
    const body = JSON.parse(requests[0].body);
    assert.equal(body.generationConfig.responseMimeType, "application/json");
    const schema = body.generationConfig.responseJsonSchema;
    assert.deepEqual(schema.required, [...MODEL_OUTPUT_KEYS]);
    assert.deepEqual(schema.properties.details.type, ["string", "null"]);
    assert.deepEqual(schema.properties.intent.enum.length, 7);
    assert.deepEqual(schema.properties.confidence.enum, ["low", "medium", "high"]);
    assert.deepEqual(schema.properties.currency.required, ["denomination", "currency", "evidence"]);
    assert.deepEqual(schema.properties.expiry.required, ["expiry_date", "expiry_kind", "manufacturing_date", "date_text"]);
    assert.equal(schema.additionalProperties, false);
    const system = body.systemInstruction.parts[0].text as string;
    assert.match(system, /NOT a navigation or obstacle-avoidance system/);
    assert.match(system, /NEVER recommend, calculate or adjust a dose/);
    assert.match(system, /NEVER claim that a note is genuine, fake or counterfeit/);
  });

  it("does not stream, use tools, or send anything beyond the single request", async () => {
    await createGeminiClient({ baseUrl }).generate(input);
    const body = JSON.parse(requests[0].body);
    assert.equal(requests.length, 1);
    assert.equal(body.tools, undefined);
    assert.equal(body.toolConfig, undefined);
    assert.doesNotMatch(requests[0].url, /alt=sse/);
  });
});

describe("failures from Gemini: one attempt only (no automatic retries) and safe mapping", () => {
  const failures: Array<[string, number, string, string]> = [
    ["429 quota", 429, '{"error":{"code":429,"message":"Resource exhausted","status":"RESOURCE_EXHAUSTED"}}', "UPSTREAM_QUOTA"],
    ["503 unavailable", 503, '{"error":{"code":503,"message":"The model is overloaded","status":"UNAVAILABLE"}}', "UPSTREAM_UNAVAILABLE"],
    ["500 internal", 500, '{"error":{"code":500,"message":"Internal error","status":"INTERNAL"}}', "UPSTREAM_UNAVAILABLE"],
    ["401 auth", 401, '{"error":{"code":401,"message":"Unauthenticated","status":"UNAUTHENTICATED"}}', "UPSTREAM_AUTH"],
    ["403 permission", 403, '{"error":{"code":403,"message":"Permission denied","status":"PERMISSION_DENIED"}}', "UPSTREAM_AUTH"],
    ["400 invalid key", 400, '{"error":{"code":400,"message":"API key not valid. Please pass a valid API key.","status":"INVALID_ARGUMENT"}}', "UPSTREAM_AUTH"],
    ["404 unknown model", 404, '{"error":{"code":404,"message":"models/x is not found","status":"NOT_FOUND"}}', "UPSTREAM_ERROR"],
  ];
  for (const [name, status, body, expected] of failures) {
    it(`${name} -> ${expected}, exactly 1 request`, async () => {
      respond = (_req, res) => json(res, status, body);
      await assert.rejects(createGeminiClient({ baseUrl }).generate(input), (err: unknown) => {
        assert.equal(classifyUpstreamError(err), expected);
        return true;
      });
      assert.equal(requests.length, 1, "the SDK must not retry automatically");
    });
  }

  it("a hung upstream is cut off by the timeout -> UPSTREAM_TIMEOUT, 1 request", async () => {
    respond = () => {
      /* never answer */
    };
    const started = Date.now();
    await assert.rejects(createGeminiClient({ baseUrl, timeoutMs: 300 }).generate(input), (err: unknown) => {
      assert.equal(classifyUpstreamError(err), "UPSTREAM_TIMEOUT");
      return true;
    });
    assert.ok(Date.now() - started < 3000, "returned promptly after the timeout");
    assert.equal(requests.length, 1);
  });

  it("an unreachable server -> UPSTREAM_UNAVAILABLE", async () => {
    const dead = createServer();
    await new Promise<void>((resolve) => dead.listen(0, "127.0.0.1", resolve));
    const url = `http://127.0.0.1:${(dead.address() as AddressInfo).port}`;
    await new Promise<void>((resolve) => dead.close(() => resolve()));
    await assert.rejects(createGeminiClient({ baseUrl: url, timeoutMs: 2000 }).generate(input), (err: unknown) => {
      assert.equal(classifyUpstreamError(err), "UPSTREAM_UNAVAILABLE");
      return true;
    });
  });

  it("a blocked prompt is surfaced as blockReason", async () => {
    respond = (_req, res) =>
      json(res, 200, JSON.stringify({ promptFeedback: { blockReason: "IMAGE_SAFETY" } }));
    const out = await createGeminiClient({ baseUrl }).generate(input);
    assert.equal(out.blockReason, "IMAGE_SAFETY");
    assert.equal(out.text, undefined);
  });
});

describe("handleAsk with the real SDK against the fake server", () => {
  function deps(): AskDeps & { logs: string[] } {
    const logs: string[] = [];
    return {
      readConfig: () => readAskConfig({ GEMINI_API_KEY: API_KEY, GEMINI_MODEL: MODEL }),
      gemini: createGeminiClient({ baseUrl, timeoutMs: 400 }),
      perClient: new SlidingWindowLimiter(20, 600_000),
      overall: new SlidingWindowLimiter(120, 3_600_000),
      inFlight: new Set(),
      now: () => Date.now(),
      log: (l) => logs.push(l),
      logs,
    };
  }
  const run = (d: AskDeps) => handleAsk(askRequest({ image: IMAGE, question: QUESTION }), d);

  it("success: 200 with the validated answer after exactly one upstream request", async () => {
    const res = await run(deps());
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), VALID_ANSWER);
    assert.equal(requests.length, 1);
  });

  it("upstream 429 -> HTTP 429 UPSTREAM_QUOTA with Retry-After, still one request", async () => {
    respond = (_req, res) => json(res, 429, '{"error":{"code":429,"message":"quota","status":"RESOURCE_EXHAUSTED"}}');
    const res = await run(deps());
    assert.equal(res.status, 429);
    assert.equal((await res.json()).error.code, "UPSTREAM_QUOTA");
    assert.equal(res.headers.get("retry-after"), "60");
    assert.equal(requests.length, 1);
  });

  it("upstream auth failure -> 502 UPSTREAM_AUTH, and the response never contains the key", async () => {
    respond = (_req, res) => json(res, 403, `{"error":{"code":403,"message":"bad key ${API_KEY}","status":"PERMISSION_DENIED"}}`);
    const d = deps();
    const res = await run(d);
    const text = await res.text();
    assert.equal(res.status, 502);
    assert.match(text, /UPSTREAM_AUTH/);
    assert.ok(!text.includes(API_KEY));
    assert.ok(!d.logs.join("\n").includes(API_KEY));
  });

  it("upstream timeout -> 504 UPSTREAM_TIMEOUT", async () => {
    respond = () => {};
    const res = await run(deps());
    assert.equal(res.status, 504);
    assert.equal((await res.json()).error.code, "UPSTREAM_TIMEOUT");
  });

  it("malformed upstream answer -> 502 INVALID_MODEL_RESPONSE", async () => {
    respond = (_req, res) => json(res, 200, okBody("definitely not json"));
    const res = await run(deps());
    assert.equal(res.status, 502);
    assert.equal((await res.json()).error.code, "INVALID_MODEL_RESPONSE");
  });

  it("an answer that is valid JSON but incomplete -> 502 INVALID_MODEL_RESPONSE", async () => {
    respond = (_req, res) => json(res, 200, okBody(JSON.stringify({ answer: "only an answer" })));
    const res = await run(deps());
    assert.equal(res.status, 502);
  });
});

describe("answer language in the Gemini request (Milestone 7)", () => {
  it("without a language, the system instruction is the fixed one and nothing about language is added", async () => {
    await createGeminiClient({ baseUrl }).generate(input);
    const system = JSON.parse(requests[0].body).systemInstruction.parts[0].text as string;
    assert.doesNotMatch(system, /\nANSWER LANGUAGE\n/);
  });

  it("with a language, the same single request carries the directive in the system instruction", async () => {
    await createGeminiClient({ baseUrl }).generate({ ...input, responseLanguage: "hi-IN" });
    assert.equal(requests.length, 1, "no second request for translation");
    const body = JSON.parse(requests[0].body);
    const system = body.systemInstruction.parts[0].text as string;
    assert.match(system, /ANSWER LANGUAGE[\s\S]*Hindi in Devanagari script/);
    assert.match(system, /NOT a navigation or obstacle-avoidance system/);
    assert.equal(body.contents.length, 1);
    assert.doesNotMatch(JSON.stringify(body.contents), /Hindi/); // the language never goes into the user turn
  });
});
