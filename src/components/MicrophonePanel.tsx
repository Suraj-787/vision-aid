import type { useMicrophone } from "@/hooks/useMicrophone";
import { INPUT_SAMPLE_RATE } from "@/lib/audio/pcm";

type MicrophonePanelProps = ReturnType<typeof useMicrophone>;


export function MicrophonePanel({
  status,
  error,
  meter,
  inputSampleRate,
  start,
  stop,
}: MicrophonePanelProps) {
  const canStart = status === "idle" || status === "error";
  const canStop = status === "requesting-permissions" || status === "listening";

  const statusText = {
    idle: "Microphone is off.",
    "requesting-permissions":
      "Requesting microphone permission. Please respond to your browser's prompt.",
    listening: meter.heardSound
      ? "Microphone is on and picking up sound. Audio is processed on this device only and discarded; nothing is recorded or sent."
      : "Microphone is on. No sound detected yet. Audio is processed on this device only and discarded; nothing is recorded or sent.",
    error: "Microphone is off.",
  }[status];

  return (
    <section aria-labelledby="mic-heading" className="space-y-3">
      <h3 id="mic-heading" className="text-lg font-bold">
        Microphone test
      </h3>

      <p role="status">{statusText}</p>

      {error && (
        <p role="alert" className="callout callout-danger">
          {error.message}
        </p>
      )}

      {status === "listening" && (
        <div className="space-y-1">
          {/* Visual aid only; a constantly changing value is not announced. */}
          <div
            aria-hidden="true"
            className="h-3 w-full overflow-hidden rounded-full border border-border-strong bg-surface"
          >
            <div
              className="h-full bg-primary"
              style={{ width: `${Math.round(meter.level * 100)}%` }}
            />
          </div>
          <p className="text-caption text-muted">
            Converted {meter.seconds.toFixed(1)} s of audio to{" "}
            {INPUT_SAMPLE_RATE / 1000} kHz mono 16-bit PCM (device rate{" "}
            {inputSampleRate} Hz).
          </p>
        </div>
      )}

      <div className="flex flex-col gap-3 sm:flex-row">
        <button
          type="button"
          aria-disabled={!canStart}
          onClick={() => canStart && void start()}
          className="btn btn-primary"
        >
          Start microphone
        </button>
        <button
          type="button"
          aria-disabled={!canStop}
          onClick={() => canStop && stop()}
          className="btn btn-secondary"
        >
          Stop microphone
        </button>
      </div>

      <p className="text-caption text-muted">
        This only tests that your microphone works. Sound is converted on this
        device and immediately discarded: it is not recorded, saved or sent to
        any service.
      </p>
    </section>
  );
}
