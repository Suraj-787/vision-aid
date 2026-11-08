# Milestone 10: voice interaction consolidation and release readiness

Date: 2026-11-08. Scope: stabilise the voice features added in Milestone 9 and afterwards. No new features.

**Status words used below**

| Status | Meaning |
|---|---|
| PASS | Checked, and it behaved as documented. |
| FAIL | Checked, and it did not. |
| BLOCKED | Could not be checked because something needed is unavailable. |
| NOT TESTED | Not checked at all. |

> **Automated results are not real-device results.** Every PASS in section 7 comes from headless Chrome
> with Chrome's fake camera and **mocked** speech recognition, speech synthesis and Gemini. They show that
> VisionAid's logic is right; they say nothing about how Android Chrome, iOS Safari, TalkBack, VoiceOver, a real
> microphone, a real Hindi or Kannada voice or a real person behave. **No physical device was available**
> (no `adb`, no iOS simulator tooling), so section 8 is entirely NOT TESTED.

## 1. Voice commands: current behaviour

Voice commands are optional (Accessibility settings, off by default), **English only**, and **one command per tap**
of *Say a command*: the microphone is never open in the background. A command must be the **whole utterance**
(filler words such as "please" are ignored; a sentence that merely contains a command word does nothing).

| Command | What it does | Phrases accepted |
|---|---|---|
| Capture photo | Takes the photo (camera on, no photo yet) | capture photo, capture, take (a) photo, take (a) picture |
| Retake photo | Discards the photo and returns to the camera preview (before the question is sent) | retake photo, retake, retake the photo, take photo again, take another photo |
| Start speaking | Starts dictation of the question | start speaking, start listening, ask a question, speak question, dictate |
| Repeat answer | Reads the answer again | repeat answer, repeat, repeat the answer, read (the) answer, listen to answer, read it again |
| Ask | Follows *Ask by voice* (section 2) | ask, ask now, send, send it, send question, submit |
| Done | Discards this conversation's data on this device and returns to capture (section 3) | done, all done, I am done, I'm done, finish, finished, that's all, end conversation, end |

Not voice commands, on purpose: *Stop listening* and *Stop speaking* (the microphone is busy with the question, or must be off
while VisionAid speaks), so they are buttons, and Escape stops speech.

### Which commands work at each step (one table, `lib/commands/voice-commands.ts`)

| Step | Works | Every other command |
|---|---|---|
| camera off | none | explained: "Capture photo needs the camera. Start the camera first." and so on |
| camera on, no photo | capture photo | explained |
| photo, no question | retake photo, start speaking, done | explained ("Ask needs a question first. Say start speaking, or type it.") |
| photo and question | retake photo, start speaking, ask, done | explained |
| request being sent | done (cancels the request) | explained ("Your question is already being sent.") |
| answer showing | repeat answer, done | explained ("Your question was already sent. Say done to start again, or use Ask another question.") |
| request failed | done | explained ("Your last request failed. Use Try again, or say done to start again.") |
| capturing or dictating | none | "VisionAid is busy right now. Wait a moment, then tap Say a command again." |

A refused command is **never silently ignored**: the reason (written for that step) appears on screen and is announced, and
nothing changes. An unrecognised phrase shows what was heard and what can be said now; silence says "I did not hear a command".

## 2. Ask by voice: consent behaviour

- **Off by default.** It is only available while Voice commands are on, and it is shown as on only when it is actually in effect.
- **Off:** saying "ask" moves focus to the Ask button and says what the button does. **Nothing is sent.**
- **On:** saying "ask" sends the photo and question to Google's Gemini service, once, and only when a photo **and** a question exist and
  no request is already running. Otherwise it says why and sends nothing.
- **Consent wording** (setting name and description, read by screen readers through `aria-describedby`): "Ask by voice (sends straight away)":
  saying "ask" sends your photo and question to Google's Gemini service at once, with no second step; when off it only moves to the Ask
  button. Turning it on is announced with the same facts.
- **Duplicated recognition events cannot double-send** (the first result ends the recognition session; later ones are ignored) and an
  in-flight request is never submitted again (`requestInFlightRef`).
- **Stored settings cannot enable it by accident:** the stored object is parsed strictly. Only the boolean `true` counts: strings, numbers,
  arrays, unknown fields, corrupt JSON, or "on" while voice commands are off all result in *off*.

## 3. Done: what it does and does not do

| Effect | Verified |
|---|---|
| Photo discarded, preview object URL released | PASS (automated) |
| Question text cleared; the next question box is empty | PASS (automated) |
| Previous answer and any error discarded | PASS (automated) |
| Speech stopped (including an answer being read) | PASS (automated) |
| A request in flight is cancelled; a late reply is never shown; no new request | PASS (automated) |
| Camera stays on (one live track); focus moves to Capture photo; a new capture works at once | PASS (automated) |
| Works from photo, photo and question, sending, answered, failed; refused with a reason before there is a photo | PASS (automated) |
| Requires the whole utterance ("I am done reading the label" does nothing) | PASS (automated) |

Done discards **the application's local session data only**. It does not delete files from the device, it sends nothing, and it does
**not** and cannot delete anything Google may already have received from an earlier question. The announcement says only that
the data was "discarded on this device".

## 4. Speech and microphone coordination

| Rule | How it is kept | Status |
|---|---|---|
| Speech and recognition never overlap | One `SpeechPlayer` for answers and guidance. Starting any recognition (command or dictation) stops speech first; a guidance prompt before dictation must finish before the microphone starts | PASS (automated) |
| Dictation and command listening never overlap | One recognition session (`useSpeechInput`); a second `start` is refused; a synchronously updated flag prevents the stale-state bug found in Milestone 9; a refused tap now says why | PASS (automated) |
| An interrupted prompt leaves nothing stuck | `stop()` bumps a generation counter, so late events from the interrupted prompt are ignored | PASS (automated) |
| A missing completion event does not disable controls | Watchdog (below) | PASS (automated, mocked) |
| Stop VisionAid voice stops the right thing | Stops speech and a pending prompt-then-listen; Escape does the same | PASS (automated) |
| Hide, leave, cancel, unmount release resources | Recognition aborted, speech cancelled, camera released | PASS (automated) |
| Repeated taps create no duplicate sessions | Guards on the session, a synchronous command flag, in-flight request flag | PASS (automated) |

**The speech completion fallback.** Only for engines that report `speaking` and `pending`. It checks once a second and finishes a
playback only after **two consecutive quiet checks** (`speaking` false and `pending` not true), so about 2 s of real silence. It never
acts while paused, while the engine reports speaking, or while utterances are queued (a slow-starting online voice). Unit tests cover:
60 checks of ongoing speech (not cut short), a queued-but-not-started voice, a brief gap between chunks, a late end event arriving
after the fallback finished (ignored), a late end event from an earlier playback (cannot end the next one) and a **duplicated end
event** (now counted once; found and fixed in this milestone, so a multi-part playback no longer finishes early). **Real engines are
NOT TESTED**: some may leave a gap longer than 2 s between parts, or report `speaking` unreliably.

## 5. Modes and multilingual behaviour

| Combination | Status |
|---|---|
| Screen-reader mode, no commands (standard workflow) | PASS (automated) |
| Screen-reader mode + voice commands (never speaks by itself; feedback visible and announced) | PASS (automated) |
| Voice-guided + voice commands (a tap interrupts a prompt; listening starts only after speech stops) | PASS (automated) |
| Voice-guided + automatic answer playback (prompt, then the answer; Stop works) | PASS (automated) |
| Voice-guided + Ask by voice + automatic playback, end to end | PASS (automated) |
| Hindi / Kannada prompts use only the matching voice; with no voice, nothing is spoken and the person is told | PASS (automated, mocked voices) |
| Hindi / Kannada prompt wording is natural and correct | **NOT TESTED: written without native-speaker review; it must be reviewed by native speakers** |
| Voice commands in Hindi / Kannada | Not implemented (English only, by decision) |
| Screen-reader announcements and on-screen text in Hindi / Kannada | Not implemented (English UI) |

## 6. Privacy and security checks

| Check | Status |
|---|---|
| Server operational log: **the question's intent was still logged** (`intent expiry_date`). Removed. Regression tests (one per intent) prove the log has no intent, question, answer, details, printed text or language; the non-sensitive timing and photo size remain. Tests fail when the old logging is put back | PASS (found and fixed) |
| One Gemini request per Ask; Retry only by the person; no automatic retries; Done/Cancel/Retake abort the request and free the server slot | PASS (unit, fake-Gemini server, browser) |
| No API key in client output: 0 build files contain the key; no key names or SDK in the client bundle | PASS |
| `.env` files not tracked (only `.env.example`) | PASS |
| Live Mode off by default (`POST /api/live-token` returns 404) | PASS |
| Browser storage holds only the four accessibility settings, written only when one is changed; no photo, question, answer, transcript or recording is stored | PASS (automated) |
| Voice command transcripts: shown briefly on screen, never stored or logged | PASS (automated storage check; code review for logging) |
| Gemini integration and response schema unchanged | PASS (no change to `src/lib/server` beyond the log line; unit tests) |

## 7. Automated test scenarios and results (2026-11-08)

| Scope | Result |
|---|---|
| `npm run lint` | PASS (clean) |
| `npm run typecheck` | PASS |
| `npm run build` | PASS |
| `npm test` | PASS: 690 tests (32 more than before this milestone) |
| Milestones 1-6 browser suite | PASS: 86 checks |
| Milestone 7 browser suite | PASS: 153 checks |
| Milestone 8 browser suite | PASS: 67 checks |
| Milestone 9 browser suite | PASS: 225 checks (three assertions updated to the new, more specific refusal wording) |
| **Milestone 10 browser suite** (`scripts/e2e/ui-m10.e2e.mjs`) | PASS: 212 checks |
| Camera lifecycle | PASS: 10 checks |
| Accessibility audit (axe-core, WCAG 2.2 rules, 13 runs incl. settings open, voice-guided, 200 % text, reduced motion) | PASS: 0 violations, 0 overflow, 0 targets under 44 px |

**Milestone 10 suite scenarios**

| ID | Scenario | Status |
|---|---|---|
| A | Standard workflow: camera, capture, type, Ask, answer, Listen, Stop, Ask another question | PASS |
| B | Voice workflow with Ask by voice OFF: capture, start speaking, dictate, "ask" sends nothing and focuses Ask, normal Ask, repeat answer, done, capture again | PASS |
| C / C2 | Ask by voice ON: exactly one request even with duplicated recognition events; "ask" while a request is in flight sends nothing | PASS |
| D / D2 | Voice-guided: interrupt a prompt (microphone starts only after cancel), next command works, lost completion event recovers by itself, long speech is not cut short | PASS |
| E / E2 | Done: object URL released, question cleared, answer gone, speech stopped, no request, camera still on, focus on Capture photo, nothing claimed about Google; Done during sending cancels, late reply never shown, next round works | PASS |
| F1-F5 | Microphone denied, silence, recognition unsupported, network loss with Ask by voice (no retry), page hide / leave while listening | PASS |
| G (x6), G2 | Malformed or contradictory stored settings never enable sending by voice; default state and wording of the setting | PASS |
| H | Every command at every step: either runs, or is explained on screen and by announcement and changes nothing | PASS |
| I1 / I2 | Voice-guided + automatic playback + Ask by voice end to end; screen-reader mode + commands never speaks by itself | PASS |

Findings fixed in this milestone (each with a regression test): server log included the question's intent; the speech player
counted a duplicated end event twice; command refusals used generic, sometimes wrong, reasons (for example "needs a photo" when one
existed); Done was refused while a request was being sent; the Ask-by-voice checkbox appeared checked while ineffective and its
description lacked "with no second step" when disabled; a tap on Start speaking during command listening, and Voice commands turned on
without recognition support, did nothing visible.

## 8. Real-device testing: NOT TESTED

No Android device, adb, or iOS simulator was available. **Every row below is NOT TESTED.** Record device, OS, browser and screen-reader
versions and the exact wording heard.

| # | Case | Status |
|---|---|---|
| 1 | Android Chrome: camera permission, rear camera, upright preview and photo | NOT TESTED |
| 2 | Android Chrome: speech recognition for English (commands), and for English, Hindi and Kannada (dictation) | NOT TESTED |
| 3 | Android Chrome: speech synthesis, Hindi and Kannada voices installed and missing, pause and resume, long answers | NOT TESTED |
| 4 | Android Chrome: does the 2 s completion fallback ever cut real speech short, or leave controls stuck? | NOT TESTED |
| 5 | Android TalkBack: step heading, camera group, announcements heard once, focus transitions, answer not read automatically, command messages | NOT TESTED |
| 6 | Android: voice commands one after another (capture, retake, start speaking, repeat, ask, done), including right after a prompt | NOT TESTED |
| 7 | Android: starting dictation from the "start speaking" command (no tap) is accepted by the browser | NOT TESTED |
| 8 | Android: Ask by voice sends exactly once; "ask" with Ask by voice off only focuses the button | NOT TESTED |
| 9 | Android: Done clears everything, the camera stays on, a new capture works | NOT TESTED |
| 10 | iOS Safari: camera over HTTPS, inline preview | NOT TESTED |
| 11 | iOS Safari: recognition availability (needs Siri and Dictation), error wording when unavailable | NOT TESTED |
| 12 | iOS Safari: speech restrictions: prompts after asynchronous events (camera ready, answer ready, automatic reading) may be blocked until speech has started from a tap | NOT TESTED |
| 13 | iOS VoiceOver: focus order, rotor by heading and by form control, announcement quality, double-tap activation, `aria-live` behaviour | NOT TESTED |
| 14 | iOS: voice commands, Ask by voice, Done (as 6-9) | NOT TESTED |
| 15 | Hindi and Kannada voices: quality, correct voice chosen, "voice missing" message, natural wording reviewed by native speakers | NOT TESTED |
| 16 | Screen lock and app switching while the camera, listening and speech are active | NOT TESTED |
| 17 | Blind and low-vision people completing the whole workflow unaided | NOT TESTED |

### How to run the manual tests

Use a production build over HTTPS (for example a tunnel to `npm run build && npm start`), staged non-sensitive items and consenting
people. Detailed step lists: `docs/testing-checklist.md` ("Milestone 9", sections A-E) cover TalkBack, VoiceOver, voice-guided mode,
commands and real users; add these Milestone 10 checks:

1. **Say a command, repeatedly:** capture photo, retake photo, capture photo, start speaking, say a question, say a command "ask" (with Ask by voice off: nothing sent), activate Ask, repeat answer, done, capture photo. After each, note what was shown and announced.
2. **Ask by voice on:** dictate a question, say a command "ask". Count the requests in the server log (should be exactly one). Then say "ask" again (nothing more is sent).
3. **Interrupt:** in voice-guided mode, tap Say a command while a prompt plays. The prompt must stop at once and listening must begin.
4. **Lost event:** note any case where "Stop VisionAid voice" stays active after speech has visibly ended, and whether it releases itself within about 3 s.
5. **Done:** after an answer, say a command "done". Confirm the answer and photo are gone, the camera is still on, focus is on Capture photo and nothing was sent.

## 9. Browser compatibility (documented support, not verified here)

Support data (MDN, as recorded in `docs/architecture.md`): `speechSynthesis` is available in Chrome, Edge, Firefox, Safari and Samsung
Internet; `SpeechRecognition` in Chrome (unprefixed from 139), Safari 14.1+ (prefixed) and Firefox 160+, **not** Firefox for Android.
Which languages are recognised, which voices exist, and whether a browser accepts speech started without a tap are **not** in that data and are
**not verified** for any real device.

## 10. Known limitations and remaining risks

- **No real-device validation of any kind** (section 8).
- Speech started without a tap (camera-ready prompt, answer-ready prompt, automatic reading, dictation after a voice command) may be refused by
  iOS Safari; VisionAid reports a refusal and does not retry. This is the largest unverified risk for voice-guided mode on iPhone.
- The completion fallback depends on the engine reporting `speaking`/`pending` correctly.
- Voice commands are English only. Hindi and Kannada prompt wording has not been reviewed by native speakers.
- Using Voice-guided mode together with TalkBack or VoiceOver produces two voices.
- Browser speech recognition may send the person's voice to an external service (documented in the privacy text).
- The selected language is not remembered between visits.
- The rate limiter and one-at-a-time guard are in memory, per server process (unchanged, documented in `docs/architecture.md`).
