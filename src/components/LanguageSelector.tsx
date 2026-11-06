"use client";

import { Icon } from "@/components/Icon";
import type { useAsk } from "@/hooks/useAsk";
import { isSupportedLang, langInfo, SUPPORTED_LANGS } from "@/lib/speech/types";

type AskController = ReturnType<typeof useAsk>;

/**
 * The language for the spoken question, the requested answer language and the voice
 * that reads the answer: one compact control. Details that matter are shown only when
 * something is wrong (a missing voice, no speech input); when everything is fine they
 * stay available to screen readers instead of cluttering the screen. Nothing changes
 * silently, and the choice is not remembered between visits (nothing is stored).
 */
export function LanguageSelector({ ask }: { ask: AskController }) {
  const listening = ask.phase === "listening";
  const info = langInfo(ask.lang);
  const voice = ask.output.support(ask.lang);
  const voiceProblem = voice.level === "missing" || voice.level === "fallback" || voice.level === "unsupported";
  const voicePrefix =
    voice.level === "available" ? "Available:" : voice.level === "fallback" ? "Partly available:" : voice.level === "checking" ? "Checking:" : "Not available:";
  const notEnglish = info.code !== "en-IN";

  return (
    <section aria-labelledby="language-heading" className="space-y-2">
      <h3 id="language-heading" className="sr-only">
        Language
      </h3>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
        <label htmlFor="app-language" className="flex items-center gap-3 font-bold">
          <Icon name="globe" className="text-primary" />
          Language
        </label>
        <select
          id="app-language"
          value={ask.lang}
          disabled={listening}
          onChange={(event) => {
            if (isSupportedLang(event.target.value)) ask.setLang(event.target.value);
          }}
          aria-describedby="language-help language-voice language-input"
          className="field min-w-0 sm:w-auto"
        >
          {SUPPORTED_LANGS.map((l) => (
            <option key={l.code} value={l.code} lang={l.htmlLang}>
              {l.label}
            </option>
          ))}
        </select>
      </div>

      <p id="language-help" className={notEnglish ? "text-caption text-muted" : "sr-only"}>
        This sets the language your microphone listens for, the language VisionAid asks Google&apos;s
        Gemini to answer in, and the voice that reads the answer. A question written in Hindi or
        Kannada letters is answered in that language whatever is selected here. Typing always works.
        {notEnglish && " Buttons, notices and the expiry and banknote checks stay in English."}
      </p>
      <p
        id="language-voice"
        className={voiceProblem ? "callout callout-warning text-caption" : "sr-only"}
      >
        <span>
          <span className="font-bold">Reading aloud in {info.englishName}: </span>
          {voicePrefix} {voice.message}
        </span>
      </p>
      <p id="language-input" className={notEnglish ? "text-caption text-muted" : "sr-only"}>
        <span className="font-bold">Speaking your question in {info.englishName}: </span>
        {ask.speech.supported
          ? `Your browser decides whether it understands ${info.englishName}. If nothing is recognised, or it is wrong, type your question instead.`
          : "Not available in this browser. Type your question instead."}
      </p>
    </section>
  );
}
