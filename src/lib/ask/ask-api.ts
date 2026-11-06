/**
 * Shared contract for POST /api/ask (Milestone 5). Pure data, no imports, so the
 * server, the browser client and the unit tests all use the same definitions.
 *
 * Request  (JSON): { "image": "<base64 JPEG>", "question": "<text>" }
 * Success  (200):  { answer, details, uncertainty, printed_text, printed_instructions }
 * Failure  (4xx/5xx): { "error": { "code", "message", "retryable" } }
 */

export const ASK_ENDPOINT = "/api/ask";

/** Largest decoded JPEG the server accepts. The browser sends ~768 px images (tens of KB). */
export const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
/** Largest width or height (pixels) the server accepts in a JPEG header. */
export const MAX_IMAGE_DIMENSION = 4096;
/** Server-side cap on the JSON body: base64 of the largest image plus a little slack. */
export const MAX_REQUEST_BODY_BYTES = Math.ceil((MAX_IMAGE_BYTES * 4) / 3) + 8 * 1024;
export const MAX_QUESTION_LENGTH = 500;

export type AskServerErrorCode =
  // configuration (server owner must fix)
  | "API_KEY_NOT_CONFIGURED"
  | "MODEL_NOT_CONFIGURED"
  | "SERVER_NOT_CONFIGURED"
  // request problems
  | "FORBIDDEN_ORIGIN"
  | "UNSUPPORTED_MEDIA_TYPE"
  | "PAYLOAD_TOO_LARGE"
  | "INVALID_JSON"
  | "INVALID_REQUEST"
  | "MISSING_IMAGE"
  | "MISSING_QUESTION"
  | "QUESTION_TOO_LONG"
  | "INVALID_IMAGE"
  | "UNSUPPORTED_IMAGE_FORMAT"
  | "IMAGE_TOO_LARGE"
  // VisionAid limits
  | "RATE_LIMITED"
  | "REQUEST_IN_PROGRESS"
  // Gemini
  | "UPSTREAM_AUTH"
  | "UPSTREAM_QUOTA"
  | "UPSTREAM_TIMEOUT"
  | "UPSTREAM_UNAVAILABLE"
  | "UPSTREAM_ERROR"
  | "RESPONSE_BLOCKED"
  | "INVALID_MODEL_RESPONSE"
  | "INTERNAL_ERROR";

/** Failures that only the browser can produce (no server response). */
export type AskClientErrorCode =
  | "NETWORK_ERROR"
  | "CLIENT_TIMEOUT"
  | "BAD_SERVER_RESPONSE"
  | "ABORTED";

export type AskErrorCode = AskServerErrorCode | AskClientErrorCode;

interface ErrorInfo {
  status: number;
  /** Short, user-friendly, safe to show. Never contains request content or secrets. */
  message: string;
  /** Whether trying the same request again could plausibly work. */
  retryable: boolean;
}

export const ASK_SERVER_ERRORS: Record<AskServerErrorCode, ErrorInfo> = {
  API_KEY_NOT_CONFIGURED: {
    status: 500,
    message: "The server has no Gemini API key set up, so questions cannot be answered yet. The site owner needs to configure it.",
    retryable: false,
  },
  MODEL_NOT_CONFIGURED: {
    status: 500,
    message: "The server has no Gemini model set up (GEMINI_MODEL), so questions cannot be answered yet. The site owner needs to configure it.",
    retryable: false,
  },
  SERVER_NOT_CONFIGURED: {
    status: 500,
    message: "The server's AI settings are invalid, so questions cannot be answered yet. The site owner needs to fix them.",
    retryable: false,
  },
  FORBIDDEN_ORIGIN: { status: 403, message: "This request was not allowed.", retryable: false },
  UNSUPPORTED_MEDIA_TYPE: { status: 415, message: "The request was not sent in the expected format.", retryable: false },
  PAYLOAD_TOO_LARGE: { status: 413, message: "The photo and question are too large to send. Retake the photo and try again.", retryable: false },
  INVALID_JSON: { status: 400, message: "The request could not be read. Please try again.", retryable: false },
  INVALID_REQUEST: { status: 400, message: "The request was not valid. Please try again.", retryable: false },
  MISSING_IMAGE: { status: 400, message: "There is no photo to send. Take a photo first.", retryable: false },
  MISSING_QUESTION: { status: 400, message: "Please type or say a question first.", retryable: false },
  QUESTION_TOO_LONG: { status: 400, message: `Your question is too long. Please keep it under ${MAX_QUESTION_LENGTH} characters.`, retryable: false },
  INVALID_IMAGE: { status: 400, message: "The photo could not be read. Please retake it.", retryable: false },
  UNSUPPORTED_IMAGE_FORMAT: { status: 415, message: "Only JPEG photos are supported. Please retake the photo.", retryable: false },
  IMAGE_TOO_LARGE: { status: 413, message: "The photo is too large. Please retake it.", retryable: false },
  RATE_LIMITED: { status: 429, message: "Too many questions in a short time. Please wait a moment and try again.", retryable: true },
  REQUEST_IN_PROGRESS: { status: 429, message: "A question is already being answered. Please wait for it to finish.", retryable: false },
  UPSTREAM_AUTH: { status: 502, message: "The AI service rejected the server's credentials. The site owner needs to check the API key.", retryable: false },
  UPSTREAM_QUOTA: { status: 429, message: "The AI service has reached its usage limit. Please try again later.", retryable: true },
  UPSTREAM_TIMEOUT: { status: 504, message: "The AI service took too long to answer. Please try again.", retryable: true },
  UPSTREAM_UNAVAILABLE: { status: 503, message: "The AI service is unavailable right now. Please try again in a moment.", retryable: true },
  UPSTREAM_ERROR: { status: 502, message: "The AI service could not process this request. Try again, or retake the photo.", retryable: true },
  RESPONSE_BLOCKED: { status: 422, message: "The AI service could not provide an answer for this photo. Try a different photo or question.", retryable: false },
  INVALID_MODEL_RESPONSE: { status: 502, message: "The AI gave an answer VisionAid could not use. Please try again.", retryable: true },
  INTERNAL_ERROR: { status: 500, message: "Something went wrong on the server. Please try again.", retryable: true },
};

export const ASK_CLIENT_ERRORS: Record<AskClientErrorCode, Omit<ErrorInfo, "status">> = {
  NETWORK_ERROR: { message: "Could not reach VisionAid. Check your connection and try again.", retryable: true },
  CLIENT_TIMEOUT: { message: "No answer arrived in time. Please try again.", retryable: true },
  BAD_SERVER_RESPONSE: { message: "VisionAid sent an unexpected reply. Please try again.", retryable: true },
  ABORTED: { message: "The request was cancelled.", retryable: false },
};

export function isServerErrorCode(code: string): code is AskServerErrorCode {
  return Object.prototype.hasOwnProperty.call(ASK_SERVER_ERRORS, code);
}

/** The JSON body of every non-200 response. */
export interface AskErrorBody {
  error: { code: AskServerErrorCode; message: string; retryable: boolean };
}
