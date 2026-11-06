"use client";

import { useEffect, useRef } from "react";
import { ActionButton } from "@/components/ActionButton";
import type { AskFailure } from "@/lib/ask/client";

/** Shown while the single request to /api/ask is in flight. */
export function SendingView({ question }: { question: string }) {
  return (
    <section
      aria-labelledby="sending-heading"
      aria-busy="true"
      className="space-y-3 rounded-lg border-2 border-accent bg-surface p-4"
    >
      <h3 id="sending-heading" className="flex items-center gap-3 text-lg font-bold">
        <span
          aria-hidden="true"
          className="inline-block h-5 w-5 animate-spin rounded-full border-4 border-border border-t-accent"
        />
        Asking Gemini…
      </h3>
      <p>Your question:</p>
      <blockquote className="whitespace-pre-wrap rounded-lg border border-border bg-background p-3 text-lg">
        {question}
      </blockquote>
      <p className="text-sm text-muted">
        This usually takes a few seconds. You can cancel at any time.
      </p>
    </section>
  );
}

interface SendFailureProps {
  error: AskFailure;
  canRetry: boolean;
  onRetry: () => void;
  onEdit: () => void;
}

/** Shown when the request failed. Retry is offered only when trying again could help. */
export function SendFailure({ error, canRetry, onRetry, onEdit }: SendFailureProps) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => headingRef.current?.focus(), []);

  return (
    <section
      aria-labelledby="failure-heading"
      className="space-y-3 rounded-lg border-2 border-warning-border bg-warning-bg p-4 text-warning-foreground"
    >
      <h3 id="failure-heading" ref={headingRef} tabIndex={-1} className="text-lg font-bold">
        Could not get an answer
      </h3>
      <p role="alert">{error.message}</p>
      {error.retryAfterSeconds !== undefined && (
        <p className="text-sm">
          Please wait about {error.retryAfterSeconds} seconds before trying again.
        </p>
      )}
      <div className="flex flex-wrap gap-3">
        {error.retryable && (
          <ActionButton variant="primary" onClick={onRetry} disabled={!canRetry}>
            Try again
          </ActionButton>
        )}
        <ActionButton onClick={onEdit}>Edit question</ActionButton>
      </div>
    </section>
  );
}
