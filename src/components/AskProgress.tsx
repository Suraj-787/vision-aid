"use client";

import { useEffect, useRef } from "react";
import { ActionButton } from "@/components/ActionButton";
import { Icon } from "@/components/Icon";
import type { AskFailure } from "@/lib/ask/client";

/** Shown while the single request to /api/ask is in flight. No fake progress: just what is happening. */
export function SendingView({ question }: { question: string }) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  // The Ask button is replaced by this card, so focus goes to its heading (not lost to the page).
  useEffect(() => headingRef.current?.focus(), []);
  return (
    <section
      aria-labelledby="sending-heading"
      aria-busy="true"
      className="card card-raised rise space-y-3 p-[min(1.25rem,4.5vw)]"
    >
      <h3 id="sending-heading" ref={headingRef} tabIndex={-1} className="flex items-center gap-3 text-xl font-bold">
        <span
          aria-hidden="true"
          className="inline-block h-6 w-6 animate-spin rounded-full border-4 border-border border-t-primary"
        />
        Asking Gemini…
      </h3>
      <blockquote className="whitespace-pre-wrap rounded-xl bg-surface-2 p-3 text-lg">
        {question}
      </blockquote>
      <p className="text-caption text-muted">This usually takes a few seconds. You can cancel at any time.</p>
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
    <section aria-labelledby="failure-heading" className="callout callout-danger rise !flex-col !gap-3">
      <h3
        id="failure-heading"
        ref={headingRef}
        tabIndex={-1}
        className="flex items-center gap-2 text-xl font-bold"
      >
        <Icon name="circle-x" />
        Could not get an answer
      </h3>
      <p role="alert">{error.message}</p>
      {error.retryAfterSeconds !== undefined && (
        <p className="text-caption">
          Please wait about {error.retryAfterSeconds} seconds before trying again.
        </p>
      )}
      <div className="flex flex-wrap gap-3">
        {error.retryable && (
          <ActionButton variant="primary" icon="refresh-cw" onClick={onRetry} disabled={!canRetry}>
            Try again
          </ActionButton>
        )}
        <ActionButton icon="pencil" onClick={onEdit}>
          Edit question
        </ActionButton>
      </div>
    </section>
  );
}
