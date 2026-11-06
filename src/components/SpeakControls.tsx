"use client";

import { ActionButton } from "@/components/ActionButton";
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
      <p className="rounded-lg border border-border p-3 text-sm">
        Reading aloud is not available in this browser. The answer is shown as text.
      </p>
    );
  }

  const idle = output.state === "idle";
  const speaking = output.state === "speaking";
  const paused = output.state === "paused";

  const primary = idle
    ? { label: "Listen to answer", onClick: onListen, disabled: false }
    : paused
      ? { label: "Resume", onClick: output.resume, disabled: false }
      : output.pauseUnsupported
        ? { label: "Pause is not available here", onClick: () => {}, disabled: true }
        : { label: "Pause", onClick: output.pause, disabled: false };

  return (
    <div className="space-y-2" role="group" aria-label="Read the answer aloud">
      <div className="flex flex-wrap items-center gap-3">
        <ActionButton variant="primary" onClick={primary.onClick} disabled={primary.disabled}>
          {primary.label}
        </ActionButton>
        <ActionButton onClick={output.stop} disabled={idle}>
          Stop speaking
        </ActionButton>
        {!idle && (
          <p className="font-semibold">{speaking ? "● Reading the answer aloud…" : "❚❚ Paused"}</p>
        )}
      </div>

      {output.error && (
        <p role="alert" className="rounded-lg border-2 border-warning-border bg-warning-bg p-3 text-warning-foreground">
          {output.error.message}
        </p>
      )}

      {output.notes.length > 0 && !output.error && (
        <ul className="list-disc space-y-1 pl-5 text-sm" aria-label="About the voice">
          {output.notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
