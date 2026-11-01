export type MicrophoneErrorKind =
  | "insecure-context"
  | "unsupported"
  | "permission-denied"
  | "no-microphone"
  | "in-use"
  | "audio-blocked"
  | "worklet-failed"
  | "interrupted"
  | "disconnected"
  | "page-hidden"
  | "unknown";

export interface MicrophoneError {
  kind: MicrophoneErrorKind;
  /** User-facing explanation including a recovery action. */
  message: string;
}

const MESSAGES: Record<MicrophoneErrorKind, string> = {
  "insecure-context":
    "The microphone needs a secure connection. Open this page over HTTPS (or on localhost) and try again.",
  unsupported:
    "This browser cannot capture microphone audio. Try a current version of Safari, Chrome, Edge or Firefox.",
  "permission-denied":
    "Microphone permission was not granted. Allow microphone access for this site in your browser settings, then choose Start microphone again.",
  "no-microphone":
    "No microphone was found on this device. Connect a microphone and choose Start microphone again.",
  "in-use":
    "The microphone could not be started. It may be in use by another app or tab. Close other apps using the microphone and try again.",
  "audio-blocked":
    "The browser did not allow audio processing to start. Choose Start microphone again.",
  "worklet-failed":
    "Audio processing could not be loaded or stopped working. Reload the page and choose Start microphone again.",
  interrupted:
    "Audio was interrupted, for example by a call or another app, so the microphone was turned off. Choose Start microphone to resume.",
  disconnected:
    "The microphone stopped unexpectedly, so it was turned off. Check the microphone and choose Start microphone to try again.",
  "page-hidden":
    "The microphone was turned off because the page was hidden or in the background. Choose Start microphone to turn it on again.",
  unknown:
    "Something went wrong while starting the microphone. Choose Start microphone to try again.",
};

export function microphoneError(kind: MicrophoneErrorKind): MicrophoneError {
  return { kind, message: MESSAGES[kind] };
}

/** Thrown by startMicCapture with an already-classified kind. */
export class MicrophoneStartError extends Error {
  constructor(readonly kind: MicrophoneErrorKind) {
    super(kind);
    this.name = "MicrophoneStartError";
  }
}

/** Maps a thrown value (getUserMedia or MicrophoneStartError) to a user-facing error. */
export function toMicrophoneError(err: unknown): MicrophoneError {
  if (err instanceof MicrophoneStartError) return microphoneError(err.kind);
  const name = err instanceof Error ? err.name : "";
  switch (name) {
    case "NotAllowedError":
    case "SecurityError":
    case "PermissionDeniedError":
      return microphoneError("permission-denied");
    case "NotFoundError":
    case "DevicesNotFoundError":
    case "OverconstrainedError":
      return microphoneError("no-microphone");
    case "NotReadableError":
    case "TrackStartError":
    case "AbortError":
      return microphoneError("in-use");
    case "TypeError":
      return microphoneError("unsupported");
    default:
      return microphoneError("unknown");
  }
}
