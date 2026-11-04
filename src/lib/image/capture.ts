import { fitWithin } from "@/lib/image/scale";
import { analyzeImageQuality, type QualityReport } from "@/lib/image/quality";

export interface CaptureOptions {
  /** Longest side of the output image in pixels. Never upscales. */
  maxDimension: number;
  /** JPEG quality 0-1. */
  jpegQuality: number;
  /** Longest side of the small copy used for brightness/blur analysis. */
  analysisDimension: number;
}

/** Starting points; tuned on real devices in Milestone 8. */
export const DEFAULT_CAPTURE_OPTIONS: CaptureOptions = {
  maxDimension: 768,
  jpegQuality: 0.8,
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
  canvas.width = size.width;
  canvas.height = size.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    releaseCanvas(canvas);
    throw new CaptureError("unsupported");
  }
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(video, 0, 0, size.width, size.height);

  let quality: QualityReport;
  const small = document.createElement("canvas");
  try {
    const analysisSize = fitWithin(size.width, size.height, opts.analysisDimension);
    small.width = analysisSize.width;
    small.height = analysisSize.height;
    const sctx = small.getContext("2d", { willReadFrequently: true });
    if (!sctx) throw new CaptureError("unsupported");
    sctx.drawImage(canvas, 0, 0, analysisSize.width, analysisSize.height);
    const pixels = sctx.getImageData(0, 0, analysisSize.width, analysisSize.height);
    quality = analyzeImageQuality(pixels.data, analysisSize.width, analysisSize.height);
  } finally {
    releaseCanvas(small);
  }

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", opts.jpegQuality),
  );
  releaseCanvas(canvas);
  if (!blob) throw new CaptureError("encode-failed");

  return {
    blob,
    url: URL.createObjectURL(blob),
    width: size.width,
    height: size.height,
    bytes: blob.size,
    quality,
  };
}

export function toCaptureError(err: unknown): { kind: CaptureErrorKind; message: string } {
  if (err instanceof CaptureError) return { kind: err.kind, message: err.userMessage };
  return { kind: "encode-failed", message: CAPTURE_MESSAGES["encode-failed"] };
}
