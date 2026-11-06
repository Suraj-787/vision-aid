/**
 * The words a screen reader hears for workflow events (Milestone 9). Short, in the
 * order a person needs them, and never the whole answer: the answer is read only
 * when the person moves to it or asks for it.
 */
import type { AskResult } from "@/lib/ask/ask-result";
import type { QualityIssue } from "@/lib/image/quality";

const QUALITY_PHRASES: Record<QualityIssue, string> = {
  too_dark: "The photo may be too dark.",
  too_bright: "The photo may be too bright or have glare.",
  blurry: "The photo may be blurry.",
};

/**
 * After a capture. Focus moves to the "Photo captured" heading, so this does not
 * repeat those words: it adds only what the heading does not say. It never claims
 * the photo is well framed or readable (a successful capture proves neither).
 */
export function photoCapturedAnnouncement(issues: readonly QualityIssue[]): string {
  if (issues.length === 0) return "Next, type or say your question.";
  const advice = issues.map((issue) => QUALITY_PHRASES[issue]).join(" ");
  return `${advice} You can retake the photo, or continue with your question.`;
}

/** When the answer arrives. Focus moves to the Answer heading; the text itself is not read out. */
export function answerReadyAnnouncement(result: Pick<AskResult, "confidence" | "uncertainty">): string {
  const parts = ["Your answer is ready."];
  if (result.confidence === "low") parts.push("The AI is not confident about it.");
  else if (result.uncertainty) parts.push("It includes something that is unclear.");
  return parts.join(" ");
}

/** When dictation ends: the person hears what was recognised so they can fix it. */
export function transcriptAnnouncement(text: string): string {
  const spoken = text.replace(/\s+/g, " ").trim();
  if (spoken === "") {
    return "Finished listening. Nothing was recognised. Try again, or type your question.";
  }
  return `Finished listening. Your question: ${spoken}. Edit it, or choose Ask.`;
}

/** What a disabled button says when it is activated anyway. */
export function blockedActionAnnouncement(reason: string | null, fallback: string): string {
  return reason ?? fallback;
}
