import {
  MAX_IMAGE_BYTES,
  MAX_IMAGE_DIMENSION,
  MAX_QUESTION_LENGTH,
  MAX_REQUEST_BODY_BYTES,
  type AskServerErrorCode,
} from "@/lib/ask/ask-api";

/**
 * Request validation for POST /api/ask. Pure (no secrets, no network) so it is
 * fully unit-testable. Nothing here logs or echoes request content.
 */

export interface ValidAskRequest {
  /** Raw base64 (no data-URL prefix) of a verified JPEG. */
  imageBase64: string;
  /** Trimmed, non-empty, within the length limit. */
  question: string;
  imageBytes: number;
}

export type ValidationResult =
  | { ok: true; value: ValidAskRequest }
  | { ok: false; code: AskServerErrorCode };

const BASE64_PATTERN = /^[A-Za-z0-9+/]*={0,2}$/;
const DATA_URL_PATTERN = /^data:([^;,]*)((?:;[^;,]*)*),/i;

export function isJsonContentType(contentType: string | null): boolean {
  return /^application\/json(\s*;|$)/i.test(contentType ?? "");
}

/**
 * Reads the request body as text without ever holding more than `maxBytes`
 * (the Content-Length header alone is not trusted: chunked bodies have none).
 */
export async function readBodyLimited(
  request: Request,
  maxBytes: number = MAX_REQUEST_BODY_BYTES,
): Promise<{ ok: true; text: string } | { ok: false; code: AskServerErrorCode }> {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    return { ok: false, code: "PAYLOAD_TOO_LARGE" };
  }
  if (!request.body) return { ok: true, text: "" };

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => {});
        return { ok: false, code: "PAYLOAD_TOO_LARGE" };
      }
      chunks.push(value);
    }
  } catch {
    return { ok: false, code: "INVALID_REQUEST" };
  }
  return { ok: true, text: Buffer.concat(chunks).toString("utf8") };
}

export function validateAskRequest(rawBody: string): ValidationResult {
  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return { ok: false, code: "INVALID_JSON" };
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { ok: false, code: "INVALID_REQUEST" };
  }
  const record = body as Record<string, unknown>;
  // Strict: callers cannot pass anything (model, config, ...) other than these two fields.
  if (Object.keys(record).some((key) => key !== "image" && key !== "question")) {
    return { ok: false, code: "INVALID_REQUEST" };
  }

  // ---- question
  const questionRaw = record.question;
  if (questionRaw === undefined || questionRaw === null) return { ok: false, code: "MISSING_QUESTION" };
  if (typeof questionRaw !== "string") return { ok: false, code: "INVALID_REQUEST" };
  const question = questionRaw.trim();
  if (question === "") return { ok: false, code: "MISSING_QUESTION" };
  if (question.length > MAX_QUESTION_LENGTH) return { ok: false, code: "QUESTION_TOO_LONG" };

  // ---- image
  const imageRaw = record.image;
  if (imageRaw === undefined || imageRaw === null || imageRaw === "") {
    return { ok: false, code: "MISSING_IMAGE" };
  }
  if (typeof imageRaw !== "string") return { ok: false, code: "INVALID_REQUEST" };

  let base64 = imageRaw;
  const dataUrl = DATA_URL_PATTERN.exec(imageRaw);
  if (dataUrl) {
    // A declared MIME type is checked, but never trusted on its own (see magic-byte check).
    const mime = dataUrl[1].toLowerCase();
    const params = dataUrl[2].toLowerCase();
    if (mime !== "image/jpeg" && mime !== "image/jpg") {
      return { ok: false, code: "UNSUPPORTED_IMAGE_FORMAT" };
    }
    if (!params.includes(";base64")) return { ok: false, code: "INVALID_IMAGE" };
    base64 = imageRaw.slice(dataUrl[0].length);
  }
  if (base64 === "") return { ok: false, code: "MISSING_IMAGE" };

  if (base64.length % 4 !== 0 || !BASE64_PATTERN.test(base64)) {
    return { ok: false, code: "INVALID_IMAGE" };
  }
  // Check the size before decoding so a huge string never gets allocated twice.
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  const estimatedBytes = (base64.length / 4) * 3 - padding;
  if (estimatedBytes > MAX_IMAGE_BYTES) return { ok: false, code: "IMAGE_TOO_LARGE" };

  const bytes = Buffer.from(base64, "base64");
  const jpeg = checkJpeg(bytes);
  if (!jpeg.ok) return { ok: false, code: jpeg.code };

  return { ok: true, value: { imageBase64: base64, question, imageBytes: bytes.length } };
}

type JpegCheck = { ok: true; width: number; height: number } | { ok: false; code: AskServerErrorCode };

/**
 * Verifies the decoded bytes really are a JPEG: SOI marker, EOI marker at the
 * end, and a frame header with sane dimensions. Not a full decode, but enough to
 * reject other formats, truncated files and arbitrary bytes labelled as JPEG.
 */
export function checkJpeg(bytes: Uint8Array): JpegCheck {
  if (bytes.length < 4) return { ok: false, code: "INVALID_IMAGE" };

  const isJpegStart = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (!isJpegStart) {
    const known =
      (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) || // PNG
      (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) || // GIF
      (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46) || // RIFF (WEBP)
      (bytes[0] === 0x42 && bytes[1] === 0x4d); // BMP
    return { ok: false, code: known ? "UNSUPPORTED_IMAGE_FORMAT" : "INVALID_IMAGE" };
  }
  if (bytes[bytes.length - 2] !== 0xff || bytes[bytes.length - 1] !== 0xd9) {
    return { ok: false, code: "INVALID_IMAGE" }; // truncated or corrupt
  }

  // Walk the marker segments up to the first start-of-frame to read the dimensions.
  let i = 2;
  while (i + 3 < bytes.length) {
    if (bytes[i] !== 0xff) return { ok: false, code: "INVALID_IMAGE" };
    while (bytes[i] === 0xff && i + 1 < bytes.length) i++; // fill bytes
    const marker = bytes[i++];
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue; // no length
    if (marker === 0xd9 || marker === 0xda) break; // end of image / start of scan before any frame header
    if (i + 1 >= bytes.length) break;
    const length = (bytes[i] << 8) | bytes[i + 1];
    if (length < 2) return { ok: false, code: "INVALID_IMAGE" };
    const isFrameHeader =
      marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isFrameHeader) {
      if (i + 6 >= bytes.length) return { ok: false, code: "INVALID_IMAGE" };
      const height = (bytes[i + 3] << 8) | bytes[i + 4];
      const width = (bytes[i + 5] << 8) | bytes[i + 6];
      if (width === 0 || height === 0) return { ok: false, code: "INVALID_IMAGE" };
      if (width > MAX_IMAGE_DIMENSION || height > MAX_IMAGE_DIMENSION) {
        return { ok: false, code: "IMAGE_TOO_LARGE" };
      }
      return { ok: true, width, height };
    }
    i += length;
  }
  return { ok: false, code: "INVALID_IMAGE" };
}
