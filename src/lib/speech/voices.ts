/**
 * Choosing a text-to-speech voice for a language, and describing what is
 * available. Pure: voices are passed in (structurally typed), so this is tested
 * without a browser.
 *
 * VisionAid never speaks a language with a voice for a different language: if no
 * voice matches, the text is not read aloud and the user is told why. The one
 * accepted fallback is another variant of the same language (for example an
 * en-US voice when no en-IN voice exists), and that is reported.
 */
import { langInfo, type SupportedLang } from "@/lib/speech/types";

export interface VoiceLike {
  name: string;
  /** BCP 47 tag. Android may report underscores (hi_IN) or three-letter codes. */
  lang: string;
  /** false means the voice may run on an online service. */
  localService: boolean;
  default: boolean;
}

export function normalizeLangTag(tag: string): string {
  return tag.trim().toLowerCase().replace(/_/g, "-");
}

/** Primary language subtags, including the three-letter ISO 639-2 forms some engines report. */
const PRIMARY: Record<SupportedLang, readonly string[]> = {
  "en-IN": ["en", "eng"],
  "hi-IN": ["hi", "hin"],
  "kn-IN": ["kn", "kan"],
};

export type VoiceMatchKind = "exact" | "same-language" | "none";
export interface VoiceMatch<V extends VoiceLike = VoiceLike> {
  kind: VoiceMatchKind;
  voice: V | null;
}

function region(tag: string): string | null {
  const parts = normalizeLangTag(tag).split("-");
  return parts.length > 1 ? parts[1] : null;
}

/** Local voices first (they do not send text to an online service), then the system default, then by name. */
function preferred<V extends VoiceLike>(voices: V[]): V | null {
  if (voices.length === 0) return null;
  return [...voices].sort((a, b) => {
    if (a.localService !== b.localService) return a.localService ? -1 : 1;
    if (a.default !== b.default) return a.default ? -1 : 1;
    return a.name.localeCompare(b.name);
  })[0];
}

export function pickVoice<V extends VoiceLike>(voices: readonly V[], lang: SupportedLang): VoiceMatch<V> {
  const wanted = normalizeLangTag(lang);
  const wantedRegion = region(lang);
  const primaries = PRIMARY[lang];

  const sameLanguage = voices.filter((v) => primaries.includes(normalizeLangTag(v.lang).split("-")[0]));
  const exact = sameLanguage.filter((v) => {
    const tag = normalizeLangTag(v.lang);
    // en-IN / hi-IN / kn-IN, or the three-letter form with the same region (hin-IN, hin-IND).
    if (tag === wanted) return true;
    const r = region(tag);
    return r !== null && wantedRegion !== null && (r === wantedRegion.toLowerCase() || r === "ind");
  });

  const exactPick = preferred(exact);
  if (exactPick) return { kind: "exact", voice: exactPick };
  const anyPick = preferred([...sameLanguage]);
  if (anyPick) return { kind: "same-language", voice: anyPick };
  return { kind: "none", voice: null };
}

export type VoiceSupportLevel = "unsupported" | "checking" | "available" | "fallback" | "missing";
export interface VoiceSupport {
  level: VoiceSupportLevel;
  message: string;
}

/** What the user is told about spoken answers for the language they chose. */
export function describeVoiceSupport(
  lang: SupportedLang,
  voices: readonly VoiceLike[],
  options: { synthesisSupported: boolean; settled: boolean },
): VoiceSupport {
  const name = langInfo(lang).englishName;
  if (!options.synthesisSupported) {
    return {
      level: "unsupported",
      message: "Spoken answers are not available in this browser. Answers are shown as text.",
    };
  }
  if (voices.length === 0) {
    return options.settled
      ? {
          level: "missing",
          message: `No voices were found on this device, so answers cannot be read aloud. They are shown as text. If you have installed a ${name} voice, reload the page.`,
        }
      : { level: "checking", message: "Checking which voices are installed on this device…" };
  }
  const match = pickVoice(voices, lang);
  if (match.kind === "exact" && match.voice) {
    return { level: "available", message: `A ${name} voice is available (${match.voice.name}).` };
  }
  if (match.kind === "same-language" && match.voice) {
    return {
      level: "fallback",
      message: `No ${name} (India) voice was found. A ${name} voice for another region will be used (${match.voice.name}, ${match.voice.lang}).`,
    };
  }
  return {
    level: "missing",
    message: `No ${name} voice is installed on this device, so ${name} answers cannot be read aloud here. They are still shown as text. You can add a ${name} voice in your device's speech or language settings.`,
  };
}
