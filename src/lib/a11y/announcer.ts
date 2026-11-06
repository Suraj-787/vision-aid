/**
 * Screen-reader announcements through ONE polite live region (WCAG 2.2 SC 4.1.3).
 *
 * Rules, all enforced here so they can be unit-tested without a browser:
 *  - The same message is not announced twice in quick succession (DEDUPE_MS).
 *  - A message that differs from what the region holds is set immediately, so the
 *    screen reader sees an ordinary content change.
 *  - A message identical to the one already in the region (but outside the dedupe
 *    window) is cleared and set again, because screen readers ignore a region
 *    whose text did not change.
 *  - An empty message clears the region and forgets the last message.
 */
export const DEDUPE_MS = 1500;
export const REANNOUNCE_GAP_MS = 60;

export interface AnnouncerDeps {
  set(text: string): void;
  now(): number;
  schedule(fn: () => void, ms: number): unknown;
  cancel(handle: unknown): void;
}

export type AnnounceOutcome = "set" | "re-announced" | "skipped" | "cleared";

export class Announcer {
  private readonly deps: AnnouncerDeps;
  private current = "";
  private lastText = "";
  private lastAt = Number.NEGATIVE_INFINITY;
  private pending: unknown = null;

  constructor(deps: AnnouncerDeps) {
    this.deps = deps;
  }

  announce(text: string): AnnounceOutcome {
    const message = text.trim();
    this.cancelPending();
    if (message === "") {
      this.current = "";
      this.lastText = "";
      this.deps.set("");
      return "cleared";
    }
    const now = this.deps.now();
    if (message === this.lastText && now - this.lastAt < DEDUPE_MS) return "skipped";
    this.lastText = message;
    this.lastAt = now;
    if (message !== this.current) {
      this.current = message;
      this.deps.set(message);
      return "set";
    }
    this.current = "";
    this.deps.set("");
    this.pending = this.deps.schedule(() => {
      this.pending = null;
      this.current = message;
      this.deps.set(message);
    }, REANNOUNCE_GAP_MS);
    return "re-announced";
  }

  /** Cancels a pending re-announcement (use on unmount). */
  dispose(): void {
    this.cancelPending();
  }

  private cancelPending(): void {
    if (this.pending !== null) {
      this.deps.cancel(this.pending);
      this.pending = null;
    }
  }
}
