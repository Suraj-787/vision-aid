import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ApiError } from "@google/genai";
import { classifyUpstreamError, describeUpstreamError } from "./errors.ts";

const api = (status: number, message = "x") => new ApiError({ message, status });

describe("classifyUpstreamError", () => {
  it("authentication failures", () => {
    assert.equal(classifyUpstreamError(api(401)), "UPSTREAM_AUTH");
    assert.equal(classifyUpstreamError(api(403)), "UPSTREAM_AUTH");
    assert.equal(classifyUpstreamError(api(400, '{"error":{"message":"API key not valid. Please pass a valid API key."}}')), "UPSTREAM_AUTH");
    assert.equal(classifyUpstreamError(api(400, "API_KEY_INVALID")), "UPSTREAM_AUTH");
  });

  it("a 400 that is not about the key is a generic upstream error", () => {
    assert.equal(classifyUpstreamError(api(400, "Unable to process input image")), "UPSTREAM_ERROR");
  });

  it("quota / rate limits", () => {
    assert.equal(classifyUpstreamError(api(429, "RESOURCE_EXHAUSTED")), "UPSTREAM_QUOTA");
  });

  it("timeouts", () => {
    assert.equal(classifyUpstreamError(api(408)), "UPSTREAM_TIMEOUT");
    assert.equal(classifyUpstreamError(api(504)), "UPSTREAM_TIMEOUT");
    const abort = new Error("aborted");
    abort.name = "AbortError";
    assert.equal(classifyUpstreamError(abort), "UPSTREAM_TIMEOUT");
    const timeout = new Error("timeout");
    timeout.name = "TimeoutError";
    assert.equal(classifyUpstreamError(timeout), "UPSTREAM_TIMEOUT");
    const wrapped = new TypeError("fetch failed", { cause: abort });
    assert.equal(classifyUpstreamError(wrapped), "UPSTREAM_TIMEOUT");
  });

  it("service unavailable and network failures", () => {
    for (const s of [500, 502, 503]) assert.equal(classifyUpstreamError(api(s)), "UPSTREAM_UNAVAILABLE", String(s));
    assert.equal(classifyUpstreamError(new TypeError("fetch failed")), "UPSTREAM_UNAVAILABLE");
  });

  it("everything else is a generic upstream error (unknown model, bad request, odd values)", () => {
    assert.equal(classifyUpstreamError(api(404)), "UPSTREAM_ERROR");
    assert.equal(classifyUpstreamError(api(418)), "UPSTREAM_ERROR");
    assert.equal(classifyUpstreamError(new Error("boom")), "UPSTREAM_ERROR");
    assert.equal(classifyUpstreamError("string"), "UPSTREAM_ERROR");
    assert.equal(classifyUpstreamError(undefined), "UPSTREAM_ERROR");
    assert.equal(classifyUpstreamError(null), "UPSTREAM_ERROR");
  });

  it("works for status-bearing errors that are not ApiError instances", () => {
    assert.equal(classifyUpstreamError({ status: 429 }), "UPSTREAM_QUOTA");
  });
});

describe("describeUpstreamError", () => {
  it("includes only the error class and status, never the message", () => {
    const text = describeUpstreamError(api(429, "secret question text and key AIzaSECRET"));
    assert.match(text, /status=429/);
    assert.doesNotMatch(text, /secret|AIza/i);
    assert.equal(describeUpstreamError("odd"), "string status=n/a");
  });

  it("adds Google's status name from a JSON error body, and nothing else from it", () => {
    const body = JSON.stringify({
      error: {
        code: 503,
        message: "high demand; question QSECRET key AIzaSECRET",
        status: "UNAVAILABLE",
      },
    });
    const text = describeUpstreamError(api(503, body));
    assert.equal(text, "ApiError status=503 (UNAVAILABLE)");
    assert.doesNotMatch(text, /QSECRET|AIza|demand/);
  });

  it("ignores status values that are not a plain UPPER_SNAKE_CASE name", () => {
    for (const status of ["unavailable", "x".repeat(60), "AIzaSECRET-key", "OK; rm -rf", 5, null]) {
      const body = JSON.stringify({ error: { code: 503, message: "m", status } });
      assert.equal(describeUpstreamError(api(503, body)), "ApiError status=503", String(status));
    }
    assert.equal(describeUpstreamError(api(503, "not json")), "ApiError status=503");
  });
});
