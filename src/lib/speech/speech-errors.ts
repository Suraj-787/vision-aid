export type SpeechErrorKind =
  | "unsupported"
  | "permission-denied"
  | "no-speech"
  | "no-microphone"
  | "network"
  | "language-not-supported"
  | "start-failed"
  | "unknown";

export interface SpeechError {
  kind: SpeechErrorKind;
  /** User-facing explanation with a recovery action. Typing is always offered. */
  message: string;
}

const TYPE_INSTEAD = "You can type your question instead.";

const MESSAGES: Record<SpeechErrorKind, string> = {
  unsupported: `Speech input is not available in this browser. ${TYPE_INSTEAD}`,
  "permission-denied": `Microphone or speech permission was not granted. Allow it in your browser settings and try again. ${TYPE_INSTEAD}`,
  "no-speech": `I did not hear anything. Tap Start speaking and try again. ${TYPE_INSTEAD}`,
  "no-microphone": `No microphone was found, or it could not be used. ${TYPE_INSTEAD}`,
  network: `Speech recognition could not reach your browser's speech service. Check your connection and try again. ${TYPE_INSTEAD}`,
  "language-not-supported": `This browser cannot recognise speech in the selected language. Try another language. ${TYPE_INSTEAD}`,
  "start-failed": `Speech recognition could not start. Try again in a moment. ${TYPE_INSTEAD}`,
  unknown: `Speech recognition stopped because of an error. ${TYPE_INSTEAD}`,
};

export function speechError(kind: SpeechErrorKind): SpeechError {
  return { kind, message: MESSAGES[kind] };
}

/**
 * Maps a Web Speech `SpeechRecognitionErrorEvent.error` code. Returns null for
 * `aborted`, which is our own cancellation and not an error to show.
 */
export function mapSpeechErrorCode(code: string): SpeechErrorKind | null {
  switch (code) {
    case "aborted":
      return null;
    case "not-allowed":
    case "service-not-allowed":
      return "permission-denied";
    case "no-speech":
      return "no-speech";
    case "audio-capture":
      return "no-microphone";
    case "network":
      return "network";
    case "language-not-supported":
      return "language-not-supported";
    default:
      return "unknown";
  }
}
