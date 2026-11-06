"use client";

import { ActionButton } from "@/components/ActionButton";
import { Icon } from "@/components/Icon";
import type { useAsk } from "@/hooks/useAsk";
import { MAX_QUESTION_CHARS } from "@/lib/ask/ask-flow";
import { langInfo } from "@/lib/speech/types";

type AskController = ReturnType<typeof useAsk>;

/** Typed question (always available) plus optional browser speech input. */
export function QuestionInput({ ask }: { ask: AskController }) {
  const listening = ask.phase === "listening";

  return (
    <section aria-labelledby="question-heading" className="space-y-3">
      <h3 id="question-heading" className="text-xl font-bold">
        Your question
      </h3>

      <div className="space-y-1.5">
        <label htmlFor="question-input" className="block font-bold">
          Type your question
        </label>
        <textarea
          id="question-input"
          rows={3}
          maxLength={MAX_QUESTION_CHARS}
          value={ask.question}
          readOnly={listening}
          onChange={(event) => ask.setQuestion(event.target.value)}
          aria-describedby="question-help"
          placeholder="For example: What does this label say?"
          autoCapitalize="sentences"
          spellCheck
          className="field min-h-28 text-lg"
        />
        <p id="question-help" className="text-caption text-muted">
          Up to {MAX_QUESTION_CHARS} characters. You can edit anything recognised from your speech.
        </p>
      </div>

      {ask.speech.supported ? (
        <div className="space-y-2">
          <ActionButton
            icon={listening ? "square" : "mic"}
            variant={listening ? "primary" : "secondary"}
            onClick={listening ? ask.stopListening : ask.startListening}
            disabled={!listening && !ask.can.listen}
          >
            {listening ? "Stop speaking" : `Start speaking (${langInfo(ask.lang).englishName})`}
          </ActionButton>

          {listening && (
            <p aria-hidden="true" className="flex items-center gap-2 font-bold text-primary">
              <span className="relative flex h-3 w-3">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-60" />
                <span className="relative inline-flex h-3 w-3 rounded-full bg-primary" />
              </span>
              Listening… speak your question, then tap Stop speaking.
            </p>
          )}

          <p className="text-caption text-muted">
            Your browser does the speech recognition and may send your voice to its own speech
            service. Typing is always available.
          </p>
        </div>
      ) : (
        <p className="callout callout-info text-caption">
          Speech input is not available in this browser. Type your question instead.
        </p>
      )}

      {ask.speech.error && (
        <div role="alert" className="callout callout-danger">
          <Icon name="triangle-alert" className="mt-0.5" />
          <p>{ask.speech.error.message}</p>
        </div>
      )}
    </section>
  );
}
