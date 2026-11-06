/**
 * Tells the user, honestly, whether the answer came back in the language they
 * asked for, and which parts of the screen stay in English (Milestone 7). Pure.
 */
import type { AskResult } from "@/lib/ask/ask-result";
import { detectAnswerLanguage } from "@/lib/speech/script";
import { langInfo, type SupportedLang } from "@/lib/speech/types";

/**
 * The language to request the answer in. The selector is the default, but a
 * question written in Devanagari or Kannada letters is answered in that language
 * even if English is still selected: otherwise a Hindi question would be answered
 * in English by instruction. A question in Latin letters keeps the selector, so
 * choosing Hindi still gives Hindi answers to questions typed in English letters.
 */
export function chooseResponseLanguage(selected: SupportedLang, question: string): SupportedLang {
  const written = detectAnswerLanguage(question);
  return written && written !== "en-IN" ? written : selected;
}

/**
 * Notes to show beside an answer.
 * @param requested the language the answer was requested in
 * @param selected the language selector's value when the question was sent
 */
export function answerLanguageNotes(
  requested: SupportedLang,
  result: AskResult,
  selected: SupportedLang = requested,
): string[] {
  const notes: string[] = [];
  const wanted = langInfo(requested).englishName;
  const got = detectAnswerLanguage(result.answer);

  if (requested !== selected) {
    notes.push(
      `Your question is written in ${wanted}, so ${wanted} was requested for the answer even though ${langInfo(selected).englishName} is selected.`,
    );
  }

  if (got && got !== requested) {
    notes.push(
      `You asked for ${wanted}, but this answer is mostly in ${langInfo(got).englishName}. VisionAid does not translate answers itself.`,
    );
  }
  if (requested !== "en-IN" || got !== "en-IN") {
    const englishParts: string[] = [];
    if (result.expiry_check) englishParts.push("the expiry check");
    if (result.currency_check) englishParts.push("the banknote check");
    if (result.notices.length > 0 || result.adjustments.length > 0) englishParts.push("VisionAid's notices");
    if (englishParts.length > 0) {
      notes.push(
        `${capitalize(joinList(englishParts))} ${englishParts.length === 1 ? "is" : "are"} written by VisionAid in English only.`,
      );
    }
  }
  return notes;
}

function joinList(items: string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
