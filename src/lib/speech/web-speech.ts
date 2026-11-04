import {
  mapSpeechErrorCode,
  type SpeechErrorKind,
} from "@/lib/speech/speech-errors";
import { collectTranscript, type ResultLike } from "@/lib/speech/transcript";
import type { SpeechSession } from "@/lib/speech/types";

/*
 * The DOM lib shipped with TypeScript has no SpeechRecognition types, so this is
 * a minimal structural declaration of the parts used (MDN: Web Speech API).
 */
interface SpeechRecognitionEventLike {
  results: ArrayLike<ResultLike>;
}
interface SpeechRecognitionErrorEventLike {
  error: string;
}
interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function getCtor(): SpeechRecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as Window & {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function isWebSpeechSupported(): boolean {
  return getCtor() !== null;
}

export class SpeechStartError extends Error {
  readonly kind: SpeechErrorKind;
  constructor(kind: SpeechErrorKind) {
    super(kind);
    this.name = "SpeechStartError";
    this.kind = kind;
  }
}

export interface WebSpeechHandlers {
  /** Latest full transcript (interim or final). Never log its content. */
  onTranscript: (text: string, isFinal: boolean) => void;
  onError: (kind: SpeechErrorKind) => void;
  /** The engine finished (normally, after an error, or after stop()). */
  onEnd: () => void;
}

/**
 * Starts one single-utterance recognition. The audio is handled by the browser's
 * own speech engine, which may send it to an external service; the page never
 * receives or stores the audio, only text. Must be called from a user gesture.
 */
export function startWebSpeech(lang: string, handlers: WebSpeechHandlers): SpeechSession {
  const Ctor = getCtor();
  if (!Ctor) throw new SpeechStartError("unsupported");

  const rec = new Ctor();
  rec.lang = lang; // set explicitly, as recommended
  rec.continuous = false;
  rec.interimResults = true;
  rec.maxAlternatives = 1;

  const detach = () => {
    rec.onresult = null;
    rec.onerror = null;
    rec.onend = null;
  };

  rec.onresult = (event) => {
    const { text, isFinal } = collectTranscript(event.results);
    handlers.onTranscript(text, isFinal);
  };
  rec.onerror = (event) => {
    const kind = mapSpeechErrorCode(event.error);
    if (kind) handlers.onError(kind);
  };
  rec.onend = () => handlers.onEnd();

  try {
    rec.start();
  } catch {
    detach();
    throw new SpeechStartError("start-failed");
  }

  return {
    stop() {
      try {
        rec.stop();
      } catch {
        /* already stopped */
      }
    },
    abort() {
      detach();
      try {
        rec.abort();
      } catch {
        /* already stopped */
      }
    },
  };
}
