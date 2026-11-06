"use client";

import { AskPanel } from "@/components/AskPanel";
import { CameraPreview } from "@/components/CameraPreview";
import { Icon } from "@/components/Icon";
import { MicrophonePanel } from "@/components/MicrophonePanel";
import { useAsk } from "@/hooks/useAsk";
import { useCamera } from "@/hooks/useCamera";
import { useMicrophone } from "@/hooks/useMicrophone";

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

  return (
    <section aria-labelledby="session-heading" className="space-y-5">
      <h2 id="session-heading" className="sr-only">
        Ask about a photo
      </h2>

      {camera.error && (
        <div role="alert" className="callout callout-danger">
          <Icon name="camera-off" className="mt-0.5" />
          <p>{camera.error.message}</p>
        </div>
      )}

      <AskPanel
        ask={ask}
        cameraStatus={camera.status}
        onStartCamera={() => void camera.start()}
        onStopCamera={camera.stop}
        preview={<CameraPreview videoRef={camera.videoRef} status={camera.status} />}
      />

      <details className="card">
        <summary className="flex min-h-12 cursor-pointer items-center gap-3 px-[min(1rem,4vw)] py-2 font-bold">
          <Icon name="mic" className="text-primary" />
          <span className="flex-1 font-display text-base">Microphone test (diagnostic, optional)</span>
          <Icon name="chevron-down" size={0.9} className="chevron" />
        </summary>
        <div className="border-t border-border p-[min(1rem,4vw)]">
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
