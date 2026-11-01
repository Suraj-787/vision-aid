export type RateLimitResult =
  | { allowed: true }
  | { allowed: false; retryAfterSeconds: number };

/**
 * In-memory sliding-window limiter. No database or Redis by design (see
 * AGENTS.md), so state is per server process: it resets on restart and is not
 * shared between serverless instances. It is basic abuse protection and a
 * quota guard, not a hard security boundary.
 *
 * Deliberately free of server-only imports so it can be unit-tested in Node.
 */
export class SlidingWindowLimiter {
  private readonly hits = new Map<string, number[]>();
  private readonly limit: number;
  private readonly windowMs: number;
  private readonly maxKeys: number;

  constructor(limit: number, windowMs: number, maxKeys = 2000) {
    this.limit = limit;
    this.windowMs = windowMs;
    this.maxKeys = maxKeys;
  }

  /** Records a hit when allowed. `now` is injectable for tests. */
  take(key: string, now = Date.now()): RateLimitResult {
    const cutoff = now - this.windowMs;
    const recent = (this.hits.get(key) ?? []).filter((t) => t > cutoff);

    if (recent.length >= this.limit) {
      this.hits.set(key, recent);
      return {
        allowed: false,
        retryAfterSeconds: Math.max(
          1,
          Math.ceil((recent[0] + this.windowMs - now) / 1000),
        ),
      };
    }

    recent.push(now);
    this.hits.delete(key); // re-insert so Map order tracks recency
    this.hits.set(key, recent);
    this.evictIfNeeded(cutoff);
    return { allowed: true };
  }

  /** Bounds memory: drop expired keys first, then least recently used. */
  private evictIfNeeded(cutoff: number) {
    if (this.hits.size <= this.maxKeys) return;
    for (const [k, times] of this.hits) {
      if (times[times.length - 1] <= cutoff) this.hits.delete(k);
      if (this.hits.size <= this.maxKeys) return;
    }
    const oldest = this.hits.keys().next().value;
    if (oldest !== undefined) this.hits.delete(oldest);
  }
}
