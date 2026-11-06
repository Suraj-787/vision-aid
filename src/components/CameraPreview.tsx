import type { RefObject } from "react";
import { Icon } from "@/components/Icon";
import type { CameraStatus } from "@/hooks/useCamera";

interface CameraPreviewProps {
  videoRef: RefObject<HTMLVideoElement | null>;
  status: CameraStatus;
}

const CHIP_TEXT: Record<CameraStatus, string> = {
  idle: "Camera off",
  "requesting-permissions": "Waiting for permission",
  "camera-ready": "Camera on",
  error: "Camera off",
};

/**
 * The camera stage. The <video> is always mounted so the hook can attach a stream to
 * it. The viewfinder corners sit in the frame's padding, never over the picture. One
 * persistent status chip announces every camera state in words.
 */
export function CameraPreview({ videoRef, status }: CameraPreviewProps) {
  const live = status === "camera-ready";
  const requesting = status === "requesting-permissions";

  return (
    <div className="viewfinder">
      <span className="vf-corner-bl" aria-hidden="true" />
      <span className="vf-corner-br" aria-hidden="true" />
      <div
        className={`relative aspect-[4/3] w-full overflow-hidden rounded-xl ${live ? "bg-black" : "bg-surface"}`}
      >
        <video
          ref={videoRef}
          muted
          playsInline
          aria-label="Live camera preview from your device. Nothing is recorded or sent."
          className={`h-full w-full object-cover ${live ? "" : "invisible"}`}
        />

        {!live && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-6 text-center">
            {requesting ? (
              <span
                aria-hidden="true"
                className="h-9 w-9 animate-spin rounded-full border-4 border-border border-t-primary"
              />
            ) : (
              <Icon name="camera" size={2} className="text-primary" />
            )}
            <p className="text-lg font-bold">
              {requesting ? "Waiting for camera permission…" : "Camera is off"}
            </p>
            {!requesting && (
              <p className="text-caption text-muted">Start the camera to take a photo.</p>
            )}
          </div>
        )}

        <span
          role="status"
          className={`chip absolute left-3 top-3 ${live ? "!border-transparent !bg-black/75 !text-white" : ""}`}
        >
          {live ? (
            <span aria-hidden="true" className="h-2.5 w-2.5 rounded-full bg-accent" />
          ) : requesting ? (
            <span
              aria-hidden="true"
              className="h-3 w-3 animate-spin rounded-full border-2 border-border-strong border-t-primary"
            />
          ) : (
            <Icon name="camera-off" size={0.75} />
          )}
          {CHIP_TEXT[status]}
        </span>
      </div>
    </div>
  );
}
