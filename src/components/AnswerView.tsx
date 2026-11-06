"use client";

import { useEffect, useRef } from "react";
import { ActionButton } from "@/components/ActionButton";
import type { AskResult } from "@/lib/ask/ask-result";

interface AnswerViewProps {
  result: AskResult;
  onAskAnother: () => void;
}

/**
 * The answer, shown as plain text (never as HTML) in an accessible region. All
 * fields were validated on the server and again in the browser. Focus moves to
 * the heading when it appears; the answer itself is also announced by the
 * panel's live region.
 */
export function AnswerView({ result, onAskAnother }: AnswerViewProps) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => headingRef.current?.focus(), []);

  return (
    <section
      aria-labelledby="answer-heading"
      className="space-y-3 rounded-lg border-2 border-accent bg-surface p-4"
    >
      <h3 id="answer-heading" ref={headingRef} tabIndex={-1} className="text-lg font-bold">
        Answer
      </h3>

      <p className="whitespace-pre-wrap text-xl leading-relaxed">{result.answer}</p>

      {result.details && (
        <div>
          <h4 className="font-semibold">More details</h4>
          <p className="whitespace-pre-wrap">{result.details}</p>
        </div>
      )}

      {result.uncertainty && (
        <div className="rounded-lg border border-warning-border bg-warning-bg p-3 text-warning-foreground">
          <h4 className="font-semibold">What is unclear</h4>
          <p className="whitespace-pre-wrap">{result.uncertainty}</p>
        </div>
      )}

      {result.printed_text && (
        <div>
          <h4 className="font-semibold">Text I could read in the photo</h4>
          <p className="whitespace-pre-wrap rounded-lg border border-border bg-background p-3">
            {result.printed_text}
          </p>
        </div>
      )}

      {result.printed_instructions && (
        <div>
          <h4 className="font-semibold">Printed instructions, copied as written</h4>
          <p className="whitespace-pre-wrap rounded-lg border border-border bg-background p-3">
            {result.printed_instructions}
          </p>
          <p className="mt-1 text-sm text-muted">
            This is only what is printed. VisionAid does not give medical advice or dosing guidance.
            Ask a pharmacist or doctor how to use any medicine.
          </p>
        </div>
      )}

      <p className="text-sm text-muted">
        VisionAid can make mistakes. Do not rely on it for safety, navigation or medical decisions.
      </p>

      <ActionButton variant="primary" onClick={onAskAnother}>
        Ask another question
      </ActionButton>
    </section>
  );
}
