"use client";

import { ActionButton } from "@/components/ActionButton";
import { Icon } from "@/components/Icon";
import type { useAsk } from "@/hooks/useAsk";
import type { A11yPrefs } from "@/lib/a11y/preferences";

type AskController = ReturnType<typeof useAsk>;

/**
 * Always-in-the-same-place voice controls: stop VisionAid's voice at once, and (if
 * enabled) say one command. Shown only when voice guidance or voice commands are on.
 */
export function VoiceBar({ ask, prefs }: { ask: AskController; prefs: A11yPrefs }) {
  const voiceGuided = prefs.mode === "voice-guided";
  const { commands } = ask;
  const showCommands = commands.enabled;
  if (!voiceGuided && !showCommands) return null;

  const busySpeaking = ask.output.speaking;

  return (
    <div role="group" aria-label="Voice controls" className="card space-y-3 p-[min(1rem,4vw)]">
      <div className="flex flex-wrap items-center gap-3">
        {voiceGuided && (
          <ActionButton icon="square" onClick={ask.stopAllSpeech} disabled={!busySpeaking}>
            Stop VisionAid voice
          </ActionButton>
        )}
        {showCommands &&
          (commands.active ? (
            <ActionButton icon="square" variant="primary" onClick={commands.stop}>
              Stop listening
            </ActionButton>
          ) : (
            <ActionButton
              icon="mic"
              onClick={commands.start}
              disabled={busySpeaking}
              onBlockedClick={() => ask.notify("Wait for VisionAid to finish speaking, or stop its voice first.")}
            >
              Say a command
            </ActionButton>
          ))}
      </div>

      {commands.active && (
        <p aria-hidden="true" className="flex items-center gap-2 font-bold text-primary">
          <span className="relative flex h-3 w-3">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-60" />
            <span className="relative inline-flex h-3 w-3 rounded-full bg-primary" />
          </span>
          Listening for one command…
        </p>
      )}

      {showCommands && (
        <p className="text-caption text-muted">
          Say one of: capture photo, retake photo, start speaking, repeat answer, ask. English only. &ldquo;Ask&rdquo;
          only moves to the Ask button; you send by activating it.
        </p>
      )}

      {voiceGuided && !ask.output.supported && (
        <div role="status" className="callout callout-warning text-caption">
          <Icon name="info" className="mt-0.5" />
          <p>
            This browser cannot speak, so voice guidance is silent. Messages are still announced to your screen
            reader and shown on screen.
          </p>
        </div>
      )}

      {ask.output.guidanceNote && (
        <div role="status" className="callout callout-warning text-caption">
          <Icon name="info" className="mt-0.5" />
          <p>{ask.output.guidanceNote}</p>
        </div>
      )}
    </div>
  );
}
