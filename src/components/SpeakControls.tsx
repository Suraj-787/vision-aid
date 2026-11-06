"use client";

import { ActionButton } from "@/components/ActionButton";
import { Icon } from "@/components/Icon";
import type { useAsk } from "@/hooks/useAsk";

type Output = ReturnType<typeof useAsk>["output"];

interface SpeakControlsProps {
  output: Output;
  onListen: () => void;
}

/**
 * Read-aloud controls for the displayed answer. Speech starts only when Listen is
 * pressed. The first button keeps its place in the page as its label changes
 * (Listen → Pause → Resume), so keyboard and screen-reader focus is not lost; the
 * state is also written out as text. The answer is always shown as text too.
 */
export function SpeakControls({ output, onListen }: SpeakControlsProps) {
  if (!output.supported) {
    return (
      <p className="callout callout-info text-caption">
        Reading aloud is not available in this browser. The answer is shown as text.
      </p>
    );
  }

  const idle = output.state === "idle";
  const speaking = output.state === "speaking";
  const paused = output.state === "paused";

  const primary = idle
    ? { label: "Listen to answer", icon: "volume-2" as const, onClick: onListen, disabled: false }
    : paused
      ? { label: "Resume", icon: "play" as const, onClick: output.resume, disabled: false }
      : output.pauseUnsupported
        ? { label: "Pause is not available here", icon: "pause" as const, onClick: () => {}, disabled: true }
        : { label: "Pause", icon: "pause" as const, onClick: output.pause, disabled: false };

  return (
    <div className="space-y-3" role="group" aria-label="Read the answer aloud">
      <div className="flex flex-wrap items-center gap-3">
        <ActionButton variant="primary" icon={primary.icon} onClick={primary.onClick} disabled={primary.disabled}>
          {primary.label}
        </ActionButton>
        <ActionButton icon="square" onClick={output.stop} disabled={idle}>
          Stop speaking
        </ActionButton>
      </div>

      {!idle && (
        <p className="flex items-center gap-2 font-bold text-primary">
          <Icon name={speaking ? "volume-2" : "pause"} size={0.95} />
          {speaking ? "Reading the answer aloud…" : "Paused"}
        </p>
      )}

      {output.error && (
        <div role="alert" className="callout callout-warning">
          <Icon name="triangle-alert" className="mt-0.5" />
          <p>{output.error.message}</p>
        </div>
      )}

      {output.notes.length > 0 && !output.error && (
        <ul className="list-disc space-y-1 pl-5 text-caption text-muted" aria-label="About the voice">
          {output.notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
