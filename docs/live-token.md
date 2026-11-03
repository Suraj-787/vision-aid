# Live token endpoint (Milestone 3)

> **Status (2026-11-02): retained infrastructure for an optional future Live
> Mode; not used by the default Tap-to-Ask workflow.** Tap-to-Ask calls Gemini
> from the server (`POST /api/ask`, Milestone 5) and never gives the browser a
> Gemini credential. **Disabled by default:** unless the server-side flag
> `ENABLE_LIVE_MODE` is exactly `true`, the route returns
> `404 LIVE_MODE_DISABLED` before reading the API key and mints nothing. Its
> env, origin-check and rate-limit modules are reused by `/api/ask`.

`POST /api/live-token` mints a short-lived, single-use Gemini Live ephemeral
token. The permanent API key never leaves the server. Nothing in this milestone
connects the camera or microphone to Gemini; the browser does not call the
endpoint yet.

Verified against official docs on 2026-11-02:
- https://ai.google.dev/gemini-api/docs/live-api/ephemeral-tokens (updated 2026-09-15)
- https://ai.google.dev/api/live#ephemeral-auth-tokens (updated 2026-10-09)
- https://ai.google.dev/gemini-api/docs/live-api/session-management (updated 2026-09-15)
- `@google/genai` 2.32.0 type definitions and source (`ai.authTokens.create`)

## Flow

```
Browser                       Next.js server (this repo)                 Gemini
  | POST /api/live-token  ->   1. read + validate env (key, model)
  |   Origin, JSON {}          2. check Origin, Content-Type, body
  |                            3. rate limit (per client, then global)
  |                            4. ai.authTokens.create({uses:1, expireTime,   ->  mint token
  |                                 newSessionExpireTime,                          locked to
  |                                 liveConnectConstraints:{model, config}})       model + config
  | <- {token, model, expireTime, newSessionExpireTime}   <-----------------------
  | (later milestone) ai.live.connect({ apiKey: token, ... })  ---------------->  Live session
```

Response (`200`, `Cache-Control: no-store`):

```json
{ "token": "auth_tokens/…", "model": "gemini-3.8-live",
  "newSessionExpireTime": "<ISO, +60 s>", "expireTime": "<ISO, +30 min>" }
```

Errors are `{ "error": { "code", "message" } }` with generic, safe messages:

| Status | `code` | Meaning |
|---|---|---|
| 404 | `LIVE_MODE_DISABLED` | `ENABLE_LIVE_MODE` is not `true` (checked first; nothing else runs) |
| 403 | `FORBIDDEN_ORIGIN` | Missing / non-matching `Origin` |
| 415 | `UNSUPPORTED_MEDIA_TYPE` | `Content-Type` is not `application/json` |
| 413 / 400 | `PAYLOAD_TOO_LARGE` / `INVALID_REQUEST` | Body > 1 KB, invalid JSON, or any field other than `{}` |
| 405 | – | Any method other than POST (and OPTIONS) |
| 429 | `RATE_LIMITED` | Rate limit hit; `Retry-After` header set |
| 500 | `SERVER_NOT_CONFIGURED` | Missing/malformed key or disallowed model. Details only in the **server** log |
| 502 | `UPSTREAM_AUTH` | Google rejected the server's key |
| 503 | `UPSTREAM_RATE_LIMITED` | Google quota exhausted (`Retry-After: 60`) |
| 502 | `UPSTREAM_ERROR` | Any other upstream failure |

## Expiry, session duration and constraints

| Setting | Value | Notes |
|---|---|---|
| `uses` | 1 | One new Live session per token. Resuming a session does **not** count as a use |
| `newSessionExpireTime` | now + 60 s | Browser must open the connection promptly. API default is also 60 s; must be < 20 h |
| `expireTime` | now + 30 min | After this, messages are rejected. API default 30 min; must be < 20 h |
| Locked `model` | `gemini-3.8-live` | Allowlist in `src/lib/server/env.ts` |
| Locked config | `responseModalities: [AUDIO]`, `sessionResumption: {}`, `contextWindowCompression.slidingWindow` | See below |

How the lock works: with `liveConnectConstraints` set and `lockAdditionalFields`
unset, the SDK sends no field mask, and the API takes the **entire** setup
message from the token and ignores the browser's (API reference, `AuthToken.fieldMask`).
So the browser cannot change the model or this config. Verified against the real
API (below).

Session limits from the Live docs, which the config accounts for:
- Without compression, audio-only sessions end at **15 min** and audio+video at **2 min**.
  `contextWindowCompression` removes the session cap (needed once camera frames are sent).
- A single **connection** lasts about **10 min**; the server sends `GoAway` first.
  `sessionResumption` lets a session continue across connections within `expireTime`.
  Resumption handles are valid for 2 h after a session ends.
- The system instruction (safety/product wording) will be added to the locked config
  in a later milestone so it stays server-side.

## Security notes

- The key is read only in server modules (`import "server-only"`; a client import fails the build). It is not `NEXT_PUBLIC_*`.
- Not returned, logged, or stored: the key and tokens are never logged; upstream error text is logged in development only, with the key scrubbed, and never returned to the client. Tokens are not persisted anywhere (no database or Redis).
- The key never appears in responses (headers or body), server logs, `.next/static`, or `public/` (checked).
- **Origin check**: browsers always send `Origin` on POST and page script cannot forge it, so other websites cannot mint tokens through a visitor's browser. The origin must match `Host`/`X-Forwarded-Host` or `ALLOWED_ORIGINS`. `application/json` also forces a CORS preflight, and no CORS headers are sent.
- **Rate limits** (in memory, per server process): 10 tokens / 10 min per client (`X-Forwarded-For`, then `X-Real-IP`), and 60 tokens / hour overall. State is lost on restart and not shared across serverless instances, and the client IP header is spoofable unless a trusted proxy sets it, so this is basic abuse protection and a quota guard, **not** a hard boundary. Non-browser clients can set `Origin` themselves; the limits are what bound them.
- **There is no user authentication** (out of scope for the MVP, per AGENTS.md). Anyone who can reach the origin from a browser can mint tokens within the limits. Do not deploy publicly without adding authentication or network restrictions.
- A leaked token is limited to one session on one model within minutes, which is the reason for using tokens rather than shipping the key.
- The SDK marks ephemeral tokens as experimental.

## Configure and test

1. `cp .env.example .env.local`, then set `GEMINI_API_KEY` and **`ENABLE_LIVE_MODE=true`**
   (leave `GEMINI_LIVE_MODEL` empty or `gemini-3.8-live`). Restart the server after
   changing env files. `.env*` is gitignored except `.env.example`.
2. `npm run dev`, then in another terminal (the `Origin` header is required):

```bash
curl -s -X POST http://localhost:3000/api/live-token \
  -H 'Origin: http://localhost:3000' -H 'Content-Type: application/json' -d '{}'
```

Treat the returned token as a secret for its short lifetime; do not paste it into logs or tickets.

3. When connecting from the browser in a later milestone, the SDK expects
   `new GoogleGenAI({ apiKey: token, httpOptions: { apiVersion: "v1alpha" } })`
   (it logs a warning otherwise). Both `v1alpha` and `v1beta` connected successfully in testing.
4. Tunnel testing (e.g. ngrok): `next.config.ts` already allows ngrok hostnames for dev assets;
   the endpoint accepts the tunnel origin through `X-Forwarded-Host`.

## Free-tier limitations (checked 2026-11-02)

- **Data use:** the official pricing page lists "Used to improve our products" as **Yes** on the
  Free tier and **No** on the Paid tier. Do not send sensitive, private or bystander content on the
  Free tier; use staged scenes and consenting participants (see AGENTS.md and
  `docs/model-and-quota-notes.md`). Confirm against the current terms before real-user testing.
- **Quota:** limits apply per **project**, not per key, and are not guaranteed
  (https://ai.google.dev/gemini-api/docs/rate-limits). Your dashboard showed 65K TPM for Gemini 3.8 Live
  on the Free tier; "unlimited RPM/RPD" does not mean unlimited total usage. Minting a token is
  cheap; the Live session itself consumes tokens (audio and video are counted).
- Session length and connection limits above apply regardless of tier.
- Preview/stable status, region and concurrent-session limits can change; check AI Studio
  (https://aistudio.google.com/rate-limit).

## Tests performed (2026-11-02)

Run against production builds (`next start`) with five configurations; see the Milestone 3 report
for results. Test scripts are throwaway and live outside the repo.
