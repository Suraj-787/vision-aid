import "server-only";
import { looksLikeApiKey } from "@/lib/server/env";
import type { AskServerErrorCode } from "@/lib/ask/ask-api";

export type AskConfig =
  | { ok: true; apiKey: string; model: string; allowedOrigins: string[] }
  | { ok: false; code: AskServerErrorCode; problem: string; allowedOrigins: string[] };

// A bare model ID as shown in AI Studio, e.g. "gemini-x-flash". No slashes or spaces.
const MODEL_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;

/**
 * Reads the server-only configuration for /api/ask. Deliberately has NO default
 * model: if GEMINI_MODEL is unset the endpoint reports a configuration error
 * instead of silently choosing one (availability and quota differ per project).
 * `problem` names variables, never values, and is for the server log only.
 * GEMINI_LIVE_MODEL and ENABLE_LIVE_MODE belong to Live Mode and are not read here.
 */
export function readAskConfig(
  env: Record<string, string | undefined> = process.env,
): AskConfig {
  const allowedOrigins = (env.ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((o) => o.trim().toLowerCase())
    .filter(Boolean);

  const apiKey = env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    return { ok: false, code: "API_KEY_NOT_CONFIGURED", problem: "GEMINI_API_KEY is not set.", allowedOrigins };
  }
  if (!looksLikeApiKey(apiKey)) {
    return {
      ok: false,
      code: "SERVER_NOT_CONFIGURED",
      problem: "GEMINI_API_KEY is set but does not look like an API key (quotes, spaces or a pasted 'KEY=').",
      allowedOrigins,
    };
  }

  const model = env.GEMINI_MODEL?.trim();
  if (!model) {
    return { ok: false, code: "MODEL_NOT_CONFIGURED", problem: "GEMINI_MODEL is not set.", allowedOrigins };
  }
  if (!MODEL_ID_PATTERN.test(model)) {
    return {
      ok: false,
      code: "SERVER_NOT_CONFIGURED",
      problem: "GEMINI_MODEL is not a valid model ID (use the bare ID from AI Studio).",
      allowedOrigins,
    };
  }

  return { ok: true, apiKey, model, allowedOrigins };
}
