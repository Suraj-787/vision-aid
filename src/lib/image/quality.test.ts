import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  analyzeImageQuality,
  DEFAULT_QUALITY_THRESHOLDS,
  describeQuality,
  QUALITY_MESSAGES,
} from "./quality.ts";

const W = 64;
const H = 64;

/** Builds an opaque RGBA image from a luminance function. */
function image(fn: (x: number, y: number) => number, w = W, h = H): Uint8ClampedArray {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const v = fn(x, y);
      const i = (y * w + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = v;
      data[i + 3] = 255;
    }
  }
  return data;
}

const checker = (x: number, y: number) => ((Math.floor(x / 4) + Math.floor(y / 4)) % 2 ? 200 : 60);

/** Repeated box blur of a luminance image. */
function blur(gray: Uint8ClampedArray, passes: number, w = W, h = H): Uint8ClampedArray {
  let cur = Float32Array.from({ length: w * h }, (_, i) => gray[i * 4]);
  for (let p = 0; p < passes; p++) {
    const next = new Float32Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let s = 0;
        let n = 0;
        for (let dy = -2; dy <= 2; dy++) {
          for (let dx = -2; dx <= 2; dx++) {
            const xx = x + dx;
            const yy = y + dy;
            if (xx >= 0 && xx < w && yy >= 0 && yy < h) {
              s += cur[yy * w + xx];
              n++;
            }
          }
        }
        next[y * w + x] = s / n;
      }
    }
    cur = next;
  }
  return image((x, y) => cur[y * w + x]);
}

describe("analyzeImageQuality", () => {
  it("flags a black image as too dark (and not blurry)", () => {
    const r = analyzeImageQuality(image(() => 0), W, H);
    assert.deepEqual(r.issues, ["too_dark"]);
    assert.equal(r.meanLuminance, 0);
  });

  it("flags a dim but textured image as too dark", () => {
    const r = analyzeImageQuality(image((x, y) => (checker(x, y) > 100 ? 30 : 10)), W, H);
    assert.ok(r.issues.includes("too_dark"));
  });

  it("flags a white image as too bright (and not blurry)", () => {
    const r = analyzeImageQuality(image(() => 255), W, H);
    assert.deepEqual(r.issues, ["too_bright"]);
  });

  it("accepts a well-exposed, sharp, textured image", () => {
    const r = analyzeImageQuality(image(checker), W, H);
    assert.deepEqual(r.issues, []);
    assert.ok(r.sharpness !== null && r.sharpness > DEFAULT_QUALITY_THRESHOLDS.blurVariance);
  });

  it("flags a heavily blurred image as blurry", () => {
    const sharp = analyzeImageQuality(image(checker), W, H);
    const blurred = analyzeImageQuality(blur(image(checker), 6), W, H);
    assert.ok(blurred.sharpness !== null && sharp.sharpness !== null);
    assert.ok(blurred.sharpness < sharp.sharpness / 10, "blur must reduce sharpness a lot");
    assert.deepEqual(blurred.issues, ["blurry"]);
  });

  it("flags a flat mid-grey image as lacking detail (advisory)", () => {
    const r = analyzeImageQuality(image(() => 128), W, H);
    assert.deepEqual(r.issues, ["blurry"]);
  });

  it("reports sharpness as null for images smaller than 3x3 and does not flag blur", () => {
    const r = analyzeImageQuality(image(() => 128, 2, 2), 2, 2);
    assert.equal(r.sharpness, null);
    assert.deepEqual(r.issues, []);
  });

  it("uses custom thresholds", () => {
    const strict = { ...DEFAULT_QUALITY_THRESHOLDS, darkMean: 200 };
    assert.ok(analyzeImageQuality(image(() => 128), W, H, strict).issues.includes("too_dark"));
  });

  it("rejects malformed input", () => {
    assert.throws(() => analyzeImageQuality(new Uint8ClampedArray(10), W, H), RangeError);
    assert.throws(() => analyzeImageQuality(image(() => 0), 0, H), RangeError);
    assert.throws(() => analyzeImageQuality(image(() => 0), 1.5, H), RangeError);
  });

  it("never throws or returns NaN on a valid image", () => {
    const r = analyzeImageQuality(image((x, y) => (x * 7 + y * 13) % 256), W, H);
    assert.ok(Number.isFinite(r.meanLuminance));
    assert.ok(r.sharpness !== null && Number.isFinite(r.sharpness));
  });
});

describe("describeQuality", () => {
  it("returns advisory messages, not rejections", () => {
    const [msg] = describeQuality(analyzeImageQuality(image(() => 0), W, H));
    assert.equal(
      msg,
      "Image looks too dark. Please improve the lighting and try again.",
    );
    for (const m of Object.values(QUALITY_MESSAGES)) {
      assert.doesNotMatch(m, /reject|cannot use|not allowed/i);
    }
  });

  it("returns nothing for a good image", () => {
    assert.deepEqual(describeQuality(analyzeImageQuality(image(checker), W, H)), []);
  });
});
