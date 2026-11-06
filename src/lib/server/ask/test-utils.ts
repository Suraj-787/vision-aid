/** Helpers for the /api/ask unit tests only. Not imported by application code. */

/**
 * Builds a tiny but structurally valid JPEG: SOI, a frame header (SOF0) with the
 * given dimensions, a start-of-scan header, a few entropy bytes and EOI. It is not
 * decodable as a picture, but it satisfies the server's JPEG checks.
 */
export function makeJpeg({ width = 64, height = 48, padding = 0 } = {}): Uint8Array {
  const sof = [
    0xff, 0xc0, 0x00, 0x11, 0x08,
    height >> 8, height & 0xff, width >> 8, width & 0xff,
    0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01,
  ];
  const sos = [0xff, 0xda, 0x00, 0x0c, 0x03, 0x01, 0x00, 0x02, 0x11, 0x03, 0x11, 0x00, 0x3f, 0x00];
  const body = [0x12, 0x34, 0x56, 0x78, ...new Array(padding).fill(0x11)];
  return Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, ...sof, ...sos, ...body, 0xff, 0xd9]);
}

export const toBase64 = (bytes: Uint8Array): string => Buffer.from(bytes).toString("base64");

export const PNG_BYTES = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

/** A valid structured reply from the model (what Gemini returns). */
export const VALID_MODEL_OUTPUT = {
  intent: "text_reading",
  answer: "I can see a white box with a printed label.",
  details: "The box is on a wooden table.",
  uncertainty: null,
  confidence: "high",
  printed_text: "Paracetamol 500 mg",
  printed_instructions: null,
  currency: { denomination: null, currency: null, evidence: null },
  expiry: { expiry_date: null, expiry_kind: null, manufacturing_date: null, date_text: null },
};

/** What /api/ask returns for VALID_MODEL_OUTPUT after post-processing. */
export const VALID_ANSWER = {
  intent: "text_reading",
  answer: "I can see a white box with a printed label.",
  details: "The box is on a wooden table.",
  uncertainty: null,
  confidence: "high",
  printed_text: "Paracetamol 500 mg",
  printed_instructions: null,
  currency_check: null,
  expiry_check: null,
  notices: [],
  adjustments: [],
};

/** VALID_MODEL_OUTPUT with some fields replaced (shallow, with nested currency/expiry merged). */
export function modelOutput(
  overrides: Record<string, unknown> & {
    currency?: Record<string, unknown>;
    expiry?: Record<string, unknown>;
  } = {},
) {
  const { currency, expiry, ...rest } = overrides;
  return {
    ...VALID_MODEL_OUTPUT,
    ...rest,
    currency: { ...VALID_MODEL_OUTPUT.currency, ...currency },
    expiry: { ...VALID_MODEL_OUTPUT.expiry, ...expiry },
  };
}

export function askRequest(
  body: unknown,
  options: { origin?: string | null; contentType?: string | null; headers?: Record<string, string> } = {},
): Request {
  const headers: Record<string, string> = { host: "localhost:3000", ...options.headers };
  if (options.origin !== null) headers.origin = options.origin ?? "http://localhost:3000";
  if (options.contentType !== null) headers["content-type"] = options.contentType ?? "application/json";
  return new Request("http://localhost:3000/api/ask", {
    method: "POST",
    headers,
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}
