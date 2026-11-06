/**
 * Indian banknote handling (Milestone 6). The model reports what it sees; this
 * module decides whether that is allowed to be shown as a result.
 *
 * Be clear about the limit: code cannot look at the note. These checks only stop
 * unsupported or inconsistent claims from being presented as confirmed (an
 * unsupported value, no stated evidence, low confidence, or an answer that
 * contradicts the structured result). A wrong reading that passes every check
 * is still possible, so the result is always worded "looks like", and VisionAid
 * never says anything about whether a note is genuine or counterfeit.
 */

export const DENOMINATIONS = [10, 20, 50, 100, 200, 500] as const;
export type Denomination = (typeof DENOMINATIONS)[number];

export type CurrencyStatus = "identified" | "uncertain";
export const CURRENCY_STATUSES: readonly CurrencyStatus[] = ["identified", "uncertain"];

/** What the model reports. */
export interface CurrencyInput {
  denomination: number | null;
  currency: string | null;
  evidence: string | null;
}

export interface CurrencyCheck {
  status: CurrencyStatus;
  /** Set only when status is "identified"; otherwise null (never a guess). */
  denomination: Denomination | null;
  /** Visible features the AI said it relied on, shown with the result. */
  evidence: string | null;
  /** User-facing explanation written by this code, not by the AI. */
  message: string;
}

export const MIN_EVIDENCE_CHARS = 8;

export const CURRENCY_LIMITS_NOTICE =
  "VisionAid only reports what a note appears to be. It cannot tell whether a note is genuine or counterfeit.";

const RETAKE_TIP =
  "Lay the whole note flat, in good light, with the number clearly visible, then take the photo again.";

export function isDenomination(value: unknown): value is Denomination {
  return typeof value === "number" && (DENOMINATIONS as readonly number[]).includes(value);
}

/** Accepts the Indian rupee spelled the ways a model is likely to; anything else is a mismatch. */
export function isIndianRupee(code: string): boolean {
  return /^(inr|₹|rs\.?|rupees?|indian rupees?)$/i.test(code.trim());
}

/**
 * Banknote values mentioned in free text, such as "₹500", "Rs. 100", "INR 20"
 * or "50 rupees". Used to check that the answer sentence agrees with the
 * structured result.
 */
export function mentionedDenominations(text: string): number[] {
  const found = new Set<number>();
  const patterns = [
    /(?:₹|\brs\.?|\binr)\s*(\d{1,4})\b/gi,
    /\b(\d{1,4})\s*(?:rupees?|rs\b|₹|\/-)/gi,
  ];
  for (const re of patterns) {
    for (const m of text.matchAll(re)) found.add(Number(m[1]));
  }
  // "hundred-rupee note", "fifty rupees", "a five hundred rupee note"
  const words: Array<[RegExp, number]> = [
    [/\b(?:ten)[ -]?(?:rupees?|rs\b)/i, 10],
    [/\b(?:twenty)[ -]?(?:rupees?|rs\b)/i, 20],
    [/\b(?:fifty)[ -]?(?:rupees?|rs\b)/i, 50],
    [/\b(?:(?:one|a)\s+)?hundred[ -]?(?:rupees?|rs\b)/i, 100],
    [/\btwo\s+hundred[ -]?(?:rupees?|rs\b)/i, 200],
    [/\bfive\s+hundred[ -]?(?:rupees?|rs\b)/i, 500],
  ];
  for (const [re, value] of words) {
    if (re.test(text)) found.add(value);
  }
  // "two hundred" also matches the plain "hundred" pattern: keep only the longer reading.
  if (found.has(200) || found.has(500)) {
    if (/\b(?:two|five)\s+hundred/i.test(text) && !/\b(?:one\s+|a\s+)hundred/i.test(text)) found.delete(100);
  }
  return [...found];
}

const uncertain = (message: string, evidence: string | null = null): CurrencyCheck => ({
  status: "uncertain",
  denomination: null,
  evidence,
  message,
});

/**
 * Decides whether a banknote reading may be shown as a result.
 * Returns null when the question has nothing to do with currency.
 */
export function checkCurrency(
  input: CurrencyInput,
  context: { confidence: "low" | "medium" | "high"; asksAboutCurrency: boolean; answerText: string },
): CurrencyCheck | null {
  const evidence = typeof input.evidence === "string" && input.evidence.trim() !== "" ? input.evidence.trim() : null;
  const currencyText = typeof input.currency === "string" && input.currency.trim() !== "" ? input.currency.trim() : null;
  const nothingReported = input.denomination === null && currencyText === null && evidence === null;

  if (nothingReported) {
    return context.asksAboutCurrency
      ? uncertain(`I could not tell which banknote this is from the photo. ${RETAKE_TIP}`)
      : null;
  }

  if (input.denomination === null) {
    return uncertain(`I could not tell the value of the note from the photo. ${RETAKE_TIP}`, evidence);
  }
  if (!isDenomination(input.denomination)) {
    return uncertain(
      `The AI suggested a value that is not one of the notes I can report (₹10, ₹20, ₹50, ₹100, ₹200, ₹500), so I am not showing it. ${RETAKE_TIP}`,
      evidence,
    );
  }
  if (currencyText !== null && !isIndianRupee(currencyText)) {
    return uncertain(`This does not look like an Indian rupee note I can identify. ${RETAKE_TIP}`, evidence);
  }
  if (evidence === null || evidence.length < MIN_EVIDENCE_CHARS) {
    return uncertain(
      `A value was suggested but no visible features were given to support it, so I am not showing it. ${RETAKE_TIP}`,
      evidence,
    );
  }
  if (context.confidence === "low") {
    return uncertain(`The AI was not confident about this note, so I am not showing a value. ${RETAKE_TIP}`, evidence);
  }
  const mentioned = mentionedDenominations(context.answerText);
  if (mentioned.some((m) => m !== input.denomination)) {
    return uncertain(
      `The AI's answer and its structured reading disagreed about the value of the note, so I am not showing one. ${RETAKE_TIP}`,
      evidence,
    );
  }

  return {
    status: "identified",
    denomination: input.denomination,
    evidence,
    message:
      context.confidence === "high"
        ? `This looks like a ₹${input.denomination} note, based on what is visible in the photo.`
        : `This may be a ₹${input.denomination} note, based on what is visible in the photo. Please double-check.`,
  };
}

/** Strict validation of a CurrencyCheck received from the server. */
export function parseCurrencyCheck(value: unknown): CurrencyCheck | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  const status = v.status;
  if (typeof status !== "string" || !CURRENCY_STATUSES.includes(status as CurrencyStatus)) return null;
  const denomination = v.denomination;
  if (denomination !== null && !isDenomination(denomination)) return null;
  // "identified" requires a value; "uncertain" must never carry one.
  if (status === "identified" && denomination === null) return null;
  if (status === "uncertain" && denomination !== null) return null;
  const evidence = v.evidence;
  if (evidence !== null && (typeof evidence !== "string" || evidence.length > 600)) return null;
  if (typeof v.message !== "string" || v.message === "" || v.message.length > 800) return null;
  return {
    status: status as CurrencyStatus,
    denomination: denomination as Denomination | null,
    evidence: evidence as string | null,
    message: v.message,
  };
}
