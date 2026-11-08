# Deploying VisionAid to Vercel

> **Status: NOT DEPLOYED.** This document and the repository changes were prepared in Milestone 11 and checked locally (see
> "What was and was not verified"). Nothing has been pushed to GitHub, nothing has been created on Vercel, and no production
> smoke test has been run. Do not treat the app as production-ready until you have followed section 6 and completed section 9 on
> the real deployment.

Vercel facts below were checked against Vercel's official documentation on **2026-11-08** (sources in section 11). Vercel changes limits and
defaults over time: re-check the linked pages if something behaves differently.

## 1. What is deployed

A single Next.js 16 App Router project, zero configuration on Vercel: static pages plus two route handlers.

| Route | Purpose | Runtime |
|---|---|---|
| `POST /api/ask` | The only route the app uses: validates the photo and question, makes **one** Gemini `generateContent` call, post-processes and returns the answer | Node.js function, `maxDuration = 60` |
| `POST /api/live-token` | Optional Live Mode, **disabled** unless `ENABLE_LIVE_MODE=true`; returns 404 otherwise | Node.js function |
| `/` and static assets | The interface (prerendered), fonts, audio worklet | CDN |

No database, no file storage, no authentication, no queue. Nothing is written to disk by the app.

## 2. Production compatibility findings

| Area | Finding | Evidence |
|---|---|---|
| Next.js 16 App Router | Supported; Vercel builds with `next build`. No `vercel.json` is required | Vercel docs: "deploying to Vercel is zero-configuration"; clean-checkout build in section 8 |
| Gemini SDK (`@google/genai`) | Runs in the Node.js runtime (default). Retries are disabled (`attempts: 1`), 30 s timeout, abortable | Unit tests with the real SDK against a fake server |
| Function duration | With Fluid compute (default for new projects) Vercel's default and the Hobby maximum are 300 s. The route now sets `export const maxDuration = 60` so an older project with a shorter default cannot cut a valid request off, and a stuck request cannot run for minutes. A unit test keeps it above the 30 s Gemini timeout | Vercel docs; `deployment-config.test.ts` |
| Request body size | Vercel's limit is **4.5 MB** (oversized requests get `413 FUNCTION_PAYLOAD_TOO_LARGE`). VisionAid's own cap is about **2.7 MB** (2 MB photo as base64 plus the question), and the browser keeps photos under 1.8 MB, so the app's friendly error appears first | Vercel docs; `ask-api.md` |
| Node.js version | **Vercel's default for new projects is now Node 26.x**, which this app has never run on (it is developed and tested on Node 22). `package.json` now has `"engines": {"node": "22.x"}`, which overrides the dashboard setting | Vercel docs; `deployment-config.test.ts` |
| Environment variables | Read on every request by the server (`readAskConfig`), never baked into the client bundle; nothing is `NEXT_PUBLIC_`. Changes apply only to **new** deployments | Vercel docs; build output scan |
| Secrets in the client | 0 files in the build output contain the key or the variable names | Section 8 |
| Local file system | None used (`fs` is not imported in `src/`) | `grep` |
| Logging | Fixed event strings only: timing, photo size and error codes. Nothing derived from the photo, question, transcript or answer (not even the intent). Vercel also keeps its own request logs (path, status, time, region) | Handler tests; section 9 check |
| Security headers / CSP | Set by `next.config.ts` for every route when `NODE_ENV=production` (Vercel's build and runtime). Vercel adds `Strict-Transport-Security: max-age=63072000` itself | Section 8 header probe; Vercel docs |
| Same-origin check | Compares `Origin` with the `Host` / `X-Forwarded-Host` header. On Vercel `Host` is the domain the visitor used (the custom domain once added), so `ALLOWED_ORIGINS` is normally not needed | Vercel docs |
| Client IP for rate limiting | Vercel **overwrites** `X-Forwarded-For` with the real client address, so the limiter's key cannot be spoofed by a visitor | Vercel docs |
| Aborted requests | VisionAid abandons the Gemini call when the browser disconnects. **On Vercel this only happens if request cancellation is enabled** (opt-in; see section 7). Without it a Cancel followed immediately by Ask can be refused as "request in progress" for up to 30 s if it reaches the same instance | Vercel docs (cancellation is opt-in) |

### In-memory state that does not work across serverless instances

These live in module memory (`src/app/api/ask/route.ts`, `src/lib/server/rate-limit.ts`). On Vercel several instances can run at once
and instances are not guaranteed to persist, so each instance has its **own** copy. Concurrent requests inside one instance share it
(Fluid compute runs several invocations in one instance).

| State | What it does | Effect on Vercel |
|---|---|---|
| Per-client sliding window (20 questions / 10 min) | Stops one visitor spending the quota | Per instance. A visitor whose requests reach different instances can exceed the limit; it resets when an instance is replaced |
| Overall sliding window (120 / hour) | Caps total use | Per instance, so the real total can be several times higher |
| One-request-at-a-time guard (`inFlight`) | Refuses a second simultaneous question from the same client | Per instance |
| Live-token limiters | Only used when Live Mode is enabled | Not applicable while Live Mode is off |

This is a **weaker** protection than on a single server, and it is not a security boundary (documented since Milestone 5). No database was
added, as instructed. Mitigations that need no code: the Vercel **WAF rate-limit rule** and Google-side quota limits (section 7).

## 3. Environment variables

Set these in **Project Settings → Environment Variables**. Names are exactly the ones the code reads. Never use a `NEXT_PUBLIC_` prefix and
never put a value in the repository.

| Name | Required | Value | Notes |
|---|---|---|---|
| `GEMINI_API_KEY` | **Yes** (Production) | Your Gemini API key | Server-only. Paste it with no quotes, no spaces and no `GEMINI_API_KEY=` prefix (a trailing newline is tolerated, quotes are rejected with a configuration error) |
| `GEMINI_MODEL` | **Yes** (Production) | The bare model ID your project can use, for example the one shown in Google AI Studio | **There is no default**: if it is missing the app answers every question with a configuration error. Confirm the model, tier and limits in AI Studio first |
| `ENABLE_LIVE_MODE` | No | Leave **unset**, or set `false` | Live Mode must stay off. Any value other than the word `true` (case ignored) keeps it disabled |
| `ALLOWED_ORIGINS` | No | Usually leave unset | Only for calling the API from a different origin than the page |
| `GEMINI_LIVE_MODEL` | No | Leave unset | Live Mode only |
| `SARVAM_API_KEY` | No | **Do not set** | Not read anywhere (Sarvam is not integrated) |

**Environments.** Add the two required variables to **Production**. For **Preview** deployments either leave them unset (previews then show a
clear configuration error instead of using your quota) or use a separate, low-quota key. Do not copy your production key into Preview unless
you want every preview to be able to spend it.

**After any change to an environment variable you must redeploy** (section 6.4): Vercel applies changes only to new deployments.

## 4. Do you need `vercel.json`?

**No, not to deploy.** Nothing in the app requires it, and none is included. One optional setting does need it (request cancellation, section 7).
Settings that are *not* in a file and must be checked in the dashboard: Node.js version (pinned by `engines`), function region, Fluid compute
(default for new projects), and Deployment Protection.

## 5. Project settings to check

| Setting (Project Settings) | Value |
|---|---|
| Framework Preset | Next.js (detected automatically) |
| Root Directory | repository root |
| Build / Install / Output | defaults |
| Node.js Version | `22.x` (comes from `package.json` `engines`; confirm the dashboard shows it or does not contradict it) |
| Function Region | Default is `iad1` (Washington, D.C.). Mumbai (`bom1`) is a listed region. Hobby projects have a single region. Choose where most visitors are; note the request also travels to Google |
| Fluid compute | Enabled by default for new projects (since 2025-04-23); not required |

## 6. Deployment steps (you perform these; nothing here has been done)

### 6.1 Prepare the repository
1. Review `git status`. Everything you want deployed must be committed (the Milestone 11 changes are currently uncommitted: `package.json`
   `engines`, `src/app/api/ask/route.ts` `maxDuration`, tests and docs).
2. Confirm `.env` is **not** tracked (`git ls-files | grep '^\.env'` should list only `.env.example`). `.gitignore` already excludes `.env`.
3. Run locally: `npm run lint && npm run typecheck && npm test && npm run build`.
4. Create a GitHub repository and push (`git remote add origin …`, `git push -u origin main`). **Only you should do this.**

### 6.2 Create the Vercel project
1. In Vercel: **Add New… → Project → Import Git Repository**, choose the repository.
2. Leave Framework Preset = Next.js and the build settings at their defaults.
3. Open **Environment Variables** *before* the first deploy and add `GEMINI_API_KEY` and `GEMINI_MODEL` for **Production** (section 3).
4. Click **Deploy**.

### 6.3 First deployment
1. Wait for the build to finish (it needs no secrets to build).
2. Open the production URL and run the smoke tests in section 9. Start with the no-quota checks (9.1-9.3).

### 6.4 Redeploy after changing environment variables
Vercel applies variable changes only to new deployments. After changing, adding or rotating a value: **Deployments → the latest production deployment →
⋯ → Redeploy** (or push a new commit). Then re-run smoke test 9.2.

### 6.5 Custom domain (optional)
1. **Project Settings → Domains → Add** and enter the domain. Vercel offers to add the `www` form too.
2. At your DNS provider add the records Vercel shows for your project: an **A record** for the apex domain, a **CNAME** for `www` (use the exact values
   shown in the dashboard; they are project-specific).
3. Vercel issues the HTTPS certificate automatically after DNS verification (usually within minutes). Camera and microphone only work over HTTPS.
4. No `ALLOWED_ORIGINS` is needed: on a custom domain the `Host` header is that domain.

## 7. Abuse, cost and cancellation controls (decide before sharing the URL)

A public deployment has **no authentication**: anyone who finds the URL can send photos and questions that use **your** Gemini quota.

1. **WAF rate-limit rule (recommended).** Vercel's WAF rate limiting is available on all plans (Hobby: 1 rule, IP key, fixed window 10 s to 10 min).
   Dashboard: **Firewall → Configure → New Rule**, condition *Request Path equals `/api/ask`* and *Method equals POST*, action **Rate Limit**, for example
   20 requests per 10 minutes per IP (matching the app's own per-client limit), response 429. Counters are per region.
2. **Google-side limits.** Check the quota and spending controls for your key and model in Google AI Studio / Google Cloud and set an alert or cap. Do not assume a
   model is free or has quota.
3. **Deployment Protection.** Preview deployments are protected differently from production. "Standard Protection" covers everything **except** production
   domains; the "All Deployments" option also protects the production domain (visitors must sign in to Vercel). Password Protection is a paid feature and is not on Hobby.
   If this is a private demo, consider protecting production too.
4. **Optional request cancellation.** To make Vercel pass the browser's disconnect to the app (so Cancel frees the Gemini call and the one-at-a-time slot at
   once), Vercel requires an opt-in in `vercel.json`:

   ```json
   {
     "functions": {
       "src/app/api/ask/route.ts": { "supportsCancellation": true }
     }
   }
   ```

   **Not included in the repository on purpose.** Vercel documents the setting and a glob for projects without a `src/` folder (`app/api/**/*`); it does
   not document the pattern for a `src/app` layout or what happens if a pattern matches nothing, so the path above is **unverified**. If you add it: deploy,
   then test (9.6); if the build rejects the pattern, remove the file (the app still works, with the limitation in section 2). Cancellation only works on the
   Node.js runtime and means the function can be terminated early (the app keeps nothing that needs finishing).

## 8. What was and was not verified (Milestone 11)

| Check | Result |
|---|---|
| `npm run lint`, `npm run typecheck`, `npm run build` | PASS |
| `npm test` | PASS: 700 tests (10 new: the route's `maxDuration`, the Node pin, Vercel-style pasted values, Live Mode flag) |
| Clean checkout **without `.env`**: `npm ci`, `npm run build` with no secrets in the environment | PASS (this run caught a real build failure, a type error in a new test file, which was fixed) |
| Started with variables given only through the process environment (a **fake** key and model; Gemini was never called) | PASS: without them `API_KEY_NOT_CONFIGURED` (HTTP 500); with them the request reaches validation (`MISSING_QUESTION`, HTTP 400) |
| Guards: no or foreign `Origin` 403, 3 MB body 413 (the app's own message), `POST /api/live-token` 404, `GET /` 200 | PASS |
| Security headers on `/` (CSP with `connect-src 'self'`, framing, nosniff, referrer, permissions) | PASS |
| Server log lines | PASS: only `[ask] rejected: …` event strings |
| Key or variable names in the client bundle | PASS: 0 files |
| Browser suites against that clean build: milestones 1-6 (86), 7 (153), 8 (67), 9 (225), 10 (212), camera lifecycle (10) | PASS (mocked speech and Gemini) |
| Accessibility audit against that build (13 runs) | PASS: 0 violations, 0 overflow, 0 small targets |
| Production dependency audit | PASS: 0 vulnerabilities in production dependencies (`npm audit --omit=dev`); one moderate finding in dev-only tooling |
| **A real Vercel deployment** | **NOT DONE** |
| Whether `request.signal` fires on Vercel | **NOT TESTED** (needs the opt-in and a deployment) |
| `supportsCancellation` glob for `src/app` | **UNVERIFIED** |
| Real Gemini request from Vercel (latency, quota, model access) | **NOT TESTED** |
| Real phones, TalkBack, VoiceOver, speech recognition on the deployed HTTPS site | **NOT TESTED by me** (see `docs/milestone-10-validation.md`) |

## 9. Production smoke-test checklist

Replace `https://YOUR-DOMAIN` with the production URL. Items 9.1-9.5 use **no Gemini quota**.

### 9.1 Site and headers
- [ ] `curl -sI https://YOUR-DOMAIN/` returns `200` with `Content-Security-Policy` (contains `connect-src 'self'` and `frame-ancestors 'none'`), `X-Frame-Options: DENY`,
      `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `Permissions-Policy: camera=(self), microphone=(self)…`, and Vercel's `Strict-Transport-Security`.
- [ ] Open the site in a desktop browser: no console errors (a CSP violation would appear here).

### 9.2 Environment is configured (no quota used)
```bash
curl -s -X POST https://YOUR-DOMAIN/api/ask -H 'Origin: https://YOUR-DOMAIN' -H 'Content-Type: application/json' -d '{}'
```
- [ ] Expect `{"error":{"code":"MISSING_QUESTION",…}}` (HTTP 400). That means the key and model are present and valid; the request was refused by validation before Gemini.
- [ ] If you see `API_KEY_NOT_CONFIGURED`, `MODEL_NOT_CONFIGURED` or `SERVER_NOT_CONFIGURED`: fix the variable (section 3) and **redeploy** (6.4).

### 9.3 Guards (no quota used)
- [ ] Same request **without** the `Origin` header, or with `Origin: https://evil.example`: HTTP 403 `FORBIDDEN_ORIGIN`.
- [ ] `Content-Type: text/plain`: HTTP 415. A 3 MB body: HTTP 413 `PAYLOAD_TOO_LARGE` (the app's own message, below Vercel's 4.5 MB limit).
- [ ] `curl -s -o /dev/null -w '%{http_code}' -X POST https://YOUR-DOMAIN/api/live-token -H 'Origin: https://YOUR-DOMAIN' -H 'Content-Type: application/json' -d '{}'` returns **404** (Live Mode off).

### 9.4 No secrets in the browser
- [ ] In the browser's developer tools (Sources / Network) search the loaded JavaScript for the first characters of your key: no match. No request goes to any host other than your domain.
- [ ] Application → Storage: only `visionaid.accessibility.v1` (and only after you change a setting).

### 9.5 Logs
- [ ] Vercel → Logs: after the checks above, lines are only fixed strings such as `[ask] rejected: MISSING_QUESTION`. After a real question (9.7) the only extra line is `[ask] answered in … ms (image … KB)`. **No** question, answer, intent or image data.

### 9.6 Limits and cancellation (uses a little quota)
- [ ] If you created the WAF rule: confirm the 21st rapid `POST /api/ask` from one IP gets 429 (use the harmless `{}` request).
- [ ] If you enabled `supportsCancellation`: in the app, ask a question and press **Cancel** at once, then capture and ask again immediately: it must not report "already in progress".

### 9.7 End to end on a phone (HTTPS; uses quota; staged, non-sensitive photo only)
- [ ] Start camera (permission prompt appears only after the tap), capture, type a question, Ask: a real answer arrives; Listen reads it; Done clears everything.
- [ ] Unplug the network (airplane mode) and Ask: clear error, no automatic retry; Try again works after reconnecting.
- [ ] Hindi and Kannada question, voice commands, Ask by voice, TalkBack and VoiceOver passes: use the manual checklists in `docs/testing-checklist.md` and `docs/milestone-10-validation.md` (**NOT TESTED by me**).

## 10. Troubleshooting

| Symptom | Likely cause and fix |
|---|---|
| Build fails on Node-version or syntax errors | Check the build log shows Node 22.x; the `engines` field must not be overridden |
| Every question says the server is not configured | Variables missing in the **Production** environment, or changed without redeploying (6.4) |
| `SERVER_NOT_CONFIGURED` | The key or model has quotes, spaces or a `NAME=` prefix; re-enter it exactly |
| 504 / "took too long" | Gemini slow or unavailable (the call times out at 30 s and is never retried); try again; check model availability and quota in AI Studio |
| 429 from `/api/ask` | The app's per-instance limit, or your WAF rule |
| 413 | Photo too large (the browser normally prevents this) |
| Camera or microphone does nothing | Not on HTTPS, or the browser permission was denied; see the in-app messages |
| Preview deployment asks you to sign in | Deployment Protection (expected) |

## 11. Sources (checked 2026-11-08)

- https://vercel.com/docs/functions/limitations (4.5 MB payload, durations, default region)
- https://vercel.com/docs/functions/configuring-functions/duration and https://vercel.com/docs/fluid-compute (default and maximum duration, Fluid compute defaults, shared instances)
- https://vercel.com/docs/functions/runtimes/node-js/node-js-versions (Node versions, `engines`)
- https://vercel.com/docs/environment-variables (changes apply to new deployments, size limit, environments)
- https://vercel.com/docs/functions/functions-api-reference (request cancellation is opt-in via `vercel.json`)
- https://vercel.com/docs/project-configuration/vercel-json (`functions` globs, `supportsCancellation`)
- https://vercel.com/docs/headers/request-headers and https://vercel.com/docs/headers/response-headers (`X-Forwarded-For` overwritten, `Host`, HSTS)
- https://vercel.com/docs/vercel-firewall/vercel-waf/rate-limiting (all plans, Hobby 1 rule, 10 s-10 min windows, per-region counters)
- https://vercel.com/docs/deployment-protection (Standard Protection vs All Deployments, Password Protection not on Hobby)
- https://vercel.com/docs/domains/set-up-custom-domain and https://vercel.com/docs/regions (domain records, automatic certificates, `bom1`)
- Next.js `maxDuration` route option: `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/02-route-segment-config/maxDuration.md`
