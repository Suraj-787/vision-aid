import { MAX_IMAGE_BYTES } from "@/lib/ask/ask-api";

/**
 * Largest JPEG the browser will try to send. The server accepts up to
 * MAX_IMAGE_BYTES; staying a little under it means a busy scene that compresses
 * badly is re-encoded here instead of being rejected after the upload.
 */
export const MAX_SEND_IMAGE_BYTES = Math.floor(MAX_IMAGE_BYTES * 0.9);

/** The JPEG qualities to try, best first, never below 0.4 (text becomes unreadable). */
export function qualitySteps(start: number): number[] {
  const first = Math.min(0.95, Math.max(0.4, start));
  const steps = [first, first - 0.15, first - 0.3].map((q) => Math.round(Math.max(0.4, q) * 100) / 100);
  return [...new Set(steps)];
}

/**
 * Encodes at the best quality whose result fits `maxBytes`. Returns null when the
 * encoder fails or even the lowest quality is too large (the caller reports a
 * friendly error); it never returns an image the server would refuse for size.
 */
export async function encodeWithinLimit(
  encode: (quality: number) => Promise<Blob | null>,
  maxBytes: number,
  steps: readonly number[],
): Promise<Blob | null> {
  for (const quality of steps) {
    const blob = await encode(quality);
    if (!blob || blob.size === 0) return null;
    if (blob.size <= maxBytes) return blob;
  }
  return null;
}
