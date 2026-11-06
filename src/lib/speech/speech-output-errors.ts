export type SpeechOutputErrorKind =
  | "unsupported"
  | "no-voice"
  | "blocked"
  | "audio-busy"
  | "failed";

export interface SpeechOutputError {
  kind: SpeechOutputErrorKind;
  /** User-facing explanation with a recovery action. The text is always shown too. */
  message: string;
}

const MESSAGES: Record<SpeechOutputErrorKind, string> = {
  unsupported: "Reading aloud is not available in this browser. The answer is shown as text.",
  "no-voice": "There is no installed voice that can read this answer aloud. The answer is shown as text.",
  blocked: "Your browser did not allow speech to start. Tap Listen again.",
  "audio-busy": "The device's audio is busy right now. Close other apps that are using sound, then tap Listen again.",
  failed: "Reading aloud stopped because of an error. Tap Listen to try again. The answer is shown as text.",
};

export function speechOutputError(kind: SpeechOutputErrorKind, message?: string): SpeechOutputError {
  return { kind, message: message ?? MESSAGES[kind] };
}

/**
 * Maps `SpeechSynthesisErrorEvent.error`. Returns "quiet" for the codes that
 * mean the speech was cancelled or interrupted (our own stop, or another app
 * taking the audio), which are not errors to show.
 */
export function mapSynthesisErrorCode(code: string | undefined): SpeechOutputErrorKind | "quiet" {
  switch (code) {
    case "canceled":
    case "interrupted":
      return "quiet";
    case "not-allowed":
      return "blocked";
    case "audio-busy":
    case "audio-hardware":
      return "audio-busy";
    default:
      // synthesis-unavailable, synthesis-failed, language-unavailable, voice-unavailable,
      // text-too-long, invalid-argument, network, unknown, or no code at all
      return "failed";
  }
}
