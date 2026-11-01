# Model and quota notes

## What the user's dashboard showed

The user's Google AI Studio dashboard for project **AutoToon**, Free Tier, in a 28-day view displayed:

| Dashboard model label | RPM | TPM | RPD |
|---|---:|---:|---:|
| Gemini 2.5 Flash Native Audio Dialog | Unlimited | 1M | Unlimited |
| Gemini 3 Flash Live | Unlimited | 65K | Unlimited |
| Gemini 3.5 Live Translate | Unlimited | 20K | Unlimited |
| Gemini 3.5 Transcribe Live | Unlimited | 20K | Unlimited |
| Gemini 3.8 Live | Unlimited | 65K | Unlimited |
| Gemini 3.8 Live Extended Thinking | Unlimited | 65K | Unlimited |

These are the values shown in the user's dashboard at the time they shared it. They are not a guarantee of unlimited total usage. TPM, session duration, concurrent sessions, model availability, preview restrictions, region, and policy limits may still apply. The dashboard's usage view showed no consumption at that time.

## Model choice

The initial candidate to evaluate is the dashboard entry **Gemini 3.8 Live**, because it showed a 65K TPM allowance in the user's project. Also keep **Gemini 3 Flash Live** and **Gemini 2.5 Flash Native Audio Dialog** as comparison candidates.

**Do not assume the dashboard label is the API model identifier.** Before writing integration code:
1. Open current official Gemini Live API model documentation.
2. Confirm the exact model ID is supported for Live sessions.
3. Confirm the model supports the required image/video and audio input/output modes.
4. Confirm ephemeral token support and the supported SDK/protocol.
5. Record the official model ID and documentation date in the implementation notes.
6. Put the verified identifier in `GEMINI_LIVE_MODEL`.

If the model shown in the dashboard is unavailable in the Live API documentation, do not guess an identifier. Select a documented compatible model and explain the trade-off.

## Free-tier privacy caution

Review Google's current data-use and privacy terms for the selected API tier before testing with real users. Free-tier data handling may differ from paid-tier handling. For early development, use staged scenes, consented participants, and non-sensitive environments. Avoid capturing bystanders, private documents, addresses, or other sensitive information.

## Official documentation starting points

- Gemini API pricing: https://ai.google.dev/gemini-api/docs/pricing
- Gemini Live API: https://ai.google.dev/gemini-api/docs/live
- Gemini Live API capabilities: https://ai.google.dev/gemini-api/docs/live-api/capabilities
- Live API ephemeral tokens: https://ai.google.dev/gemini-api/docs/live-api/ephemeral-tokens
- Gemini API rate limits: https://ai.google.dev/gemini-api/docs/rate-limits

Documentation paths can change. If a link redirects or is outdated, find the corresponding current page from the official `ai.google.dev` documentation.
