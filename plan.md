# VisionAid — Product and Engineering Plan

## 1. Product vision

VisionAid is a mobile-first web experience that gives blind and low-vision users spoken, on-demand information about selected aspects of their immediate surroundings. A user starts a camera/microphone session, hears concise scene descriptions, and can interrupt to ask questions such as:

- “What is written on that sign?”
- “Can you describe the objects on the table?”
- “What does the label say?”
- “Is there a person standing near the desk?”

The assistant answers based only on recent camera/audio context and communicates uncertainty.

## 2. Target experience

- Open a website on a phone; no native app is required for the first prototype.
- User explicitly starts camera and microphone.
- The interface gives a clear spoken and visual indication when the session is active.
- Camera frames are sampled periodically (initially no more than about 1 FPS) and sent with user audio to a multimodal Live API session.
- The user can ask questions at any time.
- Spoken assistant output is interruptible; user speech takes priority.
- English, Hindi, and Kannada are initial language test targets.
- The assistant can read visible text when legible and describe ordinary objects/scenes.
- The assistant avoids repetitive narration and distinguishes current observations from earlier context.

## 3. MVP requirements

### Must have
- Responsive, accessible web UI.
- Explicit camera and microphone permission/start controls.
- Live camera preview and clear active/paused/stopped state.
- Secure backend creation of a short-lived client token.
- Live multimodal session with microphone input, sampled camera frames, and spoken output.
- Interruptible assistant audio.
- Voice questions and spoken responses.
- Clear stop control that releases camera/microphone tracks.
- Basic language testing in English, Hindi, and Kannada.
- Privacy notice and non-navigation safety disclaimer.

### Should have after core loop works
- Short-term scene context (session-only, not persisted).
- OCR/read-aloud prompts for visible text.
- Approximate relative positioning such as left/right/centre, only when supported.
- Adaptive narration frequency and repetition suppression.
- Optional text transcript/captions for accessibility and debugging, with privacy controls.

### Not in initial MVP
- Native iOS/Android app.
- Background camera operation or screen-locked operation.
- Smart-glasses integration.
- Navigation, route planning, obstacle avoidance, crossing guidance, or safety guarantees.
- Persistent storage of camera frames, audio, or transcripts.
- User accounts, database, analytics, Redis, multi-agent architecture.
- Automatic emergency detection.

## 4. Safety requirements

VisionAid is an experimental environmental information assistant, not a safety-critical mobility tool. It must not:
- Tell the user a road is safe to cross.
- Claim a path is clear or that all obstacles have been detected.
- Give turn-by-turn navigation or instructions for negotiating stairs/roads.
- Replace a white cane, guide dog, mobility training, or human assistance.

For safety-critical requests, the assistant should say it cannot reliably assess safety and encourage the user to rely on established mobility aids and trusted assistance. The product UI must make this limitation visible.

## 5. Suggested technology

- Next.js App Router + TypeScript
- Tailwind CSS
- Browser MediaDevices API
- HTML video + canvas for sampled frames
- Web Audio API / AudioWorklet for real-time audio processing, if required by the current Live API protocol
- `@google/genai` when supported by current official docs; otherwise documented WebSocket protocol
- Next.js server route for ephemeral token creation

Do not add a database or external speech provider in the first iteration. First test native Gemini Live multilingual audio. Consider an alternative STT/TTS provider only if measured quality is inadequate and after discussing the trade-offs.

## 6. Model selection and account quota

The user's Google AI Studio dashboard for project “AutoToon” showed a Free Tier entry named **Gemini 3.8 Live**, with 65K TPM and Unlimited RPM/RPD in the displayed 28-day view. The same dashboard showed other Live/audio models, including Gemini 3 Flash Live and Gemini 2.5 Flash Native Audio Dialog.

Treat these as dashboard observations, not a guarantee of unrestricted use. The TPM limit, session limits, concurrency, preview/model availability, regional access, and policy restrictions may still apply. “Unlimited RPM/RPD” does not mean unlimited total usage.

**Important:** Do not assume `gemini-3.8-live` is the exact API model ID. Verify the exact identifier and Live API compatibility against current official Google documentation before coding. Keep the value in `GEMINI_LIVE_MODEL` so it can be changed without editing application code.

## 7. Architecture summary

1. Browser requests camera/microphone only after user action.
2. Browser previews camera locally.
3. Browser calls a Next.js server endpoint to request an ephemeral Live API token.
4. Server uses the permanent API key from server-only environment variables and the currently documented token-creation API.
5. Browser connects to the Live API using the short-lived token and verified model ID.
6. Browser sends microphone audio and sampled camera frames according to the documented protocol.
7. Browser plays assistant audio and supports interruption.
8. No raw media is stored by the app.

See `docs/architecture.md`.

## 8. Privacy principles

- Explain that active-session audio/video is transmitted to the configured AI provider.
- Obtain explicit user action before activating camera/microphone.
- Avoid retaining raw media and transcripts.
- Never log secrets or media payloads.
- Use controlled, consent-based tests; avoid bystanders and sensitive environments.
- Check the provider's current data-use terms for the selected tier before testing with real people. Free-tier data handling may differ from paid-tier handling. Do not use sensitive footage for early tests.

## 9. Success criteria

- User can start and stop the session reliably on a supported mobile browser.
- The browser releases media devices on stop and teardown.
- A user can ask a spoken question and receive a spoken response.
- Camera context is recent and sampling is rate-limited.
- Assistant speech can be interrupted promptly.
- English, Hindi, and Kannada behavior is evaluated with a repeatable test set.
- No unsafe navigation claims appear in the evaluation set.
- No raw media or API secrets appear in logs or persistent storage.

## 10. Evaluation

Measure:
- Time from end of user question to first audible response.
- Speech recognition accuracy for the three target languages.
- Accuracy of visible-text reading on a controlled test set.
- Scene-description usefulness and hallucination rate.
- Interruption response time.
- Battery/network usage during a short session.
- Correct handling of uncertainty and safety-critical questions.

Run tests with informed consent and supervision. Do not ask participants to rely on VisionAid for movement or navigation.
