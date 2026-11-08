/**
 * Voice commands (Milestone 9, optional, English only; state rules rebuilt in Milestone 10).
 *
 * One command is heard per explicit activation of "Say a command": the microphone is
 * never left open. A command must be the WHOLE utterance (no word spotting), so ordinary
 * speech cannot trigger an action by accident.
 *
 * Which commands work is decided by ONE table (AVAILABLE) keyed by the step the person is
 * on. A command that does not fit the step is never silently ignored: the person gets a
 * reason written for that step (commandUnavailable) on screen and by announcement.
 *
 * Deliberately NOT voice commands:
 *  - Stop listening / Stop speaking. While dictating, the microphone is busy with the
 *    question, and while VisionAid speaks the microphone must be off (it would hear
 *    VisionAid). Both stay buttons (and Escape stops speech).
 *
 * Commands with a consequence:
 *  - Done discards the photo, question and answer on this device (the same as the Done
 *    button) and returns to taking a photo. Nothing is sent, and nothing is deleted at Google.
 *  - Ask / send. By default the spoken word "ask" only moves focus to the Ask button, because
 *    sending the photo and question to Google Gemini needs the person's deliberate action. The
 *    person can turn on "Ask by voice" in the accessibility settings; then the same word sends
 *    (see effectiveVoiceAsk).
 */
import type { StoredPhase } from "@/lib/ask/ask-flow";

export type VoiceCommand = "capture-photo" | "retake-photo" | "start-speaking" | "repeat-answer" | "ask" | "done";

const PHRASES: Record<VoiceCommand, readonly string[]> = {
  "capture-photo": ["capture photo", "capture", "take photo", "take a photo", "take picture", "take a picture"],
  "retake-photo": ["retake photo", "retake", "retake the photo", "take photo again", "take another photo"],
  "start-speaking": ["start speaking", "start listening", "ask a question", "speak question", "dictate"],
  "repeat-answer": ["repeat answer", "repeat", "repeat the answer", "read answer", "read the answer", "listen to answer", "read it again"],
  ask: ["ask", "ask now", "send", "send it", "send question", "submit"],
  // Ends the conversation about this photo (like the Done button): nothing is sent anywhere.
  done: ["done", "all done", "i am done", "i m done", "im done", "finish", "finished", "that is all", "that s all", "end conversation", "end"],
};

function normalise(transcript: string): string {
  return transcript
    .toLowerCase()
    .replace(/[^a-z\s]/g, " ")
    .replace(/\b(please|hey|ok|okay|visionaid|vision aid)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function parseCommand(transcript: string): VoiceCommand | null {
  const said = normalise(transcript);
  if (said === "") return null;
  for (const [command, phrases] of Object.entries(PHRASES) as Array<[VoiceCommand, readonly string[]]>) {
    if (phrases.includes(said)) return command;
  }
  return null;
}

/** Every command, in the order they are listed to the person. */
export const ALL_COMMANDS: readonly VoiceCommand[] = ["capture-photo", "retake-photo", "start-speaking", "repeat-answer", "ask", "done"];

/**
 * Where the person is in the workflow, for the purpose of voice commands.
 *  camera-off    no photo, camera is off
 *  camera-ready  no photo, camera is on
 *  photo         a photo, no question yet
 *  ready-to-ask  a photo and a question
 *  sending       the request is being sent
 *  answered      an answer is showing
 *  failed        the request failed
 *  busy          capturing or dictating (VisionAid is in the middle of something)
 */
export type CommandStep =
  | "camera-off"
  | "camera-ready"
  | "photo"
  | "ready-to-ask"
  | "sending"
  | "answered"
  | "failed"
  | "busy";

export const COMMAND_STEPS: readonly CommandStep[] = ["camera-off", "camera-ready", "photo", "ready-to-ask", "sending", "answered", "failed", "busy"];

export interface CommandContext {
  step: CommandStep;
}

/** The ONE table of what works where. */
const AVAILABLE: Record<CommandStep, readonly VoiceCommand[]> = {
  "camera-off": [],
  "camera-ready": ["capture-photo"],
  photo: ["retake-photo", "start-speaking", "done"],
  "ready-to-ask": ["retake-photo", "start-speaking", "ask", "done"],
  // Done cancels the request in flight (the same as the Cancel button): nothing is shown for it.
  sending: ["done"],
  answered: ["repeat-answer", "done"],
  failed: ["done"],
  busy: [],
};

export function deriveCommandStep(phase: StoredPhase, hasImage: boolean, cameraActive: boolean): CommandStep {
  if (phase === "capturing" || phase === "listening") return "busy";
  if (!hasImage) return cameraActive ? "camera-ready" : "camera-off";
  switch (phase) {
    case "question-ready":
      return "ready-to-ask";
    case "sending":
      return "sending";
    case "answered":
      return "answered";
    case "send-failed":
      return "failed";
    default:
      return "photo";
  }
}

export function isCommandAvailable(command: VoiceCommand, ctx: CommandContext): boolean {
  return AVAILABLE[ctx.step].includes(command);
}

export function commandLabel(command: VoiceCommand): string {
  return command === "capture-photo" ? "capture photo"
    : command === "retake-photo" ? "retake photo"
    : command === "start-speaking" ? "start speaking"
    : command === "repeat-answer" ? "repeat answer"
    : command;
}

export function availableCommands(ctx: CommandContext): VoiceCommand[] {
  return ALL_COMMANDS.filter((c) => isCommandAvailable(c, ctx));
}

/** What to say when no command was understood: only the commands that work right now. */
export function commandHelp(ctx: CommandContext): string {
  const list = availableCommands(ctx).map(commandLabel);
  if (list.length === 0) return "No voice command is available at this step.";
  return `Command not recognised. You can say: ${list.join(", ")}.`;
}

const BUSY = "VisionAid is busy right now. Wait a moment, then tap Say a command again.";

/** Why a recognised command cannot run at this step, in words that fit the step. */
export function commandUnavailable(command: VoiceCommand, ctx: CommandContext): string {
  const step = ctx.step;
  if (step === "busy") return BUSY;
  const noPhoto = step === "camera-off" || step === "camera-ready";
  switch (command) {
    case "capture-photo":
      return step === "camera-off"
        ? "Capture photo needs the camera. Start the camera first."
        : step === "sending" || step === "answered" || step === "failed"
          ? "A photo has already been taken. Say done to start again."
          : "A photo has already been taken. Say retake photo to take another.";
    case "retake-photo":
      if (noPhoto) return "Retake photo needs a photo first.";
      if (step === "sending") return "Your question is being sent. Say done to cancel it.";
      return "Retake photo is only available before you ask. Say done to start again.";
    case "start-speaking":
      if (noPhoto) return "Start speaking needs a photo first.";
      if (step === "sending") return "Your question is being sent. Say done to cancel it.";
      if (step === "answered") return "You already have an answer. Say done to start again, or use Ask another question.";
      return "Your last request failed. Use Try again, or say done to start again.";
    case "repeat-answer":
      return "There is no answer to repeat yet.";
    case "ask":
      if (noPhoto) return "Ask needs a photo and a question first.";
      if (step === "photo") return "Ask needs a question first. Say start speaking, or type it.";
      if (step === "sending") return "Your question is already being sent.";
      if (step === "answered") return "Your question was already sent. Say done to start again, or use Ask another question.";
      return "Your last request failed. Use Try again, or say done to start again.";
    case "done":
      return "Done is available once you have taken a photo.";
  }
}

/** Heard "ask" while "Ask by voice" is OFF (the default): it does not send; the person must use the Ask button. */
export const ASK_NEEDS_CONFIRMATION =
  "Ask sends your photo and question to Google Gemini. Focus is on the Ask button: activate it to send.";

/** Heard "ask" while "Ask by voice" is ON: said as the photo and question are sent. */
export const ASK_BY_VOICE_SENDING = "Sending your photo and question to Google Gemini.";
