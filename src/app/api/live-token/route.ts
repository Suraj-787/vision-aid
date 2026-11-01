import { ApiError } from "@google/genai";
import { CONFIG_PROBLEM_LOG, readLiveServerConfig } from "@/lib/server/env";
import { issueLiveToken } from "@/lib/server/live-token";
import { SlidingWindowLimiter } from "@/lib/server/rate-limit";
import { checkBody, checkOrigin, clientKey } from "@/lib/server/request-guard";

/**
 * POST /api/live-token — issues a short-lived, single-use, model-locked
 * ephemeral token for the browser's Gemini Live connection. The permanent API
 * key stays in this process; nothing here stores or logs a token.
 *
 * Deliberately independent of camera/microphone code (Milestone 3).
 */

// Basic, in-memory abuse protection (per server process; see docs/live-token.md).
const perClient = new SlidingWindowLimiter(10, 10 * 60 * 1000);
const overallLimiter = new SlidingWindowLimiter(60, 60 * 60 * 1000);

const SAFE_HEADERS = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
};

function fail(
  status: number,
  code: string,
  message: string,
  extraHeaders: Record<string, string> = {},
) {
  return Response.json(
    { error: { code, message } },
    { status, headers: { ...SAFE_HEADERS, ...extraHeaders } },
  );
}

/** Dev-only upstream diagnostics, with the key scrubbed from any message. */
function logUpstreamError(err: unknown, apiKey: string) {
  const status = err instanceof ApiError ? err.status : undefined;
  const name = err instanceof Error ? err.name : typeof err;
  if (process.env.NODE_ENV === "production") {
    console.error(`[live-token] upstream error: ${name} status=${status ?? "n/a"}`);
    return;
  }
  const message = err instanceof Error ? err.message.split(apiKey).join("[redacted]") : "";
  console.error(
    `[live-token] upstream error: ${name} status=${status ?? "n/a"} ${message.slice(0, 300)}`,
  );
}

export async function POST(request: Request) {
  const config = readLiveServerConfig();
  if (!config.ok) {
    console.error(`[live-token] server misconfigured: ${CONFIG_PROBLEM_LOG[config.problem]}`);
    return fail(
      500,
      "SERVER_NOT_CONFIGURED",
      "The Live service is not configured on the server. Please try again later.",
    );
  }

  const originFailure = checkOrigin(request.headers, config.allowedOrigins);
  if (originFailure) {
    return fail(originFailure.status, originFailure.code, originFailure.message);
  }

  let rawBody: string;
  try {
    rawBody = await request.text();
  } catch {
    return fail(400, "INVALID_REQUEST", "Request body could not be read.");
  }
  const bodyFailure = checkBody(request.headers.get("content-type"), rawBody);
  if (bodyFailure) return fail(bodyFailure.status, bodyFailure.code, bodyFailure.message);

  const now = Date.now();
  const client = perClient.take(clientKey(request.headers), now);
  const overall = client.allowed ? overallLimiter.take("all", now) : client;
  if (!overall.allowed) {
    return fail(
      429,
      "RATE_LIMITED",
      "Too many session requests. Please wait a moment and try again.",
      { "Retry-After": String(overall.retryAfterSeconds) },
    );
  }

  try {
    const issued = await issueLiveToken(config.apiKey, config.model, now);
    console.info("[live-token] token issued"); // never log the token itself
    return Response.json(issued, { status: 200, headers: SAFE_HEADERS });
  } catch (err) {
    logUpstreamError(err, config.apiKey);
    const upstream = err instanceof ApiError ? err.status : 0;
    if (upstream === 400 || upstream === 401 || upstream === 403) {
      return fail(
        502,
        "UPSTREAM_AUTH",
        "The server could not authenticate with the Gemini API. The server's API key may be invalid or restricted.",
      );
    }
    if (upstream === 429) {
      return fail(
        503,
        "UPSTREAM_RATE_LIMITED",
        "The Gemini API quota is currently exhausted. Please try again later.",
        { "Retry-After": "60" },
      );
    }
    return fail(
      502,
      "UPSTREAM_ERROR",
      "The Live service could not create a session token. Please try again.",
    );
  }
}
