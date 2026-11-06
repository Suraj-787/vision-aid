import { ApiError } from "@google/genai";
import type { AskServerErrorCode } from "@/lib/ask/ask-api";

/**
 * Maps a failure from the Gemini SDK to one of VisionAid's safe error codes.
 * The raw error (message, stack, response body) is used only for this
 * classification and is never returned to the client or logged.
 */
export function classifyUpstreamError(err: unknown): AskServerErrorCode {
  if (isTimeoutOrAbort(err)) return "UPSTREAM_TIMEOUT";

  if (err instanceof ApiError || hasNumericStatus(err)) {
    const status = (err as { status: number }).status;
    if (status === 401 || status === 403) return "UPSTREAM_AUTH";
    // Google answers an invalid key with 400 INVALID_ARGUMENT / API_KEY_INVALID.
    if (status === 400 && looksLikeAuthMessage(err)) return "UPSTREAM_AUTH";
    if (status === 408 || status === 504) return "UPSTREAM_TIMEOUT";
    if (status === 429) return "UPSTREAM_QUOTA";
    if (status === 500 || status === 502 || status === 503) return "UPSTREAM_UNAVAILABLE";
    return "UPSTREAM_ERROR"; // other 4xx, e.g. a rejected image or an unknown model
  }

  // Network-level failures surface as a TypeError ("fetch failed") with a cause.
  if (err instanceof TypeError) return "UPSTREAM_UNAVAILABLE";
  return "UPSTREAM_ERROR";
}

function hasNumericStatus(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    typeof (err as { status?: unknown }).status === "number"
  );
}

function looksLikeAuthMessage(err: unknown): boolean {
  const message = err instanceof Error ? err.message : "";
  return /api[ _-]?key|API_KEY_INVALID|permission|unauthenticated/i.test(message);
}

function isTimeoutOrAbort(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  if (err.name === "AbortError" || err.name === "TimeoutError") return true;
  const cause = (err as { cause?: unknown }).cause;
  return cause instanceof Error && (cause.name === "AbortError" || cause.name === "TimeoutError");
}

/**
 * Google's short status name from its JSON error body (e.g. UNAVAILABLE,
 * DEADLINE_EXCEEDED, RESOURCE_EXHAUSTED). Only an UPPER_SNAKE_CASE enum is
 * accepted; the free-text message is never used, so nothing else can leak.
 */
function googleStatusName(err: unknown): string | null {
  const message = err instanceof Error ? err.message : "";
  try {
    const status = (JSON.parse(message) as { error?: { status?: unknown } })?.error?.status;
    return typeof status === "string" && /^[A-Z][A-Z_]{2,39}$/.test(status) ? status : null;
  } catch {
    return null;
  }
}

/**
 * Non-sensitive description for the server log: error class, HTTP status and
 * Google's status name (when present). Never the message text.
 */
export function describeUpstreamError(err: unknown): string {
  const name = err instanceof Error ? err.name : typeof err;
  const status = hasNumericStatus(err) ? (err as { status: number }).status : "n/a";
  const googleStatus = googleStatusName(err);
  return `${name} status=${status}${googleStatus ? ` (${googleStatus})` : ""}`;
}
