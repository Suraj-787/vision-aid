/**
 * What gets read aloud (Milestone 7). Built only from the validated AskResult
 * fields, never from raw model output, and never from interface text:
 *
 *  - the answer;
 *  - the model's statement of what is unclear, when there is one;
 *  - the expiry result, when the answer does not already state it (or when it
 *    is unclear, so the reason is heard);
 *  - the banknote result, when the answer does not already state it, with the
 *    reminder that VisionAid cannot tell whether a note is genuine.
 *
 * Not spoken: the intent, the confidence label, notices, adjustment notes,
 * printed text and instructions (they are on screen and can be read with a
 * screen reader), or any control labels.
 */
import { NOTICE_TEXT, type AskResult } from "@/lib/ask/ask-result";
import { mentionedDenominations } from "@/lib/ask/currency";
import { expiryHeadline } from "@/lib/ask/expiry";
import { splitSentences } from "@/lib/ask/safety";
import { segmentByLanguage, type LangSegment } from "@/lib/speech/script";

export type SpokenSegment = LangSegment;

/** Collapses whitespace and drops control characters that engines read as noise. */
export function cleanForSpeech(text: string): string {
  return text
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f​-‍﻿]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function norm(text: string): string {
  return cleanForSpeech(text).toLowerCase();
}

/** The ordered pieces of text to speak. Empty when there is no usable answer. */
export function spokenParts(result: AskResult): string[] {
  const answer = cleanForSpeech(result.answer);
  if (answer === "") return [];

  const parts: string[] = [answer];
  const spoken = () => norm(parts.join(" "));
  const add = (text: string | null | undefined) => {
    const t = text ? cleanForSpeech(text) : "";
    if (t !== "" && !spoken().includes(norm(t))) parts.push(t);
  };

  add(result.uncertainty);

  const expiry = result.expiry_check;
  if (expiry) {
    const statesStatus = spoken().includes(norm(expiryHeadline(expiry)));
    // Always speak the reason for "unclear"; otherwise only if the answer left the status out.
    if (expiry.status === "unclear" || !statesStatus) add(expiry.explanation);
  }

  const currency = result.currency_check;
  if (currency) {
    const alreadyStated =
      currency.status === "identified" && currency.denomination !== null
        ? mentionedDenominations(answer).includes(currency.denomination)
        : spoken().includes(norm(currency.message));
    if (!alreadyStated) add(currency.message);
    if (currency.status === "identified") add(NOTICE_TEXT.currency_limits);
  }

  return parts;
}

/** Spoken text as language-labelled segments (each is read with a voice for its own language). */
export function buildSpokenSegments(result: AskResult): SpokenSegment[] {
  const segments: SpokenSegment[] = [];
  for (const part of spokenParts(result)) {
    for (const segment of segmentByLanguage(part)) {
      const last = segments.at(-1);
      if (last && last.lang === segment.lang) {
        last.text += ` ${segment.text}`;
        last.mixed = last.mixed || segment.mixed;
      } else {
        segments.push({ ...segment });
      }
    }
  }
  return segments;
}

/** Engines (notably Chrome) can stop reading long utterances, so speech is sent in short chunks. */
export const MAX_CHUNK_CHARS = 200;

export function chunkForSpeech(text: string, max: number = MAX_CHUNK_CHARS): string[] {
  const chunks: string[] = [];
  let current = "";
  const push = () => {
    if (current !== "") chunks.push(current);
    current = "";
  };
  for (const sentence of splitSentences(text)) {
    if (sentence.length > max) {
      push();
      // A very long sentence: split on commas, then on spaces.
      let piece = "";
      for (const word of sentence.split(/(?<=[,;:،])\s+|\s+/)) {
        if (piece !== "" && piece.length + 1 + word.length > max) {
          chunks.push(piece);
          piece = word;
        } else {
          piece = piece === "" ? word : `${piece} ${word}`;
        }
      }
      if (piece !== "") chunks.push(piece);
      continue;
    }
    if (current !== "" && current.length + 1 + sentence.length > max) push();
    current = current === "" ? sentence : `${current} ${sentence}`;
  }
  push();
  return chunks;
}
