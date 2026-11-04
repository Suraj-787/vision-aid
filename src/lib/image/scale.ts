export interface Size {
  width: number;
  height: number;
}

/**
 * Largest size that fits within `maxDimension` on its longest side, keeping the
 * aspect ratio. Never upscales. Pure function (no DOM) so it can be unit-tested.
 */
export function fitWithin(width: number, height: number, maxDimension: number): Size {
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    !Number.isFinite(maxDimension) ||
    width <= 0 ||
    height <= 0 ||
    maxDimension <= 0
  ) {
    throw new RangeError("width, height and maxDimension must be positive finite numbers");
  }

  const longest = Math.max(width, height);
  if (longest <= maxDimension) {
    return { width: Math.round(width), height: Math.round(height) };
  }

  const scale = maxDimension / longest;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}
