/**
 * Advisory image-quality checks (brightness and blur) on RGBA pixel data.
 *
 * These are heuristics, not guarantees: the thresholds are uncalibrated
 * starting points (to be tuned on real devices in Milestone 8). They only ever
 * produce *advice* for the user — callers must not reject an image because of
 * them. Pure functions with no DOM access so they can be unit-tested in Node.
 */

export type QualityIssue = "too_dark" | "too_bright" | "blurry";

export interface QualityThresholds {
  /** Mean luminance (0-255) below which the image is "too dark". */
  darkMean: number;
  /** Luminance below which a pixel counts as near-black. */
  darkPixelLevel: number;
  /** Fraction of near-black pixels at or above which the image is "too dark". */
  darkPixelFraction: number;
  /** Mean luminance above which the image is "too bright". */
  brightMean: number;
  /** Luminance above which a pixel counts as blown out. */
  brightPixelLevel: number;
  /** Fraction of blown-out pixels at or above which the image is "too bright". */
  brightPixelFraction: number;
  /** Variance of the Laplacian below which the image "may be blurry". */
  blurVariance: number;
}

export const DEFAULT_QUALITY_THRESHOLDS: QualityThresholds = {
  darkMean: 40,
  darkPixelLevel: 30,
  darkPixelFraction: 0.85,
  brightMean: 215,
  brightPixelLevel: 245,
  brightPixelFraction: 0.4,
  blurVariance: 30,
};

export interface QualityReport {
  /** Mean luminance, 0-255. */
  meanLuminance: number;
  darkFraction: number;
  brightFraction: number;
  /** Variance of the Laplacian of the luminance; null if the image is too small. */
  sharpness: number | null;
  issues: QualityIssue[];
}

/** User-facing advice for each issue. Advisory wording: never "rejected". */
export const QUALITY_MESSAGES: Record<QualityIssue, string> = {
  too_dark: "Image looks too dark. Please improve the lighting and try again.",
  too_bright:
    "Image looks very bright or washed out. Try reducing glare or moving away from direct light.",
  blurry:
    "Image may be blurry or have little detail. Hold the phone steady and try again.",
};

export function describeQuality(report: QualityReport): string[] {
  return report.issues.map((issue) => QUALITY_MESSAGES[issue]);
}

/**
 * @param rgba row-major RGBA bytes (e.g. ImageData.data), length >= width*height*4
 */
export function analyzeImageQuality(
  rgba: ArrayLike<number>,
  width: number,
  height: number,
  thresholds: QualityThresholds = DEFAULT_QUALITY_THRESHOLDS,
): QualityReport {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw new RangeError("width and height must be positive integers");
  }
  const pixels = width * height;
  if (rgba.length < pixels * 4) {
    throw new RangeError("rgba is shorter than width * height * 4");
  }

  // Rec. 601 luma.
  const luma = new Float32Array(pixels);
  let sum = 0;
  let dark = 0;
  let bright = 0;
  for (let i = 0; i < pixels; i++) {
    const y = 0.299 * rgba[i * 4] + 0.587 * rgba[i * 4 + 1] + 0.114 * rgba[i * 4 + 2];
    luma[i] = y;
    sum += y;
    if (y < thresholds.darkPixelLevel) dark++;
    if (y > thresholds.brightPixelLevel) bright++;
  }

  const meanLuminance = sum / pixels;
  const darkFraction = dark / pixels;
  const brightFraction = bright / pixels;
  const sharpness = laplacianVariance(luma, width, height);

  const tooDark =
    meanLuminance < thresholds.darkMean || darkFraction >= thresholds.darkPixelFraction;
  const tooBright =
    meanLuminance > thresholds.brightMean || brightFraction >= thresholds.brightPixelFraction;

  const issues: QualityIssue[] = [];
  if (tooDark) issues.push("too_dark");
  if (tooBright) issues.push("too_bright");
  // Sharpness is not meaningful in a very dark or blown-out image, so only
  // report blur when exposure is otherwise acceptable.
  if (!tooDark && !tooBright && sharpness !== null && sharpness < thresholds.blurVariance) {
    issues.push("blurry");
  }

  return { meanLuminance, darkFraction, brightFraction, sharpness, issues };
}

/** Variance of the 3x3 Laplacian response; a standard focus measure. */
function laplacianVariance(luma: Float32Array, width: number, height: number): number | null {
  if (width < 3 || height < 3) return null;

  let sum = 0;
  let sumSq = 0;
  let count = 0;
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      const r = luma[i - width] + luma[i + width] + luma[i - 1] + luma[i + 1] - 4 * luma[i];
      sum += r;
      sumSq += r * r;
      count++;
    }
  }
  const mean = sum / count;
  return sumSq / count - mean * mean;
}
