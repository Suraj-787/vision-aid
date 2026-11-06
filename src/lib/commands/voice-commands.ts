/**
 * Voice commands (Milestone 9, optional, English only).
 *
 * One command is heard per explicit activation of "Say a command": the microphone is
 * never left open. A command must be the WHOLE utterance (no word spotting), so ordinary
 * speech cannot trigger an action by accident.
 *
 * Deliberately NOT voice commands:
 *  - Ask / send. Sending the photo and question to Google Gemini needs the person's
 *    deliberate action. The spoken word "ask" only moves focus to the Ask button.
 *  - Stop listening / Stop speaking. While dictation runs, the microphone is busy with the
 *    question, and while VisionAid speaks the microphone must not be on (it would hear
 *    VisionAid). Both stay buttons (and Escape stops speech).
 */
export type VoiceCommand = "capture-photo" | "retake-photo" | "start-speaking" | "repeat-answer" | "ask";

const PHRASES: Record<VoiceCommand, readonly string[]> = {
  "capture-photo": ["capture photo", "capture", "take photo", "take a photo", "take picture", "take a picture"],
  "retake-photo": ["retake photo", "retake", "retake the photo", "take photo again", "take another photo"],
  "start-speaking": ["start speaking", "start listening", "ask a question", "speak question", "dictate"],
  "repeat-answer": ["repeat answer", "repeat", "repeat the answer", "read answer", "read the answer", "listen to answer", "read it again"],
  ask: ["ask", "send", "submit", "ask now", "send it", "ask question"],
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

export interface CommandContext {
  /** The camera is on and no photo has been taken. */
  canCapture: boolean;
  /** A photo exists and has not been sent. */
  canRetake: boolean;
  /** The question can be dictated now. */
  canListen: boolean;
  /** An answer is showing. */
  hasAnswer: boolean;
  /** A photo and a question exist and the Ask button can be used. */
  canAsk: boolean;
}

export function isCommandAvailable(command: VoiceCommand, ctx: CommandContext): boolean {
  switch (command) {
    case "capture-photo":
      return ctx.canCapture;
    case "retake-photo":
      return ctx.canRetake;
    case "start-speaking":
      return ctx.canListen;
    case "repeat-answer":
      return ctx.hasAnswer;
    case "ask":
      return ctx.canAsk;
  }
}

const LABELS: Record<VoiceCommand, string> = {
  "capture-photo": "capture photo",
  "retake-photo": "retake photo",
  "start-speaking": "start speaking",
  "repeat-answer": "repeat answer",
  ask: "ask",
};

export function availableCommands(ctx: CommandContext): VoiceCommand[] {
  return (Object.keys(LABELS) as VoiceCommand[]).filter((c) => isCommandAvailable(c, ctx));
}

/** What to say when no command was understood: only the commands that work right now. */
export function commandHelp(ctx: CommandContext): string {
  const list = availableCommands(ctx).map((c) => LABELS[c]);
  if (list.length === 0) return "No voice command is available at this step.";
  return `Command not recognised. You can say: ${list.join(", ")}.`;
}

export function commandUnavailable(command: VoiceCommand): string {
  switch (command) {
    case "capture-photo":
      return "Capture photo is available when the camera is on and no photo has been taken.";
    case "retake-photo":
      return "Retake photo is available after you take a photo, until you ask.";
    case "start-speaking":
      return "Start speaking is available when you can ask a question.";
    case "repeat-answer":
      return "There is no answer to repeat yet.";
    case "ask":
      return "Ask needs a photo and a question first.";
  }
}

/** Heard "ask": it never sends anything; the person must use the Ask button. */
export const ASK_NEEDS_CONFIRMATION =
  "Ask sends your photo and question to Google Gemini. Focus is on the Ask button: activate it to send.";
