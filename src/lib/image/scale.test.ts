import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fitWithin } from "./scale.ts";

describe("fitWithin", () => {
  it("downscales landscape images to the max dimension, keeping aspect ratio", () => {
    assert.deepEqual(fitWithin(1920, 1080, 768), { width: 768, height: 432 });
  });

  it("downscales portrait images", () => {
    assert.deepEqual(fitWithin(1080, 1920, 768), { width: 432, height: 768 });
  });

  it("downscales square images", () => {
    assert.deepEqual(fitWithin(3000, 3000, 768), { width: 768, height: 768 });
  });

  it("never upscales smaller images", () => {
    assert.deepEqual(fitWithin(640, 480, 768), { width: 640, height: 480 });
    assert.deepEqual(fitWithin(768, 768, 768), { width: 768, height: 768 });
  });

  it("preserves aspect ratio within rounding", () => {
    const { width, height } = fitWithin(4032, 3024, 768);
    assert.equal(width, 768);
    assert.ok(Math.abs(width / height - 4032 / 3024) < 0.01);
  });

  it("never returns a zero dimension for extreme aspect ratios", () => {
    const { width, height } = fitWithin(10000, 2, 768);
    assert.equal(width, 768);
    assert.equal(height, 1);
  });

  it("rejects invalid input", () => {
    assert.throws(() => fitWithin(0, 100, 768), RangeError);
    assert.throws(() => fitWithin(100, -1, 768), RangeError);
    assert.throws(() => fitWithin(100, 100, 0), RangeError);
    assert.throws(() => fitWithin(Number.NaN, 100, 768), RangeError);
    assert.throws(() => fitWithin(Infinity, 100, 768), RangeError);
  });
});
