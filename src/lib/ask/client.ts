import {
  ASK_CLIENT_ERRORS,
  ASK_ENDPOINT,
  ASK_SERVER_ERRORS,
  isServerErrorCode,
  type AskClientErrorCode,
  type AskErrorCode,
} from "@/lib/ask/ask-api";
import { parseAskResult, type AskResult } from "@/lib/ask/ask-result";
import { blobToBase64 } from "@/lib/image/base64";

/** A failed ask, safe to show: the message never contains request content. */
export interface AskFailure {
  code: AskErrorCode;
  message: string;
  retryable: boolean;
  /** From the Retry-After header, when the server provided one. */
  retryAfterSeconds?: number;
}

export type AskOutcome =
  | { ok: true; result: AskResult }
  | { ok: false; error: AskFailure };

/** A little longer than the server's own Gemini timeout (30 s) so its error arrives first. */
export const DEFAULT_CLIENT_TIMEOUT_MS = 45_000;

interface PostAskOptions {
  image: Blob;
  question: string;
  /** Aborting (Cancel, Retake, leaving the page) resolves to code "ABORTED". */
  signal?: AbortSignal;
  timeoutMs?: number;
  /** Tests only. */
  fetchImpl?: typeof fetch;
}

function clientFailure(code: AskClientErrorCode): AskOutcome {
  const info = ASK_CLIENT_ERRORS[code];
  return { ok: false, error: { code, message: info.message, retryable: info.retryable } };
}

function isAbortError(err: unknown): boolean {
  return err instanceof Error && (err.name === "AbortError" || err.name === "TimeoutError");
}

/**
 * Sends the captured JPEG and the question to POST /api/ask: one request, no
 * automatic retry. The server's reply is validated again here, so malformed
 * content can never reach the answer view. Never logs request content.
 */
export async function postAsk(options: PostAskOptions): Promise<AskOutcome> {
  const { image, question, signal, timeoutMs = DEFAULT_CLIENT_TIMEOUT_MS } = options;
  const fetchImpl = options.fetchImpl ?? fetch;

  if (signal?.aborted) return clientFailure("ABORTED");

  const controller = new AbortController();
  let timedOut = false;
  const onAbort = () => controller.abort();
  signal?.addEventListener("abort", onAbort, { once: true });
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  try {
    const base64 = await blobToBase64(image);
    const response = await fetchImpl(ASK_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image: base64, question }),
      signal: controller.signal,
      cache: "no-store",
      credentials: "same-origin",
    });

    // Read as text (not .json()) so an abort while reading is not mistaken for bad JSON.
    const text = await response.text();
    let body: unknown = null;
    try {
      body = JSON.parse(text);
    } catch {
      body = null;
    }

    if (response.ok) {
      const result = parseAskResult(body);
      return result ? { ok: true, result } : clientFailure("BAD_SERVER_RESPONSE");
    }
    return serverFailure(response, body);
  } catch (err) {
    if (timedOut) return clientFailure("CLIENT_TIMEOUT");
    if (signal?.aborted || isAbortError(err)) return clientFailure("ABORTED");
    return clientFailure("NETWORK_ERROR");
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
}

function serverFailure(response: Response, body: unknown): AskOutcome {
  const retryAfter = Number(response.headers.get("retry-after"));
  const retryAfterSeconds = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : undefined;

  const error =
    typeof body === "object" && body !== null ? (body as { error?: unknown }).error : undefined;
  const code = typeof error === "object" && error !== null ? (error as { code?: unknown }).code : undefined;

  if (typeof code === "string" && isServerErrorCode(code)) {
    const info = ASK_SERVER_ERRORS[code];
    const sent = (error as { message?: unknown }).message;
    // Prefer the server's wording, but only if it is a short plain string.
    const message = typeof sent === "string" && sent.length > 0 && sent.length <= 300 ? sent : info.message;
    return { ok: false, error: { code, message, retryable: info.retryable, retryAfterSeconds } };
  }
  // Not one of our errors (e.g. an HTML error page from a proxy).
  return clientFailure("BAD_SERVER_RESPONSE");
}
