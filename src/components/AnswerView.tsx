"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { ActionButton } from "@/components/ActionButton";
import { Icon } from "@/components/Icon";
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

/** Status is words plus a symbol and a tinted banner: never colour alone. */
const EXPIRY_STATUS_STYLE: Record<ExpiryCheck["status"], string> = {
  expired: "callout-danger",
  not_expired: "callout-success",
  unclear: "callout-warning",
};

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="space-y-2 rounded-xl border border-border bg-surface-2 p-4">
      <h4 className="text-lg font-bold">{title}</h4>
      {children}
    </div>
  );
}

function ExpiryCard({ check, notice }: { check: ExpiryCheck; notice: string | null }) {
  const checkedOn = parseIsoDate(check.checked_on);
  return (
    <Section title="Expiry check">
      <p className={`callout ${EXPIRY_STATUS_STYLE[check.status]} font-display text-xl font-bold`}>
        {EXPIRY_STATUS_LABEL[check.status]}
      </p>
      <dl className="space-y-1 text-caption">
        <div>
          <dt className="inline font-bold">Printed on the package: </dt>
          <dd className="inline whitespace-pre-wrap">{check.printed_text ?? "no expiry date found"}</dd>
        </div>
        {check.interpreted_as && (
          <div>
            <dt className="inline font-bold">Read as: </dt>
            <dd className="inline">{check.interpreted_as}</dd>
          </div>
        )}
        {check.manufacturing_text && (
          <div>
            <dt className="inline font-bold">Manufacturing date printed: </dt>
            <dd className="inline">{check.manufacturing_text} (not used as an expiry date)</dd>
          </div>
        )}
        {checkedOn && (
          <div>
            <dt className="inline font-bold">Compared with: </dt>
            <dd className="inline">
              {formatDate(checkedOn)}
              {check.checked_on_source === "server" ? " (from the server's clock)" : " (your device's date)"}
            </dd>
          </div>
        )}
      </dl>
      <p>{check.explanation}</p>
      {check.assumptions.length > 0 && (
        <ul className="list-disc space-y-1 pl-5 text-caption">
          {check.assumptions.map((a) => (
            <li key={a}>{a}</li>
          ))}
        </ul>
      )}
      {notice && <p className="text-caption text-muted">{notice}</p>}
    </Section>
  );
}

function CurrencyCard({ check, notice }: { check: CurrencyCheck; notice: string | null }) {
  const identified = check.status === "identified" && check.denomination !== null;
  return (
    <Section title="Banknote check">
      <p className={`callout ${identified ? "callout-info" : "callout-warning"} font-display text-xl font-bold`}>
        <Icon name="banknote" className="mt-0.5" />
        <span>{identified ? `Appears to be: ₹${check.denomination}` : "? Could not tell the value"}</span>
      </p>
      <p>{check.message}</p>
      {check.evidence && (
        <p className="text-caption">
          <span className="font-bold">What the AI said it saw: </span>
          {check.evidence}
        </p>
      )}
      {notice && <p className="text-caption text-muted">{notice}</p>}
    </Section>
  );
}

/**
 * The answer, shown as plain text (never as HTML) in an accessible region. All
 * fields were validated on the server and again in the browser. Focus moves to
 * the heading when it appears; the answer itself is also announced by the
 * panel's live region. The expiry and banknote cards are produced by VisionAid's
 * own checks (not the AI's wording), and anything VisionAid removed from the AI's
 * reply is listed so the change is never silent. Hierarchy: the answer and its
 * read-aloud controls first, then supporting results, then warnings and sources.
 */
export function AnswerView({ result, onAskAnother, output, onListen, languageNotes }: AnswerViewProps) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => headingRef.current?.focus(), []);

  const notice = (code: keyof typeof NOTICE_TEXT) => (result.notices.includes(code) ? NOTICE_TEXT[code] : null);

  return (
    <section aria-labelledby="answer-heading" className="card card-raised rise space-y-5 p-[min(1.25rem,4.5vw)] sm:p-6">
      <div className="space-y-3">
        <h3
          id="answer-heading"
          ref={headingRef}
          tabIndex={-1}
          className="flex items-center gap-2 text-lg font-bold text-muted"
        >
          <span aria-hidden="true" className="h-2.5 w-2.5 rounded-full bg-accent" />
          Answer
        </h3>
        <p
          lang={htmlLangOf(result.answer)}
          className="whitespace-pre-wrap text-[1.5rem] leading-[1.45]"
        >
          {result.answer}
        </p>
      </div>

      <SpeakControls output={output} onListen={onListen} />

      {languageNotes.length > 0 && (
        <ul className="list-disc space-y-1 pl-5 text-caption text-muted" aria-label="About the language of this answer">
          {languageNotes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      )}

      {result.confidence === "low" && (
        <p role="note" className="callout callout-warning font-bold">
          <Icon name="triangle-alert" className="mt-0.5" />
          <span>I am not sure about this answer. Please double-check it, or retake the photo.</span>
        </p>
      )}

      {result.details && (
        <div>
          <h4 className="text-lg font-bold">More details</h4>
          <p lang={htmlLangOf(result.details)} className="whitespace-pre-wrap">
            {result.details}
          </p>
        </div>
      )}

      {result.expiry_check && <ExpiryCard check={result.expiry_check} notice={notice("expiry_limits")} />}

      {result.currency_check && <CurrencyCard check={result.currency_check} notice={notice("currency_limits")} />}

      {result.uncertainty && (
        <div className="callout callout-warning">
          <Icon name="info" className="mt-0.5" />
          <div>
            <h4 className="font-bold">What is unclear</h4>
            <p lang={htmlLangOf(result.uncertainty)} className="whitespace-pre-wrap">
              {result.uncertainty}
            </p>
          </div>
        </div>
      )}

      {result.printed_text && (
        <div className="space-y-2">
          <h4 className="flex items-center gap-2 text-lg font-bold">
            <Icon name="scan-text" size={1} className="text-primary" />
            Text I could read in the photo
          </h4>
          <p
            lang={htmlLangOf(result.printed_text)}
            className="whitespace-pre-wrap rounded-r-xl border-l-4 border-primary bg-surface-2 p-3"
          >
            {result.printed_text}
          </p>
          <p className="text-caption text-muted">
            Copied from the photo by the AI, not written by it. Check anything important yourself.
          </p>
        </div>
      )}

      {result.printed_instructions && (
        <div className="space-y-2">
          <h4 className="flex items-center gap-2 text-lg font-bold">
            <Icon name="file-text" size={1} className="text-primary" />
            Printed instructions, copied as written
          </h4>
          <p
            lang={htmlLangOf(result.printed_instructions)}
            className="whitespace-pre-wrap rounded-r-xl border-l-4 border-primary bg-surface-2 p-3"
          >
            {result.printed_instructions}
          </p>
          {notice("label_only") && <p className="text-caption text-muted">{notice("label_only")}</p>}
        </div>
      )}

      {!result.printed_instructions && notice("label_only") && (
        <p className="text-caption text-muted">{notice("label_only")}</p>
      )}

      {result.adjustments.length > 0 && (
        <div role="group" className="callout callout-info text-caption" aria-label="Changes VisionAid made to the AI's reply">
          <Icon name="shield-check" className="mt-0.5" />
          <div>
            <p className="font-bold">Changes VisionAid made</p>
            <ul className="list-disc space-y-1 pl-5">
              {result.adjustments.map((code) => (
                <li key={code}>{ADJUSTMENT_TEXT[code]}</li>
              ))}
            </ul>
          </div>
        </div>
      )}

      <p className="flex items-start gap-2 text-caption text-muted">
        <Icon name="info" size={0.9} className="mt-0.5" />
        <span>
          {result.intent !== "unknown" && <>Understood as: {INTENT_LABELS[result.intent]}. </>}
          Confidence: {CONFIDENCE_LABELS[result.confidence]}. This is the AI&apos;s rough guess, not a guarantee.{" "}
          VisionAid can make mistakes. Do not rely on it for safety, navigation or medical decisions.
        </span>
      </p>

      <ActionButton variant="primary" large icon="arrow-right" onClick={onAskAnother}>
        Ask another question
      </ActionButton>
    </section>
  );
}
