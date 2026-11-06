import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  MAX_IMAGE_BYTES,
  MAX_IMAGE_DIMENSION,
  MAX_QUESTION_LENGTH,
} from "@/lib/ask/ask-api";
import { checkJpeg, isJsonContentType, readBodyLimited, validateAskRequest } from "./validate.ts";
import { makeJpeg, PNG_BYTES, toBase64 } from "./test-utils.ts";

const image = toBase64(makeJpeg());
const body = (o: Record<string, unknown>) => JSON.stringify(o);
const code = (raw: string) => {
  const r = validateAskRequest(raw);
  return r.ok ? "OK" : r.code;
};

describe("validateAskRequest: happy path", () => {
  it("accepts a raw-base64 JPEG and a question, trimming the question", () => {
    const r = validateAskRequest(body({ image, question: "  What is this?  " }));
    assert.ok(r.ok);
    assert.equal(r.value.question, "What is this?");
    assert.equal(r.value.imageBase64, image);
    assert.equal(r.value.imageBytes, makeJpeg().length);
  });

  it("accepts an image/jpeg data URL and strips the prefix", () => {
    const r = validateAskRequest(body({ image: `data:image/jpeg;base64,${image}`, question: "q" }));
    assert.ok(r.ok);
    assert.equal(r.value.imageBase64, image);
  });

  it("accepts a question of exactly the maximum length and non-Latin text", () => {
    assert.equal(code(body({ image, question: "a".repeat(MAX_QUESTION_LENGTH) })), "OK");
    assert.equal(code(body({ image, question: "यह क्या है?" })), "OK");
    assert.equal(code(body({ image, question: "ಇದು ಏನು?" })), "OK");
  });
});

describe("validateAskRequest: malformed requests", () => {
  it("rejects invalid JSON", () => {
    for (const raw of ["", "{", "not json", "{'image': 1}"]) assert.equal(code(raw), "INVALID_JSON");
  });

  it("rejects non-object JSON", () => {
    for (const raw of ["null", "[]", '"text"', "42", "true"]) assert.equal(code(raw), "INVALID_REQUEST");
  });

  it("rejects unknown fields so callers cannot pass a model or config", () => {
    assert.equal(code(body({ image, question: "q", model: "other" })), "INVALID_REQUEST");
    assert.equal(code(body({ image, question: "q", systemInstruction: "x" })), "INVALID_REQUEST");
  });

  it("rejects wrong field types", () => {
    assert.equal(code(body({ image: 5, question: "q" })), "INVALID_REQUEST");
    assert.equal(code(body({ image: { data: image }, question: "q" })), "INVALID_REQUEST");
    assert.equal(code(body({ image, question: 5 })), "INVALID_REQUEST");
    assert.equal(code(body({ image, question: ["q"] })), "INVALID_REQUEST");
  });
});

describe("validateAskRequest: question", () => {
  it("rejects a missing, null, empty or whitespace-only question", () => {
    assert.equal(code(body({ image })), "MISSING_QUESTION");
    assert.equal(code(body({ image, question: null })), "MISSING_QUESTION");
    assert.equal(code(body({ image, question: "" })), "MISSING_QUESTION");
    assert.equal(code(body({ image, question: "  \n\t " })), "MISSING_QUESTION");
  });

  it("rejects a question over the length limit", () => {
    assert.equal(code(body({ image, question: "a".repeat(MAX_QUESTION_LENGTH + 1) })), "QUESTION_TOO_LONG");
  });

  it("measures the limit after trimming", () => {
    assert.equal(code(body({ image, question: "  " + "a".repeat(MAX_QUESTION_LENGTH) + "  " })), "OK");
  });
});

describe("validateAskRequest: image", () => {
  it("rejects a missing, null or empty image", () => {
    assert.equal(code(body({ question: "q" })), "MISSING_IMAGE");
    assert.equal(code(body({ image: null, question: "q" })), "MISSING_IMAGE");
    assert.equal(code(body({ image: "", question: "q" })), "MISSING_IMAGE");
    assert.equal(code(body({ image: "data:image/jpeg;base64,", question: "q" })), "MISSING_IMAGE");
  });

  it("rejects base64 that is malformed", () => {
    for (const bad of ["not base64!!", "abc", "ab=c", "AAAA AAAA", "AAAA\nAAAA", "AA==AA==", "@@@@"]) {
      assert.equal(code(body({ image: bad, question: "q" })), "INVALID_IMAGE", bad);
    }
  });

  it("rejects declared non-JPEG MIME types", () => {
    for (const mime of ["image/png", "image/gif", "image/webp", "text/plain", "application/pdf"]) {
      assert.equal(code(body({ image: `data:${mime};base64,${image}`, question: "q" })), "UNSUPPORTED_IMAGE_FORMAT", mime);
    }
  });

  it("rejects a data URL that is not base64", () => {
    assert.equal(code(body({ image: `data:image/jpeg,${image}`, question: "q" })), "INVALID_IMAGE");
  });

  it("does not trust the MIME type alone: a PNG labelled JPEG is rejected", () => {
    const png = toBase64(PNG_BYTES);
    assert.equal(code(body({ image: `data:image/jpeg;base64,${png}`, question: "q" })), "UNSUPPORTED_IMAGE_FORMAT");
    assert.equal(code(body({ image: png, question: "q" })), "UNSUPPORTED_IMAGE_FORMAT");
  });

  it("rejects arbitrary bytes that are valid base64 but not a JPEG", () => {
    const junk = toBase64(Uint8Array.from({ length: 64 }, (_, i) => (i * 37) & 0xff));
    assert.equal(code(body({ image: junk, question: "q" })), "INVALID_IMAGE");
    assert.equal(code(body({ image: toBase64(Buffer.from("hello world, definitely not an image")), question: "q" })), "INVALID_IMAGE");
  });

  it("rejects a truncated JPEG (no end marker)", () => {
    const truncated = makeJpeg().slice(0, -2);
    assert.equal(code(body({ image: toBase64(truncated), question: "q" })), "INVALID_IMAGE");
  });

  it("rejects a JPEG with no frame header or zero dimensions", () => {
    const noSof = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xd9]);
    assert.equal(code(body({ image: toBase64(noSof), question: "q" })), "INVALID_IMAGE");
    assert.equal(code(body({ image: toBase64(makeJpeg({ width: 0, height: 10 })), question: "q" })), "INVALID_IMAGE");
  });

  it("rejects absurd dimensions and over-large images", () => {
    assert.equal(
      code(body({ image: toBase64(makeJpeg({ width: MAX_IMAGE_DIMENSION + 1, height: 10 })), question: "q" })),
      "IMAGE_TOO_LARGE",
    );
    assert.equal(code(body({ image: toBase64(makeJpeg({ width: MAX_IMAGE_DIMENSION, height: MAX_IMAGE_DIMENSION })), question: "q" })), "OK");
    // decoded size over the limit
    const big = toBase64(makeJpeg({ padding: MAX_IMAGE_BYTES }));
    assert.equal(code(body({ image: big, question: "q" })), "IMAGE_TOO_LARGE");
  });

  it("accepts an image exactly at the size limit and rejects one byte over", () => {
    const base = makeJpeg().length;
    assert.equal(code(body({ image: toBase64(makeJpeg({ padding: MAX_IMAGE_BYTES - base })), question: "q" })), "OK");
    assert.equal(code(body({ image: toBase64(makeJpeg({ padding: MAX_IMAGE_BYTES - base + 1 })), question: "q" })), "IMAGE_TOO_LARGE");
  });
});

describe("checkJpeg", () => {
  it("returns the dimensions from the frame header", () => {
    const r = checkJpeg(makeJpeg({ width: 768, height: 432 }));
    assert.deepEqual(r, { ok: true, width: 768, height: 432 });
  });

  it("identifies other known image formats", () => {
    assert.deepEqual(checkJpeg(PNG_BYTES), { ok: false, code: "UNSUPPORTED_IMAGE_FORMAT" });
    assert.deepEqual(checkJpeg(Buffer.from("GIF89a....")), { ok: false, code: "UNSUPPORTED_IMAGE_FORMAT" });
    assert.deepEqual(checkJpeg(Buffer.from("RIFF....WEBP")), { ok: false, code: "UNSUPPORTED_IMAGE_FORMAT" });
  });

  it("rejects tiny inputs", () => {
    assert.deepEqual(checkJpeg(new Uint8Array(0)), { ok: false, code: "INVALID_IMAGE" });
    assert.deepEqual(checkJpeg(Uint8Array.from([0xff, 0xd8])), { ok: false, code: "INVALID_IMAGE" });
  });
});

describe("isJsonContentType / readBodyLimited", () => {
  it("accepts application/json with optional parameters only", () => {
    assert.equal(isJsonContentType("application/json"), true);
    assert.equal(isJsonContentType("application/json; charset=utf-8"), true);
    assert.equal(isJsonContentType("APPLICATION/JSON"), true);
    assert.equal(isJsonContentType("text/plain"), false);
    assert.equal(isJsonContentType("application/jsonp"), false);
    assert.equal(isJsonContentType("multipart/form-data"), false);
    assert.equal(isJsonContentType(null), false);
  });

  it("reads small bodies", async () => {
    const r = await readBodyLimited(new Request("http://x/", { method: "POST", body: "hello" }), 100);
    assert.deepEqual(r, { ok: true, text: "hello" });
  });

  it("rejects bodies over the limit, even without a Content-Length header", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (let i = 0; i < 10; i++) controller.enqueue(new Uint8Array(30));
        controller.close();
      },
    });
    const req = new Request("http://x/", { method: "POST", body: stream, duplex: "half" } as RequestInit);
    assert.deepEqual(await readBodyLimited(req, 100), { ok: false, code: "PAYLOAD_TOO_LARGE" });
  });

  it("rejects an oversized declared Content-Length before reading", async () => {
    const req = new Request("http://x/", { method: "POST", body: "x", headers: { "content-length": "999999999" } });
    assert.deepEqual(await readBodyLimited(req, 100), { ok: false, code: "PAYLOAD_TOO_LARGE" });
  });
});
