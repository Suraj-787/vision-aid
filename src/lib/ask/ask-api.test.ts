import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ASK_CLIENT_ERRORS,
  ASK_SERVER_ERRORS,
  isServerErrorCode,
  MAX_IMAGE_BYTES,
  MAX_QUESTION_LENGTH,
  MAX_REQUEST_BODY_BYTES,
} from "./ask-api.ts";

describe("error table", () => {
  const entries = Object.entries(ASK_SERVER_ERRORS);

  it("every server error has a 4xx/5xx status and a short user-friendly message", () => {
    for (const [code, info] of entries) {
      assert.ok(info.status >= 400 && info.status <= 599, `${code} status ${info.status}`);
      assert.ok(info.message.length > 10 && info.message.length <= 200, `${code} message length`);
    }
  });

  it("messages never contain secrets, stack traces or internals", () => {
    for (const [code, info] of entries) {
      assert.doesNotMatch(info.message, /GEMINI_API_KEY|AIza|stack|at \w+\.\w+|ApiError|Error:|node_modules|\.ts\b/i, code);
    }
  });

  it("maps the required failure classes to appropriate HTTP statuses", () => {
    assert.equal(ASK_SERVER_ERRORS.API_KEY_NOT_CONFIGURED.status, 500);
    assert.equal(ASK_SERVER_ERRORS.MODEL_NOT_CONFIGURED.status, 500);
    assert.equal(ASK_SERVER_ERRORS.INVALID_JSON.status, 400);
    assert.equal(ASK_SERVER_ERRORS.MISSING_IMAGE.status, 400);
    assert.equal(ASK_SERVER_ERRORS.MISSING_QUESTION.status, 400);
    assert.equal(ASK_SERVER_ERRORS.QUESTION_TOO_LONG.status, 400);
    assert.equal(ASK_SERVER_ERRORS.UNSUPPORTED_IMAGE_FORMAT.status, 415);
    assert.equal(ASK_SERVER_ERRORS.IMAGE_TOO_LARGE.status, 413);
    assert.equal(ASK_SERVER_ERRORS.UPSTREAM_AUTH.status, 502);
    assert.equal(ASK_SERVER_ERRORS.UPSTREAM_QUOTA.status, 429);
    assert.equal(ASK_SERVER_ERRORS.UPSTREAM_TIMEOUT.status, 504);
    assert.equal(ASK_SERVER_ERRORS.UPSTREAM_UNAVAILABLE.status, 503);
    assert.equal(ASK_SERVER_ERRORS.INVALID_MODEL_RESPONSE.status, 502);
  });

  it("only failures that a repeat could fix are marked retryable", () => {
    for (const code of ["INVALID_IMAGE", "MISSING_QUESTION", "API_KEY_NOT_CONFIGURED", "MODEL_NOT_CONFIGURED", "UPSTREAM_AUTH", "RESPONSE_BLOCKED"] as const) {
      assert.equal(ASK_SERVER_ERRORS[code].retryable, false, code);
    }
    for (const code of ["RATE_LIMITED", "UPSTREAM_QUOTA", "UPSTREAM_TIMEOUT", "UPSTREAM_UNAVAILABLE", "INVALID_MODEL_RESPONSE"] as const) {
      assert.equal(ASK_SERVER_ERRORS[code].retryable, true, code);
    }
  });

  it("client-side error codes have messages and are not server codes", () => {
    for (const [code, info] of Object.entries(ASK_CLIENT_ERRORS)) {
      assert.ok(info.message.length > 5, code);
      assert.equal(isServerErrorCode(code), false, code);
    }
    assert.equal(isServerErrorCode("UPSTREAM_QUOTA"), true);
    assert.equal(isServerErrorCode("constructor"), false);
    assert.equal(isServerErrorCode("toString"), false);
  });

  it("size limits are consistent", () => {
    assert.ok(MAX_REQUEST_BODY_BYTES > (MAX_IMAGE_BYTES * 4) / 3);
    assert.equal(MAX_QUESTION_LENGTH, 500);
  });
});
