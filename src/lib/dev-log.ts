/**
 * Development-only diagnostics. Compiled out of production behaviour by the
 * NODE_ENV check. Log event names, counts and error names/messages only —
 * never frames, audio, device labels, tokens or transcripts.
 */
export function devLog(scope: string, message: string, detail?: unknown) {
  if (process.env.NODE_ENV === "production") return;
  if (detail === undefined) {
    console.debug(`[visionaid:${scope}] ${message}`);
  } else {
    console.debug(`[visionaid:${scope}] ${message}`, detail);
  }
}

/** Reduces an unknown thrown value to its non-sensitive name and message. */
export function describeError(err: unknown) {
  if (err instanceof Error) return { name: err.name, message: err.message };
  return { name: typeof err, message: String(err) };
}
