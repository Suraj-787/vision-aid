import "server-only";

/**
 * Models the token endpoint will mint tokens for. Verified against
 * https://ai.google.dev/gemini-api/docs/models on 2026-11-01. Adding a model
 * is a deliberate code change made after checking the Live API docs; the
 * GEMINI_LIVE_MODEL env var can only select from this list.
 */
export const ALLOWED_LIVE_MODELS = ["gemini-3.8-live"] as const;
export type AllowedLiveModel = (typeof ALLOWED_LIVE_MODELS)[number];
export const DEFAULT_LIVE_MODEL: AllowedLiveModel = "gemini-3.8-live";

export type ConfigProblem =
  | "MISSING_API_KEY"
  | "MALFORMED_API_KEY"
  | "MODEL_NOT_ALLOWED";

export type LiveServerConfig =
  | { ok: true; apiKey: string; model: AllowedLiveModel; allowedOrigins: string[] }
  | { ok: false; problem: ConfigProblem };

// Google does not document a fixed key format (and it has changed over time),
// so do not assume a prefix or charset. Reject only obvious paste mistakes:
// whitespace/control characters, quotes, a pasted "GEMINI_API_KEY=" prefix, or
// an implausible length. Printable non-space ASCII is accepted.
const API_KEY_PATTERN = /^[\x21-\x7e]{20,512}$/;

function looksLikeApiKey(value: string): boolean {
  return (
    API_KEY_PATTERN.test(value) &&
    !/["'`]/.test(value) &&
    !/^GEMINI_API_KEY=/i.test(value)
  );
}

function isAllowedModel(value: string): value is AllowedLiveModel {
  return (ALLOWED_LIVE_MODELS as readonly string[]).includes(value);
}

/**
 * Reads and validates server-only configuration on every call (cheap, and it
 * lets a corrected .env.local take effect after a dev-server reload). The
 * returned object holds the permanent key: it must never be serialised into a
 * response or log line. Only the `problem` code is safe to log or surface.
 */
export function readLiveServerConfig(
  env: NodeJS.ProcessEnv = process.env,
): LiveServerConfig {
  const apiKey = env.GEMINI_API_KEY?.trim();
  if (!apiKey) return { ok: false, problem: "MISSING_API_KEY" };
  if (!looksLikeApiKey(apiKey)) return { ok: false, problem: "MALFORMED_API_KEY" };

  const requested = env.GEMINI_LIVE_MODEL?.trim() || DEFAULT_LIVE_MODEL;
  if (!isAllowedModel(requested)) return { ok: false, problem: "MODEL_NOT_ALLOWED" };

  const allowedOrigins = (env.ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((o) => o.trim().toLowerCase())
    .filter(Boolean);

  return { ok: true, apiKey, model: requested, allowedOrigins };
}

/** Server-log wording for each problem. Names variables, never values. */
export const CONFIG_PROBLEM_LOG: Record<ConfigProblem, string> = {
  MISSING_API_KEY: "GEMINI_API_KEY is not set (add it to .env.local).",
  MALFORMED_API_KEY:
    "GEMINI_API_KEY is set but does not look like an API key (check for quotes, spaces or a pasted 'KEY=').",
  MODEL_NOT_ALLOWED: `GEMINI_LIVE_MODEL is not one of: ${ALLOWED_LIVE_MODELS.join(", ")}.`,
};
