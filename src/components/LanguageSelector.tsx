"use client";

import type { useAsk } from "@/hooks/useAsk";
import { isSupportedLang, langInfo, SUPPORTED_LANGS } from "@/lib/speech/types";
import type { VoiceSupportLevel } from "@/lib/speech/voices";

type AskController = ReturnType<typeof useAsk>;

/** A text prefix, so availability is never conveyed by colour or an icon alone. */
const LEVEL_PREFIX: Record<VoiceSupportLevel, string> = {
  available: "Available:",
  fallback: "Partly available:",
  missing: "Not available:",
  unsupported: "Not available:",
  checking: "Checking:",
};

/**
 * The language for the spoken question, the requested answer language and the
 * voice that reads the answer. Changing it never changes anything silently: the
 * messages below say what this browser and device can and cannot do for the
 * chosen language. It is not remembered between visits (nothing is stored).
 */
export function LanguageSelector({ ask }: { ask: AskController }) {
  const listening = ask.phase === "listening";
  const info = langInfo(ask.lang);
  const voice = ask.output.support(ask.lang);

  return (
    <section aria-labelledby="language-heading" className="space-y-2 rounded-lg border border-border bg-surface p-3">
      <h3 id="language-heading" className="text-lg font-bold">
        Language
      </h3>
      <div className="space-y-1">
        <label htmlFor="app-language" className="block font-semibold">
          Language for speaking, answers and reading aloud
        </label>
        <select
          id="app-language"
          value={ask.lang}
          disabled={listening}
          onChange={(event) => {
            if (isSupportedLang(event.target.value)) ask.setLang(event.target.value);
          }}
          aria-describedby="language-help language-voice language-input"
          className="min-h-12 w-full rounded-lg border-2 border-border bg-background px-3 text-base text-foreground sm:w-auto"
        >
          {SUPPORTED_LANGS.map((l) => (
            <option key={l.code} value={l.code} lang={l.htmlLang}>
              {l.label}
            </option>
          ))}
        </select>
      </div>

      <p id="language-help" className="text-sm text-muted">
        This sets the language your microphone listens for, the language VisionAid asks Google&apos;s
        Gemini to answer in, and the voice that reads the answer. Typing always works.
        {info.code !== "en-IN" && " Buttons, notices and the expiry and banknote checks stay in English."}
      </p>
      <p id="language-voice" className="text-sm">
        <span className="font-semibold">Reading aloud in {info.englishName}: </span>
        {LEVEL_PREFIX[voice.level]} {voice.message}
      </p>
      <p id="language-input" className="text-sm">
        <span className="font-semibold">Speaking your question in {info.englishName}: </span>
        {ask.speech.supported
          ? `Your browser decides whether it understands ${info.englishName}. If nothing is recognised, or it is wrong, type your question instead.`
          : "Not available in this browser. Type your question instead."}
      </p>
    </section>
  );
}
