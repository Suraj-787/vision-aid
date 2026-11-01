import type { RefObject } from "react";
import type { CameraStatus } from "@/hooks/useCamera";

interface CameraPreviewProps {
  videoRef: RefObject<HTMLVideoElement | null>;
  status: CameraStatus;
}

/** The <video> is always mounted so the hook can attach a stream to it. */
export function CameraPreview({ videoRef, status }: CameraPreviewProps) {
  const live = status === "camera-ready";
  const requesting = status === "requesting-permissions";

  return (
    <div className="relative aspect-video w-full overflow-hidden rounded-lg border-2 border-border bg-surface">
      <video
        ref={videoRef}
        muted
        playsInline
        aria-label="Live camera preview from your device. Nothing is recorded or sent."
        className={`h-full w-full object-cover ${live ? "" : "invisible"}`}
      />
      {!live && (
        <div className="absolute inset-0 flex items-center justify-center p-4 text-center text-muted">
          {requesting ? "Waiting for camera permission…" : "Camera is off"}
        </div>
      )}
      {live && (
        <span className="absolute left-2 top-2 rounded-md bg-black/75 px-2 py-1 text-sm font-semibold text-white">
          Camera on
        </span>
      )}
    </div>
  );
}
