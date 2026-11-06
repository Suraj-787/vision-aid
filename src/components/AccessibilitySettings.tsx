"use client";

import { Icon } from "@/components/Icon";
import type { useAsk } from "@/hooks/useAsk";
import type { A11yPrefs, InteractionMode } from "@/lib/a11y/preferences";
import { isSupportedLang, SUPPORTED_LANGS } from "@/lib/speech/types";

type AskController = ReturnType<typeof useAsk>;

interface AccessibilitySettingsProps {
  ask: AskController;
  prefs: A11yPrefs;
  update: (change: Partial<A11yPrefs>) => void;
}

const MODES: Array<{ value: InteractionMode; label: string; help: string }> = [
  {
    value: "screen-reader",
    label: "Screen reader (default)",
    help: "Use TalkBack or VoiceOver. VisionAid does not speak by itself: its messages are announced to your screen reader.",
  },
  {
    value: "voice-guided",
    label: "Voice guided",
    help: "VisionAid speaks short instructions at each step, using your device's voices. Turn this on only if you do not use a screen reader, or you will hear messages twice.",
  },
];

/**
 * How VisionAid should talk to the person. Collapsed by default; the current choice is
 * in the heading row so it is known without opening it. Only these three choices are
 * remembered in this browser (never photos, questions, answers or transcripts).
 */
export function AccessibilitySettings({ ask, prefs, update }: AccessibilitySettingsProps) {
  const voiceGuided = prefs.mode === "voice-guided";

  const chooseMode = (mode: InteractionMode) => {
    if (mode === prefs.mode) return;
    update({ mode });
    if (mode === "voice-guided") {
      ask.notify("Voice guided mode is on.");
      ask.speakWelcome(); // the person's own choice is the tap that lets the browser speak
    } else {
      ask.stopAllSpeech();
      ask.notify("Screen reader mode is on. VisionAid will not speak by itself.");
    }
  };

  return (
    <section aria-labelledby="a11y-heading" className="card">
      <details>
        <summary className="flex min-h-14 cursor-pointer items-center gap-3 px-[min(1rem,4vw)] py-2 font-bold sm:px-5">
          <Icon name="eye" className="text-primary" />
          <h2 id="a11y-heading" className="flex-1 text-base font-bold">
            Accessibility settings
            <span className="block text-caption font-normal text-muted">
              Now: {voiceGuided ? "Voice guided" : "Screen reader"}
            </span>
          </h2>
          <Icon name="chevron-down" size={0.9} className="chevron" />
        </summary>

        <div className="space-y-5 border-t border-border px-[min(1rem,4vw)] pb-5 pt-4 sm:px-5">
          <fieldset className="space-y-2">
            <legend className="mb-1 font-bold">How should VisionAid talk to you?</legend>
            {MODES.map((m) => (
              <label
                key={m.value}
                className="flex min-h-12 cursor-pointer items-start gap-3 rounded-xl border border-border-strong p-3 has-[:checked]:border-primary has-[:checked]:bg-surface-2"
              >
                <input
                  type="radio"
                  name="interaction-mode"
                  value={m.value}
                  checked={prefs.mode === m.value}
                  onChange={() => chooseMode(m.value)}
                  aria-describedby={`mode-help-${m.value}`}
                  className="mt-0.5 h-6 w-6 shrink-0 accent-[var(--primary)]"
                />
                <span>
                  <span className="block font-bold">{m.label}</span>
                  <span id={`mode-help-${m.value}`} className="block text-caption text-muted">
                    {m.help}
                  </span>
                </span>
              </label>
            ))}
          </fieldset>

          <div className="space-y-3">
            <label className="flex min-h-12 items-start gap-3">
              <input
                type="checkbox"
                checked={prefs.autoReadAnswers}
                disabled={!voiceGuided}
                onChange={(event) => update({ autoReadAnswers: event.target.checked })}
                aria-describedby="auto-read-help"
                className="mt-0.5 h-6 w-6 shrink-0 accent-[var(--primary)]"
              />
              <span>
                <span className="block font-bold">Read answers aloud automatically</span>
                <span id="auto-read-help" className="block text-caption text-muted">
                  {voiceGuided
                    ? "When an answer is ready, VisionAid reads it out. You can stop it at any time."
                    : "Only available in Voice guided mode. In Screen reader mode answers are never read automatically."}
                </span>
              </span>
            </label>

            <label className="flex min-h-12 items-start gap-3">
              <input
                type="checkbox"
                checked={prefs.voiceCommands}
                onChange={(event) => update({ voiceCommands: event.target.checked })}
                aria-describedby="commands-help"
                className="mt-0.5 h-6 w-6 shrink-0 accent-[var(--primary)]"
              />
              <span>
                <span className="block font-bold">Voice commands (English)</span>
                <span id="commands-help" className="block text-caption text-muted">
                  Adds a Say a command button. Each tap listens for one command, then stops: VisionAid never listens
                  in the background. Your browser may send your voice to its own speech service. Asking still needs the
                  Ask button.
                </span>
              </span>
            </label>
          </div>

          <div className="space-y-1">
            <label htmlFor="pref-language" className="block font-bold">
              Language for spoken guidance
            </label>
            <select
              id="pref-language"
              value={ask.lang}
              onChange={(event) => {
                if (isSupportedLang(event.target.value)) ask.setLang(event.target.value);
              }}
              className="field sm:w-auto"
            >
              {SUPPORTED_LANGS.map((l) => (
                <option key={l.code} value={l.code} lang={l.htmlLang}>
                  {l.label}
                </option>
              ))}
            </select>
            <p className="text-caption text-muted">
              The same choice is used for your question, the answer and the voice. If no voice for it is installed,
              VisionAid says so and does not speak in another language.
            </p>
          </div>

          <p className="text-caption text-muted">
            Saved in this browser: only these settings. Never photos, questions, answers or what you say.
          </p>
        </div>
      </details>
    </section>
  );
}
