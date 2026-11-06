/**
 * Speech input and output are behind small provider boundaries so another
 * engine (the optional Sarvam fallback, not integrated) could be added without
 * changing the ask flow. Only the browser Web Speech API exists today.
 *
 * This module is pure (no browser or server imports) so the server can use it to
 * validate the optional `response_language` request field.
 */

export type SupportedLang = "en-IN" | "hi-IN" | "kn-IN";

export interface LanguageInfo {
  code: SupportedLang;
  /** Shown in the language selector. Includes the native name where it differs. */
  label: string;
  /** The language's own name for itself (what a speaker of it would recognise). */
  nativeName: string;
  englishName: string;
  scriptName: string;
  /** Value for the HTML `lang` attribute, so screen readers pronounce it correctly. */
  htmlLang: "en" | "hi" | "kn";
}

export const SUPPORTED_LANGS: ReadonlyArray<LanguageInfo> = [
  { code: "en-IN", label: "English (India)", nativeName: "English", englishName: "English", scriptName: "Latin", htmlLang: "en" },
  { code: "hi-IN", label: "हिन्दी (Hindi)", nativeName: "हिन्दी", englishName: "Hindi", scriptName: "Devanagari", htmlLang: "hi" },
  { code: "kn-IN", label: "ಕನ್ನಡ (Kannada)", nativeName: "ಕನ್ನಡ", englishName: "Kannada", scriptName: "Kannada", htmlLang: "kn" },
];

export const DEFAULT_LANG: SupportedLang = "en-IN";

export function isSupportedLang(value: unknown): value is SupportedLang {
  return typeof value === "string" && SUPPORTED_LANGS.some((l) => l.code === value);
}

export function langInfo(code: SupportedLang): LanguageInfo {
  return SUPPORTED_LANGS.find((l) => l.code === code) ?? SUPPORTED_LANGS[0];
}

export interface SpeechSession {
  /** Ask the engine to finish and deliver the final result. */
  stop(): void;
  /** Cancel immediately; no further callbacks are delivered. */
  abort(): void;
}
