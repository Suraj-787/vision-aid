"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { ActionButton } from "@/components/ActionButton";
import { SpeakControls } from "@/components/SpeakControls";
import {
  ADJUSTMENT_TEXT,
  CONFIDENCE_LABELS,
  INTENT_LABELS,
  NOTICE_TEXT,
  type AskResult,
} from "@/lib/ask/ask-result";
import type { CurrencyCheck } from "@/lib/ask/currency";
import { formatDate, parseIsoDate } from "@/lib/ask/dates";
import type { ExpiryCheck } from "@/lib/ask/expiry";
import { detectAnswerLanguage } from "@/lib/speech/script";
import { langInfo } from "@/lib/speech/types";
import type { useAsk } from "@/hooks/useAsk";

interface AnswerViewProps {
  result: AskResult;
  onAskAnother: () => void;
  output: ReturnType<typeof useAsk>["output"];
  onListen: () => void;
  /** Honest notes about the answer's language (e.g. asked for Hindi, got English). */
  languageNotes: string[];
}

/** The HTML lang of a piece of text, so a screen reader uses the right pronunciation. */
function htmlLangOf(text: string | null): string | undefined {
  const lang = text ? detectAnswerLanguage(text) : null;
  return lang ? langInfo(lang).htmlLang : undefined;
}

const EXPIRY_STATUS_LABEL: Record<ExpiryCheck["status"], string> = {
  expired: "✕ Expired",
  not_expired: "✓ Not expired yet",
  unclear: "? Unclear",
};

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="space-y-2 rounded-lg border-2 border-border bg-background p-3">
      <h4 className="font-semibold">{title}</h4>
      {children}
    </div>
  );
}

function ExpiryCard({ check, notice }: { check: ExpiryCheck; notice: string | null }) {
  const checkedOn = parseIsoDate(check.checked_on);
  return (
    <Card title="Expiry check">
      <p className="text-lg font-bold">{EXPIRY_STATUS_LABEL[check.status]}</p>
      <dl className="space-y-1 text-sm">
        <div>
          <dt className="inline font-semibold">Printed on the package: </dt>
          <dd className="inline whitespace-pre-wrap">{check.printed_text ?? "no expiry date found"}</dd>
        </div>
        {check.interpreted_as && (
          <div>
            <dt className="inline font-semibold">Read as: </dt>
            <dd className="inline">{check.interpreted_as}</dd>
          </div>
        )}
        {check.manufacturing_text && (
          <div>
            <dt className="inline font-semibold">Manufacturing date printed: </dt>
            <dd className="inline">{check.manufacturing_text} (not used as an expiry date)</dd>
          </div>
        )}
        {checkedOn && (
          <div>
            <dt className="inline font-semibold">Compared with: </dt>
            <dd className="inline">
              {formatDate(checkedOn)}
              {check.checked_on_source === "server" ? " (from the server's clock)" : " (your device's date)"}
            </dd>
          </div>
        )}
      </dl>
      <p>{check.explanation}</p>
      {check.assumptions.length > 0 && (
        <ul className="list-disc space-y-1 pl-5 text-sm">
          {check.assumptions.map((a) => (
            <li key={a}>{a}</li>
          ))}
        </ul>
      )}
      {notice && <p className="text-sm text-muted">{notice}</p>}
    </Card>
  );
}

function CurrencyCard({ check, notice }: { check: CurrencyCheck; notice: string | null }) {
  return (
    <Card title="Banknote check">
      {check.status === "identified" && check.denomination !== null ? (
        <p className="text-lg font-bold">Appears to be: ₹{check.denomination}</p>
      ) : (
        <p className="text-lg font-bold">? Could not tell the value</p>
      )}
      <p>{check.message}</p>
      {check.evidence && (
        <p className="text-sm">
          <span className="font-semibold">What the AI said it saw: </span>
          {check.evidence}
        </p>
      )}
      {notice && <p className="text-sm text-muted">{notice}</p>}
    </Card>
  );
}

/**
 * The answer, shown as plain text (never as HTML) in an accessible region. All
 * fields were validated on the server and again in the browser. Focus moves to
 * the heading when it appears; the answer itself is also announced by the
 * panel's live region. The expiry and banknote cards are produced by VisionAid's
 * own checks (not the AI's wording), and anything VisionAid removed from the AI's
 * reply is listed so the change is never silent.
 */
export function AnswerView({ result, onAskAnother, output, onListen, languageNotes }: AnswerViewProps) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => headingRef.current?.focus(), []);

  const notice = (code: keyof typeof NOTICE_TEXT) => (result.notices.includes(code) ? NOTICE_TEXT[code] : null);

  return (
    <section
      aria-labelledby="answer-heading"
      className="space-y-3 rounded-lg border-2 border-accent bg-surface p-4"
    >
      <h3 id="answer-heading" ref={headingRef} tabIndex={-1} className="text-lg font-bold">
        Answer
      </h3>

      <p lang={htmlLangOf(result.answer)} className="whitespace-pre-wrap text-xl leading-relaxed">
        {result.answer}
      </p>

      <SpeakControls output={output} onListen={onListen} />

      {languageNotes.length > 0 && (
        <ul className="list-disc space-y-1 pl-5 text-sm" aria-label="About the language of this answer">
          {languageNotes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      )}

      <p className="text-sm text-muted">
        {result.intent !== "unknown" && <>Understood as: {INTENT_LABELS[result.intent]}. </>}
        Confidence: {CONFIDENCE_LABELS[result.confidence]}. This is the AI&apos;s rough guess, not a guarantee.
      </p>

      {result.confidence === "low" && (
        <p
          role="note"
          className="rounded-lg border border-warning-border bg-warning-bg p-3 font-semibold text-warning-foreground"
        >
          I am not sure about this answer. Please double-check it, or retake the photo.
        </p>
      )}

      {result.details && (
        <div>
          <h4 className="font-semibold">More details</h4>
          <p lang={htmlLangOf(result.details)} className="whitespace-pre-wrap">{result.details}</p>
        </div>
      )}

      {result.expiry_check && <ExpiryCard check={result.expiry_check} notice={notice("expiry_limits")} />}

      {result.currency_check && <CurrencyCard check={result.currency_check} notice={notice("currency_limits")} />}

      {result.uncertainty && (
        <div className="rounded-lg border border-warning-border bg-warning-bg p-3 text-warning-foreground">
          <h4 className="font-semibold">What is unclear</h4>
          <p lang={htmlLangOf(result.uncertainty)} className="whitespace-pre-wrap">{result.uncertainty}</p>
        </div>
      )}

      {result.printed_text && (
        <div>
          <h4 className="font-semibold">Text I could read in the photo</h4>
          <p lang={htmlLangOf(result.printed_text)} className="whitespace-pre-wrap rounded-lg border border-border bg-background p-3">
            {result.printed_text}
          </p>
          <p className="mt-1 text-sm text-muted">
            Copied from the photo by the AI, not written by it. Check anything important yourself.
          </p>
        </div>
      )}

      {result.printed_instructions && (
        <div>
          <h4 className="font-semibold">Printed instructions, copied as written</h4>
          <p lang={htmlLangOf(result.printed_instructions)} className="whitespace-pre-wrap rounded-lg border border-border bg-background p-3">
            {result.printed_instructions}
          </p>
          {notice("label_only") && <p className="mt-1 text-sm text-muted">{notice("label_only")}</p>}
        </div>
      )}

      {!result.printed_instructions && notice("label_only") && (
        <p className="text-sm text-muted">{notice("label_only")}</p>
      )}

      {result.adjustments.length > 0 && (
        <div role="group" className="rounded-lg border border-border p-3 text-sm" aria-label="Changes VisionAid made to the AI's reply">
          <p className="font-semibold">Changes VisionAid made</p>
          <ul className="list-disc space-y-1 pl-5">
            {result.adjustments.map((code) => (
              <li key={code}>{ADJUSTMENT_TEXT[code]}</li>
            ))}
          </ul>
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
