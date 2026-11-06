import { fitWithin, type Size } from "@/lib/image/scale";
import { encodeWithinLimit, MAX_SEND_IMAGE_BYTES, qualitySteps } from "@/lib/image/encode";
import { analyzeImageQuality, unknownQualityReport, type QualityReport } from "@/lib/image/quality";

export interface CaptureOptions {
  /** Longest side of the output image in pixels. Never upscales. */
  maxDimension: number;
  /** JPEG quality 0-1. */
  jpegQuality: number;
  /** Longest side of the small copy used for brightness/blur analysis. */
  analysisDimension: number;
}

/**
 * Chosen for readable small print (expiry dates, medicine labels) while staying
 * far below the server's 2 MB limit: a 1280 px photo is typically a few hundred
 * KB. Gemini bills images in 768 px tiles, so this costs about four tiles. These
 * values are reasoned, not calibrated on physical devices (see the checklist).
 */
export const DEFAULT_CAPTURE_OPTIONS: CaptureOptions = {
  maxDimension: 1280,
  jpegQuality: 0.85,
  analysisDimension: 256,
};

export interface CapturedImage {
  /** JPEG bytes, kept in memory only. */
  blob: Blob;
  /** Object URL for previewing the blob. The owner must revoke it. */
  url: string;
  width: number;
  height: number;
  bytes: number;
  quality: QualityReport;
}

export type CaptureErrorKind = "camera-not-ready" | "unsupported" | "encode-failed";

const CAPTURE_MESSAGES: Record<CaptureErrorKind, string> = {
  "camera-not-ready":
    "The camera is not ready yet. Wait for the preview to appear, then try again.",
  unsupported: "This browser cannot take a photo from the camera preview.",
  "encode-failed": "The photo could not be prepared. Please try again.",
};

export class CaptureError extends Error {
  readonly kind: CaptureErrorKind;
  constructor(kind: CaptureErrorKind) {
    super(kind);
    this.name = "CaptureError";
    this.kind = kind;
  }
  get userMessage(): string {
    return CAPTURE_MESSAGES[this.kind];
  }
}

function releaseCanvas(canvas: HTMLCanvasElement) {
  // Setting the size to 0 frees the bitmap backing store immediately.
  canvas.width = 0;
  canvas.height = 0;
}

/**
 * Captures ONE still from a playing <video>: downscaled in a single draw,
 * quality-analysed on a small copy, then JPEG-encoded. Nothing is uploaded,
 * stored or logged; canvases are released before returning.
 */
export async function captureStill(
  video: HTMLVideoElement,
  options: Partial<CaptureOptions> = {},
): Promise<CapturedImage> {
  const opts = { ...DEFAULT_CAPTURE_OPTIONS, ...options };

  const sourceWidth = video.videoWidth;
  const sourceHeight = video.videoHeight;
  // HAVE_CURRENT_DATA (2): a frame is available to draw.
  if (video.readyState < 2 || !sourceWidth || !sourceHeight) {
    throw new CaptureError("camera-not-ready");
  }

  const size = fitWithin(sourceWidth, sourceHeight, opts.maxDimension);
  const canvas = document.createElement("canvas");
  try {
    canvas.width = size.width;
    canvas.height = size.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new CaptureError("unsupported");
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(video, 0, 0, size.width, size.height);

    const quality = analyseQuality(canvas, size, opts.analysisDimension);

    // Re-encodes at a lower quality if the first JPEG is too large to send.
    const blob = await encodeWithinLimit(
      (q) => new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", q)),
      MAX_SEND_IMAGE_BYTES,
      qualitySteps(opts.jpegQuality),
    );
    if (!blob) throw new CaptureError("encode-failed");

    return {
      blob,
      url: URL.createObjectURL(blob),
      width: size.width,
      height: size.height,
      bytes: blob.size,
      quality,
    };
  } finally {
    releaseCanvas(canvas); // also on every error path
  }
}

/**
 * Advisory brightness/blur analysis on a small copy. It is best-effort: if the
 * browser cannot read canvas pixels (privacy modes block or alter it) the photo
 * is still usable, so a failure here must never fail the capture.
 */
function analyseQuality(canvas: HTMLCanvasElement, size: Size, analysisDimension: number): QualityReport {
  const small = document.createElement("canvas");
  try {
    const analysisSize = fitWithin(size.width, size.height, analysisDimension);
    small.width = analysisSize.width;
    small.height = analysisSize.height;
    const sctx = small.getContext("2d", { willReadFrequently: true });
    if (!sctx) return unknownQualityReport();
    sctx.drawImage(canvas, 0, 0, analysisSize.width, analysisSize.height);
    const pixels = sctx.getImageData(0, 0, analysisSize.width, analysisSize.height);
    return analyzeImageQuality(pixels.data, analysisSize.width, analysisSize.height);
  } catch {
    return unknownQualityReport();
  } finally {
    releaseCanvas(small);
  }
}

export function toCaptureError(err: unknown): { kind: CaptureErrorKind; message: string } {
  if (err instanceof CaptureError) return { kind: err.kind, message: err.userMessage };
  return { kind: "encode-failed", message: CAPTURE_MESSAGES["encode-failed"] };
}
