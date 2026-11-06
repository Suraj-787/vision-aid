/**
 * Validation of the JSON the Gemini model returns (Milestone 6). This is the
 * model's raw claim, not yet the answer shown to the user: post-processing turns
 * it into an AskResult. Pure; no imports from server-only code.
 *
 * Policy: a missing field, a wrong type, a value outside an allowed list (intent,
 * confidence, expiry kind) or an over-long string rejects the WHOLE response, so
 * the user gets a clear "unusable answer, try again" instead of partial data.
 * Unknown extra fields are dropped. A banknote value that is a number but not a
 * supported denomination is NOT a shape error: it is passed on and rejected by
 * the currency check, which explains it to the user.
 */
import { EXPIRY_KINDS, type ExpiryKind } from "@/lib/ask/expiry";
import { CONFIDENCES, INTENTS, type Confidence, type Intent } from "@/lib/ask/ask-result";

export const MODEL_LIMITS = {
  answer: 2000,
  details: 4000,
  uncertainty: 1000,
  printed_text: 8000,
  printed_instructions: 4000,
  currency_evidence: 500,
  currency_code: 24,
  date: 120,
  date_text: 400,
} as const;

export interface ModelOutput {
  intent: Intent;
  answer: string;
  details: string | null;
  uncertainty: string | null;
  confidence: Confidence;
  printed_text: string | null;
  printed_instructions: string | null;
  currency: { denomination: number | null; currency: string | null; evidence: string | null };
  expiry: {
    expiry_date: string | null;
    expiry_kind: ExpiryKind | null;
    manufacturing_date: string | null;
    date_text: string | null;
  };
}

const FAIL = Symbol("invalid");
type Fail = typeof FAIL;

/** string|null within `max` characters; blank becomes null. FAIL if absent, wrong type or too long. */
function text(record: Record<string, unknown>, key: string, max: number): string | null | Fail {
  if (!(key in record)) return FAIL;
  const v = record[key];
  if (v === null) return null;
  if (typeof v !== "string") return FAIL;
  const t = v.trim();
  if (t.length > max) return FAIL;
  return t === "" ? null : t;
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

export function parseModelOutput(value: unknown): ModelOutput | null {
  const r = asRecord(value);
  if (!r) return null;

  const intent = r.intent;
  if (typeof intent !== "string" || !(INTENTS as readonly string[]).includes(intent)) return null;
  const confidence = r.confidence;
  if (typeof confidence !== "string" || !(CONFIDENCES as readonly string[]).includes(confidence)) return null;

  if (typeof r.answer !== "string") return null;
  const answer = r.answer.trim();
  if (answer === "" || answer.length > MODEL_LIMITS.answer) return null;

  const details = text(r, "details", MODEL_LIMITS.details);
  const uncertainty = text(r, "uncertainty", MODEL_LIMITS.uncertainty);
  const printed_text = text(r, "printed_text", MODEL_LIMITS.printed_text);
  const printed_instructions = text(r, "printed_instructions", MODEL_LIMITS.printed_instructions);
  if ([details, uncertainty, printed_text, printed_instructions].includes(FAIL as never)) return null;

  // currency: an object (an all-null object, or null, means "not a banknote question")
  if (!("currency" in r) || !("expiry" in r)) return null;
  const currencyRaw = r.currency === null ? { denomination: null, currency: null, evidence: null } : asRecord(r.currency);
  const expiryRaw =
    r.expiry === null
      ? { expiry_date: null, expiry_kind: null, manufacturing_date: null, date_text: null }
      : asRecord(r.expiry);
  if (!currencyRaw || !expiryRaw) return null;

  if (!("denomination" in currencyRaw)) return null;
  const denomination = currencyRaw.denomination;
  if (denomination !== null && (typeof denomination !== "number" || !Number.isFinite(denomination))) return null;
  const currencyCode = text(currencyRaw, "currency", MODEL_LIMITS.currency_code);
  const evidence = text(currencyRaw, "evidence", MODEL_LIMITS.currency_evidence);
  if (currencyCode === FAIL || evidence === FAIL) return null;

  const expiry_date = text(expiryRaw, "expiry_date", MODEL_LIMITS.date);
  const manufacturing_date = text(expiryRaw, "manufacturing_date", MODEL_LIMITS.date);
  const date_text = text(expiryRaw, "date_text", MODEL_LIMITS.date_text);
  if (expiry_date === FAIL || manufacturing_date === FAIL || date_text === FAIL) return null;
  if (!("expiry_kind" in expiryRaw)) return null;
  const kind = expiryRaw.expiry_kind;
  if (kind !== null && (typeof kind !== "string" || !(EXPIRY_KINDS as readonly string[]).includes(kind))) return null;

  return {
    intent: intent as Intent,
    answer,
    details: details as string | null,
    uncertainty: uncertainty as string | null,
    confidence: confidence as Confidence,
    printed_text: printed_text as string | null,
    printed_instructions: printed_instructions as string | null,
    currency: { denomination: denomination as number | null, currency: currencyCode, evidence },
    expiry: { expiry_date, expiry_kind: kind as ExpiryKind | null, manufacturing_date, date_text },
  };
}

export type ModelTextResult =
  | { ok: true; output: ModelOutput }
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
  const output = parseModelOutput(json);
  return output ? { ok: true, output } : { ok: false, reason: "invalid_shape" };
}
