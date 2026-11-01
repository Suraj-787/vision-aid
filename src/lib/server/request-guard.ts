/**
 * Request validation for POST /api/live-token. Pure functions over standard
 * Headers/strings so they can be unit-tested in Node.
 */

export type GuardFailure = {
  status: number;
  code: "FORBIDDEN_ORIGIN" | "UNSUPPORTED_MEDIA_TYPE" | "PAYLOAD_TOO_LARGE" | "INVALID_REQUEST";
  message: string;
};

export const MAX_BODY_BYTES = 1024;

const first = (value: string | null) => value?.split(",")[0]?.trim().toLowerCase() ?? "";

/**
 * Browsers always send Origin on cross-site and same-origin POSTs and page
 * script cannot forge it, so this stops other websites from minting tokens
 * through a visitor's browser. The origin must match the host the request was
 * addressed to (X-Forwarded-Host is honoured so tunnels/proxies such as ngrok
 * work) or appear in ALLOWED_ORIGINS. Non-browser clients can still call the
 * endpoint by setting Origin themselves; the rate limiter covers that case.
 */
export function checkOrigin(
  headers: Headers,
  allowedOrigins: readonly string[] = [],
): GuardFailure | null {
  const deny: GuardFailure = {
    status: 403,
    code: "FORBIDDEN_ORIGIN",
    message: "This request origin is not allowed.",
  };

  const origin = first(headers.get("origin"));
  if (!origin) return deny;
  if (allowedOrigins.includes(origin)) return null;

  let originHost: string;
  try {
    originHost = new URL(origin).host.toLowerCase();
  } catch {
    return deny;
  }
  const hosts = [first(headers.get("x-forwarded-host")), first(headers.get("host"))];
  return hosts.includes(originHost) ? null : deny;
}

/**
 * The endpoint takes no parameters: model, expiry and constraints are fixed
 * server-side. An empty body or `{}` is accepted; anything else is rejected so
 * callers cannot believe they are configuring the token. Requiring
 * application/json also forces a CORS preflight for cross-site callers.
 */
export function checkBody(
  contentType: string | null,
  rawBody: string,
): GuardFailure | null {
  if (!/^application\/json(\s*;|$)/i.test(contentType ?? "")) {
    return {
      status: 415,
      code: "UNSUPPORTED_MEDIA_TYPE",
      message: "Content-Type must be application/json.",
    };
  }
  if (new TextEncoder().encode(rawBody).length > MAX_BODY_BYTES) {
    return { status: 413, code: "PAYLOAD_TOO_LARGE", message: "Request body is too large." };
  }
  if (rawBody.trim() === "") return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return { status: 400, code: "INVALID_REQUEST", message: "Request body must be valid JSON." };
  }
  const isEmptyObject =
    typeof parsed === "object" &&
    parsed !== null &&
    !Array.isArray(parsed) &&
    Object.keys(parsed).length === 0;
  return isEmptyObject
    ? null
    : {
        status: 400,
        code: "INVALID_REQUEST",
        message: "This endpoint takes no parameters; send an empty JSON object.",
      };
}

/** Best-effort client key for rate limiting (spoofable without a trusted proxy). */
export function clientKey(headers: Headers): string {
  return first(headers.get("x-forwarded-for")) || first(headers.get("x-real-ip")) || "local";
}
