import "server-only";
import {
  ASK_SERVER_ERRORS,
  type AskErrorBody,
  type AskServerErrorCode,
} from "@/lib/ask/ask-api";
import { parseModelText } from "@/lib/ask/ask-result";
import type { AskConfig } from "@/lib/server/ask/config";
import { classifyUpstreamError, describeUpstreamError } from "@/lib/server/ask/errors";
import type { GeminiClient } from "@/lib/server/ask/gemini";
import { isJsonContentType, readBodyLimited, validateAskRequest } from "@/lib/server/ask/validate";
import type { RateLimitResult } from "@/lib/server/rate-limit";
import { checkOrigin, clientKey } from "@/lib/server/request-guard";

interface LimiterLike {
  take(key: string, now?: number): RateLimitResult;
}

export interface AskDeps {
  readConfig: () => AskConfig;
  gemini: GeminiClient;
  perClient: LimiterLike;
  overall: LimiterLike;
  /** Client keys with a request currently being answered (one at a time per client). */
  inFlight: Set<string>;
  now: () => number;
  /**
   * Operational log. Receives short event strings only: never image data,
   * questions, answers, keys or raw upstream error text.
   */
  log: (line: string) => void;
}

const SAFE_HEADERS = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
};

function failure(
  code: AskServerErrorCode,
  deps: AskDeps,
  extraHeaders: Record<string, string> = {},
): Response {
  const info = ASK_SERVER_ERRORS[code];
  deps.log(`[ask] rejected: ${code}`);
  const body: AskErrorBody = { error: { code, message: info.message, retryable: info.retryable } };
  return Response.json(body, { status: info.status, headers: { ...SAFE_HEADERS, ...extraHeaders } });
}

/**
 * POST /api/ask. Order: origin -> server configuration -> content type -> body
 * (size-limited) -> validation -> one-at-a-time + rate limits -> ONE Gemini
 * request -> validate the model's output -> reply. Every dependency is injected
 * so the whole flow is testable without the network.
 */
export async function handleAsk(request: Request, deps: AskDeps): Promise<Response> {
  try {
    return await handleAskUnsafe(request, deps);
  } catch (err) {
    // Safety net: an unexpected bug must produce a controlled error, never a raw
    // stack trace or Next's default error page. Only the error class is logged.
    try {
      deps.log(`[ask] unexpected error: ${err instanceof Error ? err.name : typeof err}`);
    } catch {
      /* logging must never turn into a second failure */
    }
    const info = ASK_SERVER_ERRORS.INTERNAL_ERROR;
    const body: AskErrorBody = {
      error: { code: "INTERNAL_ERROR", message: info.message, retryable: info.retryable },
    };
    return Response.json(body, { status: info.status, headers: SAFE_HEADERS });
  }
}

async function handleAskUnsafe(request: Request, deps: AskDeps): Promise<Response> {
  const config = deps.readConfig();

  const originFailure = checkOrigin(request.headers, config.allowedOrigins);
  if (originFailure) return failure("FORBIDDEN_ORIGIN", deps);

  if (!config.ok) {
    deps.log(`[ask] server misconfigured: ${config.problem}`);
    return failure(config.code, deps);
  }

  if (!isJsonContentType(request.headers.get("content-type"))) {
    return failure("UNSUPPORTED_MEDIA_TYPE", deps);
  }

  const body = await readBodyLimited(request);
  if (!body.ok) return failure(body.code, deps);

  const validation = validateAskRequest(body.text);
  if (!validation.ok) return failure(validation.code, deps);
  const { imageBase64, question, imageBytes } = validation.value;

  // Only one question per client at a time; checked before a rate-limit slot is spent.
  const key = clientKey(request.headers);
  if (deps.inFlight.has(key)) return failure("REQUEST_IN_PROGRESS", deps);

  const now = deps.now();
  const client = deps.perClient.take(key, now);
  const limit = client.allowed ? deps.overall.take("all", now) : client;
  if (!limit.allowed) {
    return failure("RATE_LIMITED", deps, { "Retry-After": String(limit.retryAfterSeconds) });
  }

  deps.inFlight.add(key);
  const started = deps.now();
  try {
    const output = await deps.gemini.generate({
      apiKey: config.apiKey,
      model: config.model,
      imageBase64,
      question,
    });

    if (output.blockReason) {
      deps.log(`[ask] prompt blocked by upstream (${output.blockReason})`);
      return failure("RESPONSE_BLOCKED", deps);
    }
    const parsed = parseModelText(output.text);
    if (!parsed.ok) {
      if (output.finishReason && output.finishReason !== "STOP" && parsed.reason === "empty") {
        deps.log(`[ask] no usable output (finishReason ${output.finishReason})`);
        return failure("RESPONSE_BLOCKED", deps);
      }
      deps.log(`[ask] invalid model output (${parsed.reason})`);
      return failure("INVALID_MODEL_RESPONSE", deps);
    }

    deps.log(`[ask] answered in ${deps.now() - started} ms (image ${Math.round(imageBytes / 1024)} KB)`);
    return Response.json(parsed.result, { status: 200, headers: SAFE_HEADERS });
  } catch (err) {
    const code = classifyUpstreamError(err);
    deps.log(`[ask] upstream error: ${describeUpstreamError(err)}`);
    return failure(code, deps, code === "UPSTREAM_QUOTA" ? { "Retry-After": "60" } : {});
  } finally {
    deps.inFlight.delete(key);
  }
}
