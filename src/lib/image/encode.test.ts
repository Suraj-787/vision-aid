import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MAX_IMAGE_BYTES } from "../ask/ask-api.ts";
import { encodeWithinLimit, MAX_SEND_IMAGE_BYTES, qualitySteps } from "./encode.ts";
import { unknownQualityReport } from "./quality.ts";

const blobOf = (size: number) => new Blob([new Uint8Array(size)]);

describe("MAX_SEND_IMAGE_BYTES", () => {
  it("is below the server limit, so a photo that passes here is never refused for size", () => {
    assert.ok(MAX_SEND_IMAGE_BYTES < MAX_IMAGE_BYTES);
    assert.ok(MAX_SEND_IMAGE_BYTES > MAX_IMAGE_BYTES * 0.5);
  });
});

describe("qualitySteps", () => {
  it("starts at the requested quality and steps down, never below 0.4", () => {
    assert.deepEqual(qualitySteps(0.85), [0.85, 0.7, 0.55]);
    assert.deepEqual(qualitySteps(0.5), [0.5, 0.4]); // clamped and de-duplicated
    assert.deepEqual(qualitySteps(0.1), [0.4]);
  });
  it("clamps an absurdly high start", () => {
    assert.equal(qualitySteps(7)[0], 0.95);
  });
});

describe("encodeWithinLimit", () => {
  it("keeps the first (best) encoding when it fits", async () => {
    const tried: number[] = [];
    const blob = await encodeWithinLimit(async (q) => (tried.push(q), blobOf(100)), 1000, [0.85, 0.7]);
    assert.equal(blob?.size, 100);
    assert.deepEqual(tried, [0.85]);
  });

  it("re-encodes at lower quality while the result is too large", async () => {
    const sizes: Record<number, number> = { 0.85: 5000, 0.7: 3000, 0.55: 900 };
    const tried: number[] = [];
    const blob = await encodeWithinLimit(async (q) => (tried.push(q), blobOf(sizes[q])), 1000, [0.85, 0.7, 0.55]);
    assert.equal(blob?.size, 900);
    assert.deepEqual(tried, [0.85, 0.7, 0.55]);
  });

  it("returns null when even the lowest quality is too large (never an image the server would refuse)", async () => {
    assert.equal(await encodeWithinLimit(async () => blobOf(5000), 1000, [0.85, 0.7, 0.55]), null);
  });

  it("returns null when the browser cannot encode, or encodes nothing", async () => {
    assert.equal(await encodeWithinLimit(async () => null, 1000, [0.85]), null);
    assert.equal(await encodeWithinLimit(async () => blobOf(0), 1000, [0.85]), null);
  });

  it("does not try further qualities after a failure", async () => {
    let calls = 0;
    await encodeWithinLimit(async () => (calls++, null), 1000, [0.85, 0.7]);
    assert.equal(calls, 1);
  });
});

describe("unknownQualityReport", () => {
  it("reports no issues, so an analysis that could not run never produces a warning or blocks anything", () => {
    const report = unknownQualityReport();
    assert.deepEqual(report.issues, []);
    assert.equal(report.sharpness, null);
  });
});
