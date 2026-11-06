/**
 * Detects which writing system a piece of text is in, so each sentence of an
 * answer can be read with a voice for its own language. Deterministic and
 * offline: it counts letters by Unicode block. It cannot tell English from other
 * Latin-script languages (including Hindi written in Latin letters), and
 * Devanagari is treated as Hindi although Marathi and others share the script.
 */
import { splitSentences } from "@/lib/ask/safety";
import type { SupportedLang } from "@/lib/speech/types";

export type Script = "latin" | "devanagari" | "kannada";

const SCRIPT_LANG: Record<Script, SupportedLang> = {
  latin: "en-IN",
  devanagari: "hi-IN",
  kannada: "kn-IN",
};

export function scriptLang(script: Script): SupportedLang {
  return SCRIPT_LANG[script];
}

/** Letters only: digits, danda and other punctuation of each block are not counted. */
function scriptOf(code: number): Script | null {
  if ((code >= 0x41 && code <= 0x5a) || (code >= 0x61 && code <= 0x7a) || (code >= 0xc0 && code <= 0x24f)) return "latin";
  if (code >= 0x900 && code <= 0x97f) {
    if (code === 0x964 || code === 0x965) return null; // danda, double danda
    if (code >= 0x966 && code <= 0x96f) return null; // Devanagari digits
    return "devanagari";
  }
  if (code >= 0xc80 && code <= 0xcff) {
    if (code >= 0xce6 && code <= 0xcef) return null; // Kannada digits
    return "kannada";
  }
  return null;
}

export function scriptCounts(text: string): Record<Script, number> {
  const counts: Record<Script, number> = { latin: 0, devanagari: 0, kannada: 0 };
  for (const ch of text) {
    const script = scriptOf(ch.codePointAt(0) ?? 0);
    if (script) counts[script] += 1;
  }
  return counts;
}

/** A second script making up at least this share of the letters marks the text as mixed. */
export const MIXED_SHARE = 0.2;

export interface Dominant {
  script: Script | null;
  /** True when another script is a meaningful part of the text (at least 20% of its letters). */
  mixed: boolean;
}

export function dominantScript(text: string): Dominant {
  const counts = scriptCounts(text);
  const total = counts.latin + counts.devanagari + counts.kannada;
  if (total === 0) return { script: null, mixed: false };
  const ranked = (Object.keys(counts) as Script[]).sort((a, b) => counts[b] - counts[a]);
  const [first, second] = ranked;
  return { script: first, mixed: counts[second] / total >= MIXED_SHARE };
}

export interface LangSegment {
  text: string;
  lang: SupportedLang;
  /** The text contains a substantial amount of another script, which this voice may mispronounce. */
  mixed: boolean;
}

/**
 * Splits text into sentences, labels each with the language of its script, and
 * merges neighbouring sentences of the same language. A sentence with no letters
 * (for example "08/2027.") joins the sentence before it (or after it if first).
 */
export function segmentByLanguage(text: string): LangSegment[] {
  const sentences = splitSentences(text);
  const labelled = sentences.map((s) => {
    const d = dominantScript(s);
    return { text: s, lang: d.script ? scriptLang(d.script) : null, mixed: d.mixed };
  });

  const segments: LangSegment[] = [];
  let pending: string[] = [];
  for (const item of labelled) {
    if (item.lang === null) {
      const last = segments.at(-1);
      if (last) last.text += ` ${item.text}`;
      else pending.push(item.text);
      continue;
    }
    const last = segments.at(-1);
    const leading = pending.length ? `${pending.join(" ")} ` : "";
    pending = [];
    if (last && last.lang === item.lang) {
      last.text += ` ${leading}${item.text}`;
      last.mixed = last.mixed || item.mixed;
    } else {
      segments.push({ text: `${leading}${item.text}`, lang: item.lang, mixed: item.mixed });
    }
  }
  if (segments.length === 0 && pending.length) {
    segments.push({ text: pending.join(" "), lang: "en-IN", mixed: false });
  }
  return segments;
}

/**
 * The language the answer is mostly written in, or null when it has no letters.
 * Used to tell the user when it differs from the language they chose.
 */
export function detectAnswerLanguage(text: string): SupportedLang | null {
  const { script } = dominantScript(text);
  return script ? scriptLang(script) : null;
}
