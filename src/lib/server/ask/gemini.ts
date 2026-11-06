import "server-only";
import { GoogleGenAI } from "@google/genai";
import { buildUserText, RESPONSE_JSON_SCHEMA, SYSTEM_INSTRUCTION } from "@/lib/server/ask/prompt";

export const DEFAULT_GEMINI_TIMEOUT_MS = 30_000;

export interface GeminiInput {
  apiKey: string;
  model: string;
  /** Raw base64 of a verified JPEG. */
  imageBase64: string;
  question: string;
}

export interface GeminiOutput {
  /** The model's text (expected to be JSON); undefined when nothing was generated. */
  text: string | undefined;
  finishReason?: string;
  /** Set when the prompt itself was blocked (e.g. image safety). */
  blockReason?: string;
}

export interface GeminiClient {
  generate(input: GeminiInput): Promise<GeminiOutput>;
}

interface GeminiClientOptions {
  timeoutMs?: number;
  /** Tests only: point the real SDK at a local fake server. Never set in production. */
  baseUrl?: string;
}

/**
 * Standard (non-streaming, non-Live) Gemini call: one `models.generateContent`
 * request per question, from the server only. Automatic retries are switched
 * off (`attempts: 1`) so a failure can never silently consume extra quota; the
 * user decides whether to try again. Errors are thrown as-is for
 * classifyUpstreamError(); they must never be logged or returned raw.
 */
export function createGeminiClient(options: GeminiClientOptions = {}): GeminiClient {
  const timeoutMs = options.timeoutMs ?? DEFAULT_GEMINI_TIMEOUT_MS;

  return {
    async generate({ apiKey, model, imageBase64, question }) {
      const ai = new GoogleGenAI({
        apiKey,
        httpOptions: {
          ...(options.baseUrl ? { baseUrl: options.baseUrl } : {}),
          timeout: timeoutMs,
          retryOptions: { attempts: 1 },
        },
      });

      const response = await ai.models.generateContent({
        model,
        contents: [
          {
            role: "user",
            // Image first, then the text, as recommended for single-image prompts.
            parts: [
              { inlineData: { mimeType: "image/jpeg", data: imageBase64 } },
              { text: buildUserText(question) },
            ],
          },
        ],
        config: {
          systemInstruction: SYSTEM_INSTRUCTION,
          responseMimeType: "application/json",
          responseJsonSchema: RESPONSE_JSON_SCHEMA,
          abortSignal: AbortSignal.timeout(timeoutMs),
        },
      });

      return {
        text: response.text,
        finishReason: response.candidates?.[0]?.finishReason,
        blockReason: response.promptFeedback?.blockReason,
      };
    },
  };
}
