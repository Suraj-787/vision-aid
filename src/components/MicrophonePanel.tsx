import type { useMicrophone } from "@/hooks/useMicrophone";
import { INPUT_SAMPLE_RATE } from "@/lib/audio/pcm";

type MicrophonePanelProps = ReturnType<typeof useMicrophone>;

const buttonBase =
  "min-h-12 rounded-lg border-2 px-5 py-3 text-base font-semibold aria-disabled:cursor-not-allowed aria-disabled:opacity-60";

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
        <p
          role="alert"
          className="rounded-lg border-2 border-warning-border bg-warning-bg p-3 text-warning-foreground"
        >
          {error.message}
        </p>
      )}

      {status === "listening" && (
        <div className="space-y-1">
          {/* Visual aid only; a constantly changing value is not announced. */}
          <div
            aria-hidden="true"
            className="h-3 w-full overflow-hidden rounded-full border border-border bg-surface"
          >
            <div
              className="h-full bg-accent"
              style={{ width: `${Math.round(meter.level * 100)}%` }}
            />
          </div>
          <p className="text-sm text-muted">
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
          className={`${buttonBase} border-accent bg-accent text-accent-foreground`}
        >
          Start microphone
        </button>
        <button
          type="button"
          aria-disabled={!canStop}
          onClick={() => canStop && stop()}
          className={`${buttonBase} border-border bg-background text-foreground`}
        >
          Stop microphone
        </button>
      </div>

      <p className="text-sm text-muted">
        This only tests that your microphone works. Sound is converted on this
        device and immediately discarded: it is not recorded, saved or sent to
        any service.
      </p>
    </section>
  );
}
