import "server-only";
import { GoogleGenAI, Modality, type LiveConnectConfig } from "@google/genai";
import type { AllowedLiveModel } from "@/lib/server/env";

/**
 * Token lifetime, per https://ai.google.dev/api/live#ephemeral-auth-tokens and
 * https://ai.google.dev/gemini-api/docs/live-api/ephemeral-tokens (checked
 * 2026-11-02). API limits: both times must be < 20 h in the future.
 *
 * - uses: 1                  one new Live session per token. Resuming a session
 *                            (sessionResumption) does not count as a use.
 * - newSessionExpireTime     the browser must open the connection within this
 *                            window of the token being issued (API default 60 s).
 * - expireTime               after this, messages on the connection are rejected
 *                            (API default 30 min). Connections themselves last
 *                            ~10 min, so sessions reconnect via resumption
 *                            within this window.
 */
export const TOKEN_USES = 1;
export const NEW_SESSION_WINDOW_MS = 60 * 1000;
export const SESSION_WINDOW_MS = 30 * 60 * 1000;

/**
 * Connection config locked into the token. When `liveConnectConstraints` is set
 * and `lockAdditionalFields` is not, the SDK sends no field mask and the API
 * takes the whole setup message from the token, so the browser cannot change
 * the model or this config (API reference: AuthToken.fieldMask).
 *
 * - sessionResumption       lets a session survive the ~10 min connection limit.
 * - contextWindowCompression without it audio-only sessions end at 15 min and
 *                            audio+video sessions at 2 min (session-management docs).
 *
 * The system instruction (safety/product language) belongs here too, so it
 * stays server-side; it is added with the conversation work in a later milestone.
 */
export const LOCKED_LIVE_CONFIG: LiveConnectConfig = {
  responseModalities: [Modality.AUDIO],
  sessionResumption: {},
  contextWindowCompression: { slidingWindow: {} },
};

export interface IssuedLiveToken {
  /** The ephemeral token (`auth_tokens/...`). Use it as the apiKey in the browser. */
  token: string;
  model: AllowedLiveModel;
  /** ISO 8601. Last moment a new Live session may be opened with the token. */
  newSessionExpireTime: string;
  /** ISO 8601. After this, messages on the connection are rejected. */
  expireTime: string;
}

export async function issueLiveToken(
  apiKey: string,
  model: AllowedLiveModel,
  now = Date.now(),
): Promise<IssuedLiveToken> {
  const ai = new GoogleGenAI({ apiKey });
  const expireTime = new Date(now + SESSION_WINDOW_MS).toISOString();
  const newSessionExpireTime = new Date(now + NEW_SESSION_WINDOW_MS).toISOString();

  const created = await ai.authTokens.create({
    config: {
      uses: TOKEN_USES,
      expireTime,
      newSessionExpireTime,
      liveConnectConstraints: { model, config: LOCKED_LIVE_CONFIG },
    },
  });

  if (!created.name) throw new Error("Token response had no name");
  return { token: created.name, model, newSessionExpireTime, expireTime };
}
