/**
 * The validated answer shape. Used twice: the server validates the model's JSON
 * with it before replying, and the browser validates the server's reply, so
 * arbitrary content can never reach the answer view. Pure; no imports.
 */

export interface AskResult {
  /** Clear, concise answer to the user's question. */
  answer: string;
  /** Additional relevant visual details, or null. */
  details: string | null;
  /** What is unclear or uncertain, or null. */
  uncertainty: string | null;
  /** Legible text read from the image, or null. */
  printed_text: string | null;
  /** Visible printed instructions reproduced faithfully (never advice), or null. */
  printed_instructions: string | null;
}

/**
 * Maximum lengths (characters). The Gemini API does NOT enforce `maxLength`
 * (it strips it), so VisionAid enforces these itself.
 */
export const ASK_RESULT_LIMITS = {
  answer: 2000,
  details: 4000,
  uncertainty: 1000,
  printed_text: 8000,
  printed_instructions: 4000,
} as const;

export const ASK_RESULT_KEYS = [
  "answer",
  "details",
  "uncertainty",
  "printed_text",
  "printed_instructions",
] as const;

type OptionalKey = Exclude<(typeof ASK_RESULT_KEYS)[number], "answer">;
const OPTIONAL_KEYS: readonly OptionalKey[] = [
  "details",
  "uncertainty",
  "printed_text",
  "printed_instructions",
];

/**
 * Strictly validates an unknown value. Returns null unless every field is
 * present with the right type and within its limit. `answer` must be non-empty;
 * optional fields must be a string or null (blank strings become null). Unknown
 * extra fields are dropped.
 */
export function parseAskResult(value: unknown): AskResult | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;

  const answer = record.answer;
  if (typeof answer !== "string") return null;
  const trimmedAnswer = answer.trim();
  if (trimmedAnswer === "" || trimmedAnswer.length > ASK_RESULT_LIMITS.answer) return null;

  const result: AskResult = {
    answer: trimmedAnswer,
    details: null,
    uncertainty: null,
    printed_text: null,
    printed_instructions: null,
  };

  for (const key of OPTIONAL_KEYS) {
    if (!(key in record)) return null; // incomplete: the schema requires every field
    const field = record[key];
    if (field === null) continue;
    if (typeof field !== "string") return null;
    const trimmed = field.trim();
    if (trimmed.length > ASK_RESULT_LIMITS[key]) return null;
    result[key] = trimmed === "" ? null : trimmed;
  }

  return result;
}

export type ModelTextResult =
  | { ok: true; result: AskResult }
  | { ok: false; reason: "empty" | "not_json" | "invalid_shape" };

/** Parses the model's text output (expected to be a JSON object) and validates it. */
export function parseModelText(text: string | null | undefined): ModelTextResult {
  if (typeof text !== "string" || text.trim() === "") return { ok: false, reason: "empty" };
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { ok: false, reason: "not_json" };
  }
  const result = parseAskResult(json);
  return result ? { ok: true, result } : { ok: false, reason: "invalid_shape" };
}
