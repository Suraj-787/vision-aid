/**
 * Speech input is behind a small provider boundary so another engine (the
 * optional Sarvam fallback in Milestone 7) can be added without changing the
 * ask flow. Only the browser Web Speech API exists today.
 */

export type SupportedLang = "en-IN" | "hi-IN" | "kn-IN";

export const SUPPORTED_LANGS: ReadonlyArray<{ code: SupportedLang; label: string }> = [
  { code: "en-IN", label: "English (India)" },
  { code: "hi-IN", label: "Hindi" },
  { code: "kn-IN", label: "Kannada" },
];

export interface SpeechSession {
  /** Ask the engine to finish and deliver the final result. */
  stop(): void;
  /** Cancel immediately; no further callbacks are delivered. */
  abort(): void;
}
