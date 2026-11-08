/**
 * Playback lifecycle for spoken answers (Milestone 7), independent of the
 * browser so it can be tested with a fake engine. A real `speechSynthesis` and
 * `SpeechSynthesisUtterance` satisfy the structural types below.
 *
 * Guarantees:
 *  - Only one playback at a time: play() while active does nothing.
 *  - A generation counter makes events from a stopped or finished playback
 *    harmless, so stale speech can never change state or start more speech.
 *    (Engines report their own cancel() as an error event on the utterance that
 *    was playing; those are ignored.)
 *  - stop() always cancels the engine's whole queue.
 *  - After dispose(), nothing is reported.
 *
 * Lost end events (Milestone 9 hardening): some engines never report the end of an
 * utterance (a known browser bug, for example when the utterance object is garbage
 * collected). The player therefore keeps a reference to every utterance it queued until
 * the playback is over, and, when the engine exposes `speaking` and `pending`, notices
 * that the engine went quiet while the player still believes it is speaking and finishes
 * the playback itself. Without this the controls would stay "speaking" forever.
 *
 * Pause and resume depend on the device. If pause() does not actually pause the
 * engine (reported through `paused`), the player says so and keeps playing, so
 * the interface can fall back to Stop.
 */
import {
  mapSynthesisErrorCode,
  type SpeechOutputErrorKind,
} from "@/lib/speech/speech-output-errors";
import type { VoiceLike } from "@/lib/speech/voices";

export interface UtteranceLike {
  text: string;
  lang: string;
  voice: VoiceLike | null;
  rate: number;
  pitch: number;
  volume: number;
  onstart: (() => void) | null;
  onend: (() => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
}

export interface SynthLike {
  speak(utterance: UtteranceLike): void;
  cancel(): void;
  pause(): void;
  resume(): void;
  readonly paused: boolean;
  /** Optional: true while audio is playing. Enables the lost-end-event watchdog. */
  readonly speaking?: boolean;
  /** Optional: true while utterances are queued and not yet started. */
  readonly pending?: boolean;
}

export type PlayerState = "idle" | "speaking" | "paused";

export type PlayerEvent =
  | { type: "state"; state: PlayerState }
  | { type: "finished" }
  | { type: "error"; kind: SpeechOutputErrorKind }
  | { type: "pause-unsupported" };

export interface PlayerChunk {
  text: string;
  lang: string;
  voice: VoiceLike;
}

export interface PlayerDeps {
  synth: SynthLike;
  createUtterance: (text: string) => UtteranceLike;
  onEvent: (event: PlayerEvent) => void;
  /** Test seam for the pause check; defaults to setTimeout. */
  schedule?: (fn: () => void, ms: number) => unknown;
}

/** How long to wait before checking that pause() really paused the engine. */
export const PAUSE_CHECK_MS = 250;

/** How often the watchdog asks a silent engine whether it is really still speaking. */
export const WATCHDOG_MS = 1000;
/** Consecutive quiet checks before the player concludes the end event was lost. */
export const WATCHDOG_QUIET_CHECKS = 2;

export class SpeechPlayer {
  private readonly deps: PlayerDeps;
  private current: PlayerState = "idle";
  private generation = 0;
  private remaining = 0;
  private disposed = false;
  // Strong references: an utterance the page drops can be garbage collected before its end event fires.
  private held: UtteranceLike[] = [];

  constructor(deps: PlayerDeps) {
    this.deps = deps;
  }

  get state(): PlayerState {
    return this.current;
  }

  /** Starts speaking the chunks in order. Returns false when busy, disposed or given nothing to say. */
  play(chunks: readonly PlayerChunk[]): boolean {
    if (this.disposed || this.current !== "idle" || chunks.length === 0) return false;
    const id = ++this.generation;
    this.remaining = chunks.length;
    this.held = [];
    this.setState("speaking");
    for (const chunk of chunks) {
      const utterance = this.deps.createUtterance(chunk.text);
      utterance.lang = chunk.lang;
      utterance.voice = chunk.voice;
      // Some engines deliver the end event twice. Counting it twice would finish a multi-part playback early.
      let ended = false;
      utterance.onend = () => {
        if (ended) return;
        ended = true;
        this.handleEnd(id);
      };
      utterance.onerror = (event) => this.handleError(id, event.error);
      this.held.push(utterance);
      try {
        this.deps.synth.speak(utterance);
      } catch {
        // An engine that throws must not leave the player stuck in "speaking".
        this.handleError(id, "synthesis-failed");
        return false;
      }
    }
    this.watch(id, 0);
    return true;
  }

  pause(): void {
    if (this.disposed || this.current !== "speaking") return;
    const id = this.generation;
    this.deps.synth.pause();
    this.setState("paused");
    (this.deps.schedule ?? setTimeout)(() => {
      if (this.disposed || id !== this.generation || this.current !== "paused") return;
      if (!this.deps.synth.paused) {
        // The engine ignored pause(): it is still speaking.
        this.setState("speaking");
        this.deps.onEvent({ type: "pause-unsupported" });
      }
    }, PAUSE_CHECK_MS);
  }

  resume(): void {
    if (this.disposed || this.current !== "paused") return;
    this.deps.synth.resume();
    this.setState("speaking");
  }

  /** Stops speaking and clears everything queued. Safe at any time. */
  stop(): void {
    if (this.disposed) return;
    const wasActive = this.current !== "idle";
    this.generation += 1;
    this.remaining = 0;
    this.held = [];
    if (wasActive) {
      this.deps.synth.cancel();
      this.setState("idle");
    }
  }

  /** Stops speaking and silences all further reports (use on unmount). */
  dispose(): void {
    if (this.disposed) return;
    const wasActive = this.current !== "idle";
    this.generation += 1;
    this.disposed = true;
    this.held = [];
    if (wasActive) this.deps.synth.cancel();
  }

  private setState(state: PlayerState): void {
    if (this.current === state) return;
    this.current = state;
    this.deps.onEvent({ type: "state", state });
  }

  private handleEnd(id: number): void {
    if (this.disposed || id !== this.generation) return;
    this.remaining -= 1;
    if (this.remaining <= 0) this.finish();
  }

  private finish(): void {
    this.generation += 1;
    this.remaining = 0;
    this.held = [];
    this.setState("idle");
    this.deps.onEvent({ type: "finished" });
  }

  /**
   * Watchdog for lost end events. Only runs for engines that report `speaking`/`pending`.
   * It never ends a playback that is paused or that the engine still reports as active.
   */
  private watch(id: number, quietChecks: number): void {
    const synth = this.deps.synth;
    if (typeof synth.speaking !== "boolean") return;
    (this.deps.schedule ?? setTimeout)(() => {
      if (this.disposed || id !== this.generation || this.current === "idle") return;
      if (this.current === "paused") return this.watch(id, 0); // paused is quiet on purpose
      const quiet = synth.speaking === false && synth.pending !== true;
      if (!quiet) return this.watch(id, 0);
      if (quietChecks + 1 >= WATCHDOG_QUIET_CHECKS) return this.finish();
      this.watch(id, quietChecks + 1);
    }, WATCHDOG_MS);
  }

  private handleError(id: number, code: string | undefined): void {
    if (this.disposed || id !== this.generation) return;
    const kind = mapSynthesisErrorCode(code);
    this.generation += 1;
    this.remaining = 0;
    this.deps.synth.cancel(); // drop whatever is still queued
    this.setState("idle");
    if (kind !== "quiet") this.deps.onEvent({ type: "error", kind });
  }
}
