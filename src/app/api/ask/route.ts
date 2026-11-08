import { readAskConfig } from "@/lib/server/ask/config";
import { createGeminiClient } from "@/lib/server/ask/gemini";
import { handleAsk, type AskDeps } from "@/lib/server/ask/handler";
import { SlidingWindowLimiter } from "@/lib/server/rate-limit";

/**
 * POST /api/ask — Tap-to-Ask (Milestone 5). Receives one JPEG and one question,
 * makes ONE standard Gemini `models.generateContent` request from the server,
 * validates the structured answer and returns it. See docs/architecture.md.
 *
 * The API key never leaves this process. Images, questions and answers are not
 * stored, cached or logged. Independent of Live Mode (ENABLE_LIVE_MODE).
 */

/**
 * Maximum run time for this function on hosts that read it from the Next.js build output (Vercel does).
 * The Gemini call has its own 30 s timeout (DEFAULT_GEMINI_TIMEOUT_MS), so 60 s leaves room for validation and
 * post-processing while still stopping a stuck request, which also bounds what one request can cost. Keep it above
 * the Gemini timeout (a unit test enforces this) and within the host plan's limit.
 */
export const maxDuration = 60;

// In-memory limits (per server process, like /api/live-token): 20 questions per
// 10 minutes per client and 120 per hour overall, to protect the shared quota.
const deps: AskDeps = {
  readConfig: () => readAskConfig(),
  gemini: createGeminiClient(),
  perClient: new SlidingWindowLimiter(20, 10 * 60 * 1000),
  overall: new SlidingWindowLimiter(120, 60 * 60 * 1000),
  inFlight: new Set<string>(),
  now: () => Date.now(),
  log: (line) => console.info(line),
};

export async function POST(request: Request) {
  return handleAsk(request, deps);
}
