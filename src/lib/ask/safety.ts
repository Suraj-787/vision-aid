/**
 * Deterministic safety checks on the AI's own prose (Milestone 6).
 *
 * The system instruction already tells the model not to make these claims; this
 * module is the second line of defence that does not depend on the model
 * following instructions. It works sentence by sentence on the fields the model
 * writes itself (answer, details, uncertainty) and removes sentences that claim
 * something VisionAid must never claim. It is pattern matching, so it is a
 * safety net, not a guarantee: it can miss unusual phrasings, and it can remove
 * a harmless sentence. It never touches printed_text or printed_instructions,
 * which are meant to be copied from the item.
 */

import {
  claimsAuthenticityIndic,
  claimsProductSafetyIndic,
  givesMedicalAdviceIndic,
  makesNavigationClaimIndic,
  statesExpiryConclusionIndic,
} from "@/lib/ask/safety-indic";

export type GuardCode = "navigation" | "medical" | "authenticity" | "expiry_safety";

/** Fixed wording used when a guard fires. Written here, never by the model. */
export const GUARD_NOTES: Record<GuardCode, string> = {
  navigation:
    "I can't judge whether it is safe to move through a space. VisionAid is not a navigation tool, so please rely on your mobility aids and trusted assistance.",
  medical:
    "I can't give medical advice or say how to take a medicine. I can only read what is printed. Please ask a pharmacist or doctor.",
  authenticity:
    "I can't tell whether a banknote is genuine or counterfeit. I can only say what it appears to be.",
  expiry_safety:
    "I can't say whether a product is safe to use. I can only report the printed dates.",
};

export function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?।])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Words that turn a sentence into a refusal or disclaimer instead of a claim. */
const NEGATION =
  /\b(cannot|can't|can not|couldn't|could not|unable|not able|do not|don't|does not|doesn't|did not|won't|never|no way|not possible|impossible|not reliably|not designed|not capable|not safe|isn't safe|not clear|isn't clear|is not clear)\b/i;

/** Narrower: bare "not" must not excuse "is not fake" (that still claims it is genuine). */
const DISCLAIMER =
  /\b(cannot|can't|can not|couldn't|could not|unable|not able|do not|don't|does not|doesn't|no way|not possible|impossible|not designed|not capable|not reliably)\b/i;

// ---- navigation / mobility safety
const NAVIGATION_CLAIMS: RegExp[] = [
  /\b(?:safe|safely|ok|okay|fine)\s+(?:for you\s+)?to\s+(?:cross|walk|proceed|go|step|move|pass|continue|turn|drive)\b/i,
  /\b(?:road|path|way|crossing|street|sidewalk|pavement|footpath|stairs?|staircase|steps|doorway|route|corridor|walkway)\b[^.!?]{0,40}\b(?:is|are|looks?|seems?|appears?)\s+(?:completely\s+|totally\s+|all\s+)?(?:safe|clear|free|unobstructed|empty)\b/i,
  /\b(?:no|nothing|without any|free of|free from)\s+(?:visible\s+)?(?:obstacles?|hazards?|obstructions?|dangers?|vehicles?|traffic|cars?|barriers?)\b/i,
  /\byou can (?:safely\s+)?(?:cross|walk|proceed|go ahead|step|move forward|continue|go)\b/i,
  /\b(?:all clear|go ahead|good to go|clear to (?:cross|walk|go|proceed)|nothing in (?:your|the) way)\b/i,
  /\b(?:all|every|any)\s+(?:the\s+)?(?:obstacles?|hazards?|dangers?)\b[^.!?]{0,30}\b(?:detected|identified|found|seen|visible|covered)\b/i,
];

// ---- medicine: advice, dosing, suitability, interpretation
const MEDICINE_CONTEXT =
  /\b(medicine|medicines|medication|medications|tablets?|capsules?|pills?|dos(?:e|es|ing|age)|syrup|drops?|injection|ointment|cream|drug|drugs|mg|ml|mcg)\b/i;
const MEDICAL_ADVICE =
  /\b(should|recommend(?:ed|s)?|advis(?:e|ed|es)|suggest(?:ed|s)?|safe for|suitable|appropriate|ok to|okay to|fine to|must|ought to|best to|can be taken|is good for|used (?:to treat|for)|helps? (?:with|to)|treats?|cures?|relieves?|prescri(?:be|bed|bes|ption))\b/i;
const DIRECT_ADVICE =
  /\b(?:you (?:should|must|can|may|could|need to|have to)|i (?:recommend|advise|suggest)|it is (?:safe|fine|ok|okay) (?:for you )?to)\b/i;
const LABEL_FRAMING =
  /\b(label|package|packaging|box|strip|bottle|sachet|printed|prints?|reads?|says?|saying|states?|stating|written|writes?|according to the)\b/i;
const UNFRAMED_DOSE = /\btake\s+(?:one|two|three|four|half|a|\d+)\b/i;

// ---- banknote authenticity
const AUTHENTICITY =
  /\b(counterfeit|fake|forged|forgery|genuine|authentic|authenticity|legitimate|legit|real (?:note|currency|money|rupee)s?|original (?:note|currency)|fraudulent)\b/i;

// ---- product safety
const EXPIRY_SAFETY: RegExp[] = [
  /\b(?:safe|ok|okay|fine|good)\s+(?:for you\s+)?to\s+(?:eat|use|consume|drink|take|have)\b/i,
  /\bstill (?:good|fresh|usable|edible|okay|ok|fine)\b/i,
];
/** Claims that contain their own negation ("won't harm you"), so the disclaimer filter must not excuse them. */
const EXPIRY_SAFETY_SELF_NEGATED = /\b(?:won't|will not|wouldn't|would not)\s+(?:harm|hurt|make you sick)\b/i;

export function makesNavigationClaim(sentence: string): boolean {
  return (
    (!NEGATION.test(sentence) && NAVIGATION_CLAIMS.some((re) => re.test(sentence))) ||
    makesNavigationClaimIndic(sentence)
  );
}

export function givesMedicalAdvice(sentence: string): boolean {
  return givesMedicalAdviceEnglish(sentence) || givesMedicalAdviceIndic(sentence);
}

function givesMedicalAdviceEnglish(sentence: string): boolean {
  if (!MEDICINE_CONTEXT.test(sentence) && !UNFRAMED_DOSE.test(sentence)) return false;
  if (NEGATION.test(sentence)) return false;
  // Advice addressed to the user is never acceptable, even with "the label says" attached.
  if (DIRECT_ADVICE.test(sentence) && MEDICINE_CONTEXT.test(sentence)) return true;
  if (LABEL_FRAMING.test(sentence)) return false;
  return MEDICAL_ADVICE.test(sentence) || UNFRAMED_DOSE.test(sentence);
}

export function claimsAuthenticity(sentence: string): boolean {
  return (!DISCLAIMER.test(sentence) && AUTHENTICITY.test(sentence)) || claimsAuthenticityIndic(sentence);
}

export function claimsProductSafety(sentence: string): boolean {
  return claimsProductSafetyEnglish(sentence) || claimsProductSafetyIndic(sentence);
}

function claimsProductSafetyEnglish(sentence: string): boolean {
  if (EXPIRY_SAFETY_SELF_NEGATED.test(sentence) && !DISCLAIMER_FOR_SELF_NEGATED.test(sentence)) return true;
  return !NEGATION.test(sentence) && EXPIRY_SAFETY.some((re) => re.test(sentence));
}

/** "I cannot say it won't harm you" is still a refusal. */
const DISCLAIMER_FOR_SELF_NEGATED = /\b(?:cannot|can't|can not|unable|not able|no way)\b/i;

/** A sentence that states whether something has expired (checked against the deterministic result). */
const EXPIRY_CONCLUSION =
  /\b(expired|out of date|in date|still valid|no longer valid|past (?:its|the) (?:expiry|expiration|best[- ]before|use[- ]by)|not (?:yet )?expired|hasn't expired|has not expired)\b/i;
export function statesExpiryConclusion(sentence: string): boolean {
  return EXPIRY_CONCLUSION.test(sentence) || statesExpiryConclusionIndic(sentence);
}

const GUARDS: Array<{ code: GuardCode; flags: (sentence: string) => boolean }> = [
  { code: "navigation", flags: makesNavigationClaim },
  { code: "medical", flags: givesMedicalAdvice },
  { code: "authenticity", flags: claimsAuthenticity },
  { code: "expiry_safety", flags: claimsProductSafety },
];

export interface Sanitized {
  /** The remaining text, or null when nothing is left. */
  text: string | null;
  triggered: GuardCode[];
  /** True when the caller's `drop` callback removed at least one sentence. */
  dropped: boolean;
}

/**
 * Removes every sentence that trips a guard. `drop` lets the caller remove
 * additional sentences (for example expiry conclusions) in the same pass.
 */
export function sanitizeProse(
  text: string | null,
  drop?: (sentence: string) => boolean,
): Sanitized {
  if (text === null) return { text: null, triggered: [], dropped: false };
  const triggered = new Set<GuardCode>();
  const kept: string[] = [];
  let dropped = false;
  for (const sentence of splitSentences(text)) {
    const guard = GUARDS.find((g) => g.flags(sentence));
    if (guard) {
      triggered.add(guard.code);
      continue;
    }
    if (drop?.(sentence)) {
      dropped = true;
      continue;
    }
    kept.push(sentence);
  }
  return { text: kept.length > 0 ? kept.join(" ") : null, triggered: [...triggered], dropped };
}
