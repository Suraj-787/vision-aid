/**
 * The validated answer that /api/ask returns and the browser displays
 * (Milestone 6). Used twice: the server builds it from the model's output, and
 * the browser validates it again before showing anything, so arbitrary content
 * can never reach the answer view. Pure; no server-only imports.
 *
 * Compatibility: the five Milestone 5 fields (answer, details, uncertainty,
 * printed_text, printed_instructions) keep their names and meaning, so a client
 * that only reads those still works. The rest is additive.
 */
import { parseCurrencyCheck, type CurrencyCheck } from "@/lib/ask/currency";
import { parseExpiryCheck, type ExpiryCheck } from "@/lib/ask/expiry";

export const INTENTS = [
  "scene_description",
  "text_reading",
  "medicine_label",
  "currency_identification",
  "expiry_date",
  "general_question",
  "unknown",
] as const;
export type Intent = (typeof INTENTS)[number];

/** Friendly text for the detected intent. */
export const INTENT_LABELS: Record<Intent, string> = {
  scene_description: "Describing the scene",
  text_reading: "Reading text",
  medicine_label: "Reading a medicine label",
  currency_identification: "Identifying a banknote",
  expiry_date: "Checking an expiry date",
  general_question: "Answering a general question",
  unknown: "Not sure what kind of question this was",
};

/**
 * Qualitative only. It is the model's own rough estimate, not a calibrated
 * probability, and "high" does not mean correct.
 */
export const CONFIDENCES = ["low", "medium", "high"] as const;
export type Confidence = (typeof CONFIDENCES)[number];

export const CONFIDENCE_LABELS: Record<Confidence, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
};

/** Fixed notices the app attaches (by code); the wording lives here, not with the model. */
export const NOTICE_CODES = ["label_only", "currency_limits", "expiry_limits"] as const;
export type NoticeCode = (typeof NOTICE_CODES)[number];

export const NOTICE_TEXT: Record<NoticeCode, string> = {
  label_only:
    "This is only what is printed. VisionAid does not give medical advice or dosing guidance. Ask a pharmacist or doctor how to use any medicine.",
  currency_limits:
    "VisionAid only reports what a note appears to be. It cannot tell whether a note is genuine or counterfeit.",
  expiry_limits:
    "This only compares the printed date with today's date. It does not tell you whether the product is safe or still works.",
};

/** Things the app changed in the AI's reply, by code. Shown so the change is not silent. */
export const ADJUSTMENT_CODES = [
  "navigation_claim_removed",
  "medical_advice_removed",
  "authenticity_claim_removed",
  "expiry_safety_claim_removed",
  "expiry_conclusion_replaced",
  "currency_conclusion_replaced",
] as const;
export type AdjustmentCode = (typeof ADJUSTMENT_CODES)[number];

export const ADJUSTMENT_TEXT: Record<AdjustmentCode, string> = {
  navigation_claim_removed:
    "Part of the AI's reply was removed because it made a claim about whether a place is safe or clear, which VisionAid cannot judge.",
  medical_advice_removed:
    "Part of the AI's reply was removed because it sounded like medical advice, which VisionAid does not give.",
  authenticity_claim_removed:
    "Part of the AI's reply was removed because it claimed a note was genuine or fake, which VisionAid cannot tell.",
  expiry_safety_claim_removed:
    "Part of the AI's reply was removed because it said whether a product is safe to use, which VisionAid cannot judge.",
  expiry_conclusion_replaced:
    "The AI's statement about whether the product has expired was replaced by VisionAid's own date check.",
  currency_conclusion_replaced:
    "The AI's statement about the note's value was replaced because the photo did not support it strongly enough.",
};

export interface AskResult {
  intent: Intent;
  /** Clear, concise answer to the user's question. */
  answer: string;
  /** Additional relevant visual details, or null. */
  details: string | null;
  /** What is unclear or uncertain, or null. */
  uncertainty: string | null;
  confidence: Confidence;
  /** Legible text read from the image, copied as printed, or null. */
  printed_text: string | null;
  /** Visible printed instructions reproduced faithfully (never advice), or null. */
  printed_instructions: string | null;
  /** Banknote result, present only when the question involved a note. */
  currency_check: CurrencyCheck | null;
  /** Deterministic expiry result, present only when a date was involved. */
  expiry_check: ExpiryCheck | null;
  notices: NoticeCode[];
  adjustments: AdjustmentCode[];
}

/** Maximum lengths (characters). The Gemini API does not enforce `maxLength`, so we do. */
export const ASK_RESULT_LIMITS = {
  answer: 3500,
  details: 4000,
  uncertainty: 1200,
  printed_text: 8000,
  printed_instructions: 4000,
} as const;

type TextKey = "details" | "uncertainty" | "printed_text" | "printed_instructions";
const OPTIONAL_TEXT_KEYS: readonly TextKey[] = ["details", "uncertainty", "printed_text", "printed_instructions"];

function oneOf<T extends string>(list: readonly T[], value: unknown): value is T {
  return typeof value === "string" && (list as readonly string[]).includes(value);
}

function codeList<T extends string>(list: readonly T[], value: unknown, max: number): T[] | null {
  if (!Array.isArray(value) || value.length > max) return null;
  const out: T[] = [];
  for (const item of value) {
    if (!oneOf(list, item)) return null;
    if (!out.includes(item)) out.push(item);
  }
  return out;
}

/**
 * Strictly validates an unknown value as an AskResult. Returns null unless every
 * field is present with the right type, an allowed value and a permitted length.
 * Unknown extra fields are dropped. `answer` must be non-empty; the optional
 * text fields must be a string or null (blank strings become null).
 */
export function parseAskResult(value: unknown): AskResult | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const r = value as Record<string, unknown>;

  if (!oneOf(INTENTS, r.intent)) return null;
  if (!oneOf(CONFIDENCES, r.confidence)) return null;

  if (typeof r.answer !== "string") return null;
  const answer = r.answer.trim();
  if (answer === "" || answer.length > ASK_RESULT_LIMITS.answer) return null;

  const text: Record<TextKey, string | null> = {
    details: null,
    uncertainty: null,
    printed_text: null,
    printed_instructions: null,
  };
  for (const key of OPTIONAL_TEXT_KEYS) {
    if (!(key in r)) return null; // incomplete: every field is required
    const field = r[key];
    if (field === null) continue;
    if (typeof field !== "string") return null;
    const trimmed = field.trim();
    if (trimmed.length > ASK_RESULT_LIMITS[key]) return null;
    text[key] = trimmed === "" ? null : trimmed;
  }

  let currency_check: CurrencyCheck | null = null;
  if (r.currency_check !== null) {
    currency_check = parseCurrencyCheck(r.currency_check);
    if (!currency_check) return null;
  }
  let expiry_check: ExpiryCheck | null = null;
  if (r.expiry_check !== null) {
    expiry_check = parseExpiryCheck(r.expiry_check);
    if (!expiry_check) return null;
  }
  if (r.currency_check === undefined || r.expiry_check === undefined) return null;

  const notices = codeList(NOTICE_CODES, r.notices, NOTICE_CODES.length);
  const adjustments = codeList(ADJUSTMENT_CODES, r.adjustments, ADJUSTMENT_CODES.length);
  if (!notices || !adjustments) return null;

  return {
    intent: r.intent,
    answer,
    ...text,
    confidence: r.confidence,
    currency_check,
    expiry_check,
    notices,
    adjustments,
  };
}
