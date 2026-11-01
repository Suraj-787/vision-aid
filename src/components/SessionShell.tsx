"use client";

import { CameraPreview } from "@/components/CameraPreview";
import { MicrophonePanel } from "@/components/MicrophonePanel";
import { useCamera, type CameraStatus } from "@/hooks/useCamera";
import { useMicrophone, type MicrophoneStatus } from "@/hooks/useMicrophone";
import { SESSION_STATE_LABELS } from "@/lib/session-state";

const CAMERA_STATUS_TEXT: Record<CameraStatus, string> = {
  idle: "Camera is off.",
  "requesting-permissions":
    "Requesting camera permission. Please respond to your browser's prompt.",
  "camera-ready":
    "Camera preview is on. It is shown on this device only; nothing is recorded or sent.",
  error: "Camera is off.",
};

const CAMERA_DEVICE_VALUE: Record<CameraStatus, string> = {
  idle: "Off",
  "requesting-permissions": "Waiting for permission",
  "camera-ready": "On (preview only)",
  error: "Off (error)",
};

const MIC_DEVICE_VALUE: Record<MicrophoneStatus, string> = {
  idle: "Off",
  "requesting-permissions": "Waiting for permission",
  listening: "On (test only)",
  error: "Off (error)",
};

const buttonBase =
  "min-h-12 rounded-lg border-2 px-5 py-3 text-base font-semibold aria-disabled:cursor-not-allowed aria-disabled:opacity-60";

/**
 * Milestones 1-2: local camera preview and a local microphone test, controlled
 * independently. No frame capture, no audio recording, no network calls.
 * Buttons use aria-disabled (not `disabled`) so they stay
 * focusable and keyboard focus is not lost when their state changes.
 */
export function SessionShell() {
  const { videoRef, status, error, start, stop } = useCamera();
  const microphone = useMicrophone();

  const canStart = status === "idle" || status === "error";
  const canStop = status === "requesting-permissions" || status === "camera-ready";

  return (
    <section aria-labelledby="session-heading" className="space-y-4">
      <h2 id="session-heading" className="text-xl font-bold">
        Session
      </h2>

      <p role="status" className="text-lg font-semibold">
        Status: {SESSION_STATE_LABELS[status]}. {CAMERA_STATUS_TEXT[status]}
      </p>

      {error && (
        <p
          role="alert"
          className="rounded-lg border-2 border-warning-border bg-warning-bg p-3 text-warning-foreground"
        >
          {error.message}
        </p>
      )}

      <CameraPreview videoRef={videoRef} status={status} />

      <dl className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        {[
          { name: "Camera", value: CAMERA_DEVICE_VALUE[status] },
          { name: "Microphone", value: MIC_DEVICE_VALUE[microphone.status] },
          { name: "AI connection", value: "Not connected" },
        ].map(({ name, value }) => (
          <div
            key={name}
            className="rounded-lg border border-border bg-surface px-4 py-3"
          >
            <dt className="text-sm text-muted">{name}</dt>
            <dd className="font-semibold">{value}</dd>
          </div>
        ))}
      </dl>

      <div className="flex flex-col gap-3 sm:flex-row">
        <button
          type="button"
          aria-disabled={!canStart}
          onClick={() => canStart && void start()}
          className={`${buttonBase} border-accent bg-accent text-accent-foreground`}
        >
          Start camera
        </button>
        <button
          type="button"
          aria-disabled={!canStop}
          onClick={() => canStop && stop()}
          className={`${buttonBase} border-border bg-background text-foreground`}
        >
          Stop camera
        </button>
      </div>

      <p className="text-sm text-muted">
        Starting the camera shows a preview on this device only. No camera
        frames are captured or sent to any service. The microphone is separate
        and stays off until you start it below.
      </p>

      <MicrophonePanel {...microphone} />
    </section>
  );
}
