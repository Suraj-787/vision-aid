"use client";

import { ActionButton } from "@/components/ActionButton";
import type { useAsk } from "@/hooks/useAsk";
import { MAX_QUESTION_CHARS } from "@/lib/ask/ask-flow";
import { SUPPORTED_LANGS, type SupportedLang } from "@/lib/speech/types";

type AskController = ReturnType<typeof useAsk>;

/** Typed question (always available) plus optional browser speech input. */
export function QuestionInput({ ask }: { ask: AskController }) {
  const listening = ask.phase === "listening";
  const locked = listening || ask.phase === "ready-to-submit";

  return (
    <section aria-labelledby="question-heading" className="space-y-3">
      <h3 id="question-heading" className="text-lg font-bold">
        Your question
      </h3>

      <div className="space-y-1">
        <label htmlFor="question-input" className="block font-semibold">
          Type your question
        </label>
        <textarea
          id="question-input"
          rows={3}
          maxLength={MAX_QUESTION_CHARS}
          value={ask.question}
          readOnly={locked}
          onChange={(event) => ask.setQuestion(event.target.value)}
          aria-describedby="question-help"
          placeholder="For example: What does this label say?"
          autoCapitalize="sentences"
          spellCheck
          className="w-full rounded-lg border-2 border-border bg-background p-3 text-lg text-foreground read-only:bg-surface"
        />
        <p id="question-help" className="text-sm text-muted">
          Up to {MAX_QUESTION_CHARS} characters. You can edit anything that was recognised from
          your speech.
        </p>
      </div>

      {ask.speech.supported ? (
        <div className="space-y-2">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="space-y-1">
              <label htmlFor="speech-lang" className="block text-sm font-semibold">
                Speech language
              </label>
              <select
                id="speech-lang"
                value={ask.lang}
                disabled={listening}
                onChange={(event) => {
                  const match = SUPPORTED_LANGS.find((l) => l.code === event.target.value);
                  if (match) ask.setLang(match.code as SupportedLang);
                }}
                className="min-h-12 w-full rounded-lg border-2 border-border bg-background px-3 text-base text-foreground sm:w-auto"
              >
                {SUPPORTED_LANGS.map((l) => (
                  <option key={l.code} value={l.code}>
                    {l.label}
                  </option>
                ))}
              </select>
            </div>
            <ActionButton
              onClick={listening ? ask.stopListening : ask.startListening}
              disabled={!listening && !ask.can.listen}
            >
              {listening ? "Stop speaking" : "Start speaking"}
            </ActionButton>
          </div>

          {listening && (
            <p aria-hidden="true" className="font-semibold text-accent">
              ● Listening… speak your question, then tap Stop speaking.
            </p>
          )}

          <p className="text-sm text-muted">
            Speech recognition is done by your browser. It may send your voice to its own speech
            service to turn it into text, so use the typed box if you prefer. Hindi and Kannada
            support varies by browser and has not been evaluated yet.
          </p>
        </div>
      ) : (
        <p className="text-sm text-muted">
          Speech input is not available in this browser. Type your question instead.
        </p>
      )}

      {ask.speech.error && (
        <p
          role="alert"
          className="rounded-lg border-2 border-warning-border bg-warning-bg p-3 text-warning-foreground"
        >
          {ask.speech.error.message}
        </p>
      )}
    </section>
  );
}
