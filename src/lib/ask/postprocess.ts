/**
 * Deterministic post-processing of the model's structured output (Milestone 6).
 *
 * Input: what the model claimed (already shape-validated). Output: the AskResult
 * shown to the user. Where this code has a deterministic result (the expiry
 * check, the currency gate) it speaks for itself, and the model's own sentences
 * that state a conflicting or unsupported conclusion are removed rather than
 * trusted. It also removes safety claims VisionAid must not make.
 *
 * What this cannot do: verify any visual fact. Whether the photo really shows
 * "EXP 08/2027" or a ₹500 note is known only to the model. These checks stop
 * unsupported, inconsistent or forbidden claims from being presented as
 * confirmed; they do not make the readings correct.
 */
import {
  ADJUSTMENT_CODES,
  type AdjustmentCode,
  type AskResult,
  type NoticeCode,
} from "@/lib/ask/ask-result";
import { checkCurrency, mentionedDenominations } from "@/lib/ask/currency";
import type { DateOnly, TodaySource } from "@/lib/ask/dates";
import { checkExpiry, expiryHeadline } from "@/lib/ask/expiry";
import type { ModelOutput } from "@/lib/ask/model-output";
import {
  GUARD_NOTES,
  sanitizeProse,
  splitSentences,
  statesExpiryConclusion,
  type GuardCode,
} from "@/lib/ask/safety";

export interface PostProcessContext {
  today: DateOnly;
  todaySource: TodaySource;
}

const GUARD_ADJUSTMENT: Record<GuardCode, AdjustmentCode> = {
  navigation: "navigation_claim_removed",
  medical: "medical_advice_removed",
  authenticity: "authenticity_claim_removed",
  expiry_safety: "expiry_safety_claim_removed",
};

export const LOW_CONFIDENCE_NOTE =
  "The AI said it is not confident in this answer. The photo may be unclear, so please double-check.";

export const FALLBACK_ANSWER =
  "I can't answer that reliably from this photo. Please try again with a clearer photo.";

function anyDateInfo(m: ModelOutput): boolean {
  const e = m.expiry;
  return e.expiry_date !== null || e.manufacturing_date !== null || e.date_text !== null || e.expiry_kind !== null;
}

function mentionsExpiryConclusion(...texts: Array<string | null>): boolean {
  return texts.some((t) => t !== null && splitSentences(t).some(statesExpiryConclusion));
}

export function postProcess(model: ModelOutput, ctx: PostProcessContext): AskResult {
  const adjustments = new Set<AdjustmentCode>();

  // ---- deterministic results
  const proseForCurrency = [model.answer, model.details].filter(Boolean).join(" ");
  const currencyCheck = checkCurrency(model.currency, {
    confidence: model.confidence,
    asksAboutCurrency: model.intent === "currency_identification",
    answerText: proseForCurrency,
  });

  const includeExpiry =
    anyDateInfo(model) ||
    model.intent === "expiry_date" ||
    mentionsExpiryConclusion(model.answer, model.details, model.uncertainty);
  const expiryCheck = includeExpiry
    ? checkExpiry(
        {
          expiryText: model.expiry.expiry_date,
          expiryKind: model.expiry.expiry_kind,
          manufacturingText: model.expiry.manufacturing_date,
          dateText: model.expiry.date_text,
        },
        ctx.today,
        ctx.todaySource,
      )
    : null;

  // ---- which of the model's sentences must go
  const dropsExpiryConclusion = expiryCheck !== null;
  const dropsUnsupportedCurrency = currencyCheck !== null && currencyCheck.status === "uncertain";
  const drop = (sentence: string): boolean =>
    (dropsExpiryConclusion && statesExpiryConclusion(sentence)) ||
    (dropsUnsupportedCurrency && mentionedDenominations(sentence).length > 0);

  const answer = sanitizeProse(model.answer, drop);
  const details = sanitizeProse(model.details, drop);
  const uncertainty = sanitizeProse(model.uncertainty, drop);

  const triggered = new Set<GuardCode>([...answer.triggered, ...details.triggered, ...uncertainty.triggered]);
  for (const code of triggered) adjustments.add(GUARD_ADJUSTMENT[code]);

  const droppedExpiry =
    dropsExpiryConclusion &&
    [model.answer, model.details, model.uncertainty].some(
      (t) => t !== null && splitSentences(t).some(statesExpiryConclusion),
    );
  if (droppedExpiry) adjustments.add("expiry_conclusion_replaced");
  const droppedCurrency =
    dropsUnsupportedCurrency &&
    [model.answer, model.details, model.uncertainty].some(
      (t) => t !== null && splitSentences(t).some((s) => mentionedDenominations(s).length > 0),
    );
  if (droppedCurrency) adjustments.add("currency_conclusion_replaced");

  // ---- the answer: deterministic statements first, then what remains of the model's own words
  const lead: string[] = [];
  if (expiryCheck && (droppedExpiry || model.intent === "expiry_date")) lead.push(expiryHeadline(expiryCheck));
  if (currencyCheck) {
    // Lead with the app's own wording unless the model already stated the same value
    // (otherwise the answer would say it twice).
    const modelStatedIt =
      currencyCheck.status === "identified" &&
      currencyCheck.denomination !== null &&
      mentionedDenominations(answer.text ?? "").includes(currencyCheck.denomination);
    if (!modelStatedIt && (droppedCurrency || model.intent === "currency_identification")) {
      lead.push(currencyCheck.message);
    }
  }
  const notes = [...triggered].map((code) => GUARD_NOTES[code]);
  const parts = [...lead, ...(answer.text ? [answer.text] : []), ...notes];
  const finalAnswer = parts.length > 0 ? parts.join(" ") : FALLBACK_ANSWER;

  // ---- uncertainty: always present when the model was not confident
  let finalUncertainty = uncertainty.text;
  if (model.confidence === "low" && finalUncertainty === null) finalUncertainty = LOW_CONFIDENCE_NOTE;

  // ---- fixed notices
  const notices: NoticeCode[] = [];
  if (model.intent === "medicine_label" || model.printed_instructions !== null) notices.push("label_only");
  if (model.intent === "currency_identification" || currencyCheck !== null) notices.push("currency_limits");
  if (expiryCheck !== null) notices.push("expiry_limits");

  return {
    intent: model.intent,
    answer: finalAnswer,
    details: details.text,
    uncertainty: finalUncertainty,
    confidence: model.confidence,
    printed_text: model.printed_text,
    printed_instructions: model.printed_instructions,
    currency_check: currencyCheck,
    expiry_check: expiryCheck,
    notices,
    adjustments: ADJUSTMENT_CODES.filter((c) => adjustments.has(c)),
  };
}
