import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { blobToBase64 } from "../image/base64.ts";
import { postAsk } from "./client.ts";
import { ASK_SERVER_ERRORS } from "./ask-api.ts";

const VALID = {
  intent: "scene_description",
  answer: "It is a red mug.",
  details: null,
  uncertainty: null,
  confidence: "medium",
  printed_text: null,
  printed_instructions: null,
  currency_check: null,
  expiry_check: null,
  notices: [],
  adjustments: [],
};

const bytes = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 0xff, 0xd9]);
const image = () => new Blob([bytes], { type: "image/jpeg" });

interface Seen {
  url: string;
  init: RequestInit;
}

function fakeFetch(respond: (seen: Seen) => Response | Promise<Response>) {
  const seen: Seen[] = [];
  const impl = (async (url: string, init: RequestInit) => {
    seen.push({ url, init });
    return respond({ url, init });
  }) as unknown as typeof fetch;
  return { impl, seen };
}

const jsonResponse = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

const errorBody = (code: string, message = "x") => ({ error: { code, message, retryable: true } });

describe("blobToBase64", () => {
  it("encodes bytes exactly like Buffer, including large inputs", async () => {
    assert.equal(await blobToBase64(new Blob([bytes])), Buffer.from(bytes).toString("base64"));
    const big = Uint8Array.from({ length: 200_000 }, (_, i) => (i * 31) & 0xff);
    assert.equal(await blobToBase64(new Blob([big])), Buffer.from(big).toString("base64"));
    assert.equal(await blobToBase64(new Blob([])), "");
  });
});

describe("postAsk request", () => {
  it("sends exactly one JSON POST to /api/ask with only image, question and the local date", async () => {
    const { impl, seen } = fakeFetch(() => jsonResponse(200, VALID));
    await postAsk({ image: image(), question: "What is this?", fetchImpl: impl, now: () => new Date(2026, 10, 6, 23, 59) });
    assert.equal(seen.length, 1);
    assert.equal(seen[0].url, "/api/ask");
    assert.equal(seen[0].init.method, "POST");
    assert.equal((seen[0].init.headers as Record<string, string>)["Content-Type"], "application/json");
    const body = JSON.parse(String(seen[0].init.body));
    assert.deepEqual(Object.keys(body).sort(), ["image", "local_date", "question"]);
    assert.equal(body.local_date, "2026-11-06"); // the device's own calendar date, even at 23:59
    assert.equal(body.image, Buffer.from(bytes).toString("base64"));
    assert.equal(body.question, "What is this?");
    assert.equal(seen[0].init.cache, "no-store");
    assert.equal(seen[0].init.credentials, "same-origin");
  });
});

describe("postAsk response language (Milestone 7)", () => {
  it("sends response_language only when one is given, and only the supported code", async () => {
    const { impl, seen } = fakeFetch(() => jsonResponse(200, VALID));
    await postAsk({ image: image(), question: "q", responseLanguage: "hi-IN", fetchImpl: impl, now: () => new Date(2026, 10, 6, 12) });
    const body = JSON.parse(String(seen[0].init.body));
    assert.deepEqual(Object.keys(body).sort(), ["image", "local_date", "question", "response_language"]);
    assert.equal(body.response_language, "hi-IN");
  });

  it("omits the field when no language is given (the request is exactly as before)", async () => {
    const { impl, seen } = fakeFetch(() => jsonResponse(200, VALID));
    await postAsk({ image: image(), question: "q", fetchImpl: impl });
    assert.deepEqual(Object.keys(JSON.parse(String(seen[0].init.body))).sort(), ["image", "local_date", "question"]);
  });
});

describe("postAsk success", () => {
  it("returns the validated result", async () => {
    const { impl } = fakeFetch(() => jsonResponse(200, { ...VALID, extra: "dropped" }));
    const outcome = await postAsk({ image: image(), question: "q", fetchImpl: impl });
    assert.deepEqual(outcome, { ok: true, result: VALID });
  });

  it("rejects a 200 whose body is not a valid result", async () => {
    for (const body of [{}, { answer: "" }, { answer: "x" }, [], "text", null, { text: "hi" }, { ...VALID, intent: "banana" }, { ...VALID, confidence: "certain" }, { ...VALID, expiry_check: { status: "safe" } }]) {
      const { impl } = fakeFetch(() => jsonResponse(200, body));
      const outcome = await postAsk({ image: image(), question: "q", fetchImpl: impl });
      assert.equal(outcome.ok, false);
      assert.equal(!outcome.ok && outcome.error.code, "BAD_SERVER_RESPONSE");
    }
  });

  it("rejects a 200 that is not JSON", async () => {
    const { impl } = fakeFetch(() => new Response("<html>oops</html>", { status: 200 }));
    const outcome = await postAsk({ image: image(), question: "q", fetchImpl: impl });
    assert.equal(!outcome.ok && outcome.error.code, "BAD_SERVER_RESPONSE");
  });
});

describe("postAsk server errors", () => {
  it("maps every known server error code, with its retryable flag", async () => {
    for (const [code, info] of Object.entries(ASK_SERVER_ERRORS)) {
      const { impl } = fakeFetch(() => jsonResponse(info.status, errorBody(code, info.message)));
      const outcome = await postAsk({ image: image(), question: "q", fetchImpl: impl });
      assert.ok(!outcome.ok, code);
      assert.equal(outcome.error.code, code);
      assert.equal(outcome.error.retryable, info.retryable, code);
      assert.equal(outcome.error.message, info.message);
    }
  });

  it("surfaces Retry-After", async () => {
    const { impl } = fakeFetch(() => jsonResponse(429, errorBody("RATE_LIMITED"), { "retry-after": "42" }));
    const outcome = await postAsk({ image: image(), question: "q", fetchImpl: impl });
    assert.ok(!outcome.ok);
    assert.equal(outcome.error.retryAfterSeconds, 42);
  });

  it("falls back to the built-in message if the server's is empty or very long", async () => {
    for (const message of ["", "x".repeat(400)]) {
      const { impl } = fakeFetch(() => jsonResponse(502, errorBody("UPSTREAM_ERROR", message)));
      const outcome = await postAsk({ image: image(), question: "q", fetchImpl: impl });
      assert.ok(!outcome.ok);
      assert.equal(outcome.error.message, ASK_SERVER_ERRORS.UPSTREAM_ERROR.message);
    }
  });

  it("treats unknown codes and non-JSON error pages as a bad server response", async () => {
    for (const res of [
      jsonResponse(500, errorBody("SOMETHING_NEW")),
      jsonResponse(500, errorBody("constructor")),
      new Response("<html>502 Bad Gateway</html>", { status: 502 }),
      jsonResponse(500, { nope: true }),
      jsonResponse(500, null),
    ]) {
      const { impl } = fakeFetch(() => res.clone());
      const outcome = await postAsk({ image: image(), question: "q", fetchImpl: impl });
      assert.equal(!outcome.ok && outcome.error.code, "BAD_SERVER_RESPONSE");
    }
  });
});

describe("postAsk network, timeout and abort", () => {
  it("a network failure is retryable NETWORK_ERROR", async () => {
    const impl = (async () => {
      throw new TypeError("Failed to fetch");
    }) as unknown as typeof fetch;
    const outcome = await postAsk({ image: image(), question: "q", fetchImpl: impl });
    assert.ok(!outcome.ok);
    assert.equal(outcome.error.code, "NETWORK_ERROR");
    assert.equal(outcome.error.retryable, true);
  });

  const hang = () =>
    fakeFetch(
      ({ init }) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
        }),
    );

  it("times out with CLIENT_TIMEOUT and aborts the request", async () => {
    const { impl, seen } = hang();
    const outcome = await postAsk({ image: image(), question: "q", fetchImpl: impl, timeoutMs: 50 });
    assert.ok(!outcome.ok);
    assert.equal(outcome.error.code, "CLIENT_TIMEOUT");
    assert.equal(outcome.error.retryable, true);
    assert.equal(seen[0].init.signal?.aborted, true);
  });

  it("aborting (Cancel / Retake / leaving the page) yields ABORTED and aborts the fetch", async () => {
    const { impl, seen } = hang();
    const controller = new AbortController();
    const pending = postAsk({ image: image(), question: "q", fetchImpl: impl, signal: controller.signal, timeoutMs: 10_000 });
    await new Promise((r) => setTimeout(r, 20));
    controller.abort();
    const outcome = await pending;
    assert.ok(!outcome.ok);
    assert.equal(outcome.error.code, "ABORTED");
    assert.equal(outcome.error.retryable, false);
    assert.equal(seen[0].init.signal?.aborted, true);
  });

  it("an already-aborted signal never touches the network", async () => {
    const { impl, seen } = fakeFetch(() => jsonResponse(200, VALID));
    const controller = new AbortController();
    controller.abort();
    const outcome = await postAsk({ image: image(), question: "q", fetchImpl: impl, signal: controller.signal });
    assert.equal(!outcome.ok && outcome.error.code, "ABORTED");
    assert.equal(seen.length, 0);
  });

  it("does not retry on failure: one request only", async () => {
    const { impl, seen } = fakeFetch(() => jsonResponse(503, errorBody("UPSTREAM_UNAVAILABLE")));
    await postAsk({ image: image(), question: "q", fetchImpl: impl });
    assert.equal(seen.length, 1);
  });
});
