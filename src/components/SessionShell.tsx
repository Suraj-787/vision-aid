"use client";

import { AskPanel } from "@/components/AskPanel";
import { CameraPreview } from "@/components/CameraPreview";
import { MicrophonePanel } from "@/components/MicrophonePanel";
import { useAsk } from "@/hooks/useAsk";
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

/**
 * Tap-to-Ask: the camera preview (Milestone 1) feeds one captured still; the
 * question is spoken (browser speech recognition) or typed; tapping Ask sends
 * that photo and question to /api/ask (Milestone 5), which asks Gemini and
 * returns the answer. Nothing is sent before Ask.
 *
 * The Milestone 2 microphone test (PCM16) is kept as an optional diagnostic and
 * is stopped automatically when speech input starts, so the two never compete
 * for the microphone.
 */
export function SessionShell() {
  const camera = useCamera();
  const microphone = useMicrophone();
  const cameraActive = camera.status === "camera-ready";

  const ask = useAsk({
    videoRef: camera.videoRef,
    cameraActive,
    onBeforeListen: () => {
      if (microphone.status !== "idle") microphone.stop();
    },
  });

  const listening = ask.phase === "listening";
  const aiValue = ask.phase === "sending" ? "Sending to Gemini…" : "Used only when you tap Ask";
  const micValue = listening
    ? "On (listening for your question)"
    : MIC_DEVICE_VALUE[microphone.status];

  return (
    <section aria-labelledby="session-heading" className="space-y-4">
      <h2 id="session-heading" className="text-xl font-bold">
        Ask about a photo
      </h2>

      <p role="status" className="text-lg font-semibold">
        Status: {SESSION_STATE_LABELS[camera.status]}. {CAMERA_STATUS_TEXT[camera.status]}
      </p>

      {camera.error && (
        <p
          role="alert"
          className="rounded-lg border-2 border-warning-border bg-warning-bg p-3 text-warning-foreground"
        >
          {camera.error.message}
        </p>
      )}

      {/* Stays mounted (the camera hook attaches the stream to its <video>); hidden while a photo is shown. */}
      <div hidden={ask.image !== null}>
        <CameraPreview videoRef={camera.videoRef} status={camera.status} />
      </div>

      <AskPanel
        ask={ask}
        cameraStatus={camera.status}
        onStartCamera={() => void camera.start()}
        onStopCamera={camera.stop}
      />

      <dl className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        {[
          { name: "Camera", value: CAMERA_DEVICE_VALUE[camera.status] },
          { name: "Microphone", value: micValue },
          { name: "AI service", value: aiValue },
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

      <details className="rounded-lg border border-border p-3">
        <summary className="cursor-pointer font-semibold">
          Microphone test (diagnostic, optional)
        </summary>
        <div className="mt-3">
          <MicrophonePanel
            {...microphone}
            start={async () => {
              ask.abortListening(); // speech input and the test must not share the microphone
              await microphone.start();
            }}
          />
        </div>
      </details>
    </section>
  );
}
