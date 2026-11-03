export type CameraErrorKind =
  | "insecure-context"
  | "unsupported"
  | "permission-denied"
  | "no-camera"
  | "in-use"
  | "disconnected"
  | "page-hidden"
  | "unknown";

export interface CameraError {
  kind: CameraErrorKind;
  /** User-facing explanation including a recovery action. */
  message: string;
}

const MESSAGES: Record<CameraErrorKind, string> = {
  "insecure-context":
    "The camera needs a secure connection. Open this page over HTTPS (or on localhost) and try again.",
  unsupported:
    "This browser cannot access a camera. Try a current version of Safari, Chrome, Edge or Firefox.",
  "permission-denied":
    "Camera permission was not granted. Allow camera access for this site in your browser settings, then choose Start camera again.",
  "no-camera":
    "No camera was found on this device. Connect a camera and choose Start camera again.",
  "in-use":
    "The camera could not be started. It may be in use by another app or tab. Close other apps using the camera and try again.",
  disconnected:
    "The camera stopped unexpectedly, so the preview was turned off. Check the camera and choose Start camera to try again.",
  "page-hidden":
    "The camera was turned off because the page was hidden or in the background. Choose Start camera to turn it on again.",
  unknown:
    "Something went wrong while starting the camera. Choose Start camera to try again.",
};

export function cameraError(kind: CameraErrorKind): CameraError {
  return { kind, message: MESSAGES[kind] };
}

/** Maps a getUserMedia / video.play() failure to a user-facing error. */
export function toCameraError(err: unknown): CameraError {
  const name = err instanceof DOMException || err instanceof Error ? err.name : "";
  switch (name) {
    case "NotAllowedError":
    case "SecurityError":
    case "PermissionDeniedError":
      return cameraError("permission-denied");
    case "NotFoundError":
    case "DevicesNotFoundError":
    case "OverconstrainedError":
      return cameraError("no-camera");
    case "NotReadableError":
    case "TrackStartError":
    case "AbortError":
      return cameraError("in-use");
    case "TypeError":
      return cameraError("unsupported");
    default:
      return cameraError("unknown");
  }
}
