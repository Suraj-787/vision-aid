# Accessibility for blind and low-vision use (Milestone 9)

VisionAid has two ways of talking to the person. **Screen reader (the default)**:
the phone's own screen reader (TalkBack, VoiceOver) does the speaking, and VisionAid
only exposes its interface and announces changes. **Voice guided (optional)**: VisionAid
itself speaks short prompts at each step. The person chooses in *Accessibility settings*
(the first section on the page, collapsed, with the current mode in its heading). VisionAid
does not try to detect a running screen reader.

> Everything below was verified with **automated browser tests using mocked speech and a
> "virtual screen reader"** (a log of live-region announcements and focus). **Nothing has
> been tested with TalkBack, VoiceOver or a real blind user.** The manual guide is in
> `docs/testing-checklist.md` ("Milestone 9").

## What the audit found (before the changes)

| Severity | Finding |
|---|---|
| Critical | After a capture the same words were spoken twice (a live announcement *and* focus on the "Photo captured" heading). |
| Critical | The complete answer was announced automatically by the live region *and* focus moved to its heading, so it was read twice and without the person asking (the brief forbids automatic reading in screen-reader mode). |
| Critical | "Stop speaking" meant two different things (end dictation, stop playback). |
| Important | Focus was lost to the page after Ask and after Ask another question. |
| Important | A failed request was spoken three times (focus, live announcement and alert). |
| Important | Pressing a disabled Ask or Capture said nothing; the recognised question was never read back; the camera `<video>` carried a noisy label; ✓ ✕ ? were read as symbols; there was no step structure in the headings. |

## The announcement contract (screen-reader mode)

One polite live region (`role="status" aria-live="polite" aria-atomic="true"`, visually hidden)
carries workflow messages (`lib/a11y/announcer.ts`, `hooks/useAnnouncer.ts`). The camera status chip
is the only other status region (it owns camera states, so nothing competes). `role="alert"` is used
only for results of a person's own action that failed (camera or microphone permission, capture
failed, request failed, speech could not play). Rules enforced in code and tests: a message is not
repeated within 1.5 s; a different message is set immediately; a repeated one is cleared and set
again so it is heard; nothing re-announces on re-render; the answer text is never announced.

| After the person… | Focus goes to | Announced (once) |
|---|---|---|
| Start camera | stays on the button (which becomes Capture photo) | chip: "Waiting for permission. Allow camera access when your browser asks." then "Camera on. Ready to capture a photo." |
| Capture photo | the "Photo captured" heading | "Next, type or say your question." or advice: "The photo may be blurry. You can retake the photo, or continue with your question." (never "well framed" or "readable") |
| Retake / Cancel / Done | Capture photo (or Start camera) | what was discarded |
| Start speaking | the same button, now "Stop listening" | "Listening. Speak your question." then "Finished listening. Your question: … Edit it, or choose Ask." (or "Nothing was recognised…") |
| Ask | the "Asking Gemini…" heading | "Sending your photo and question to Google's Gemini service. Please wait." |
| (answer arrives) | the "Answer" heading | "Your answer is ready." plus "The AI is not confident about it." or "It includes something that is unclear." |
| (request fails) | the failure heading | the error alert, once |
| Ask another question / Edit question | the "Your question" heading | what to do next |
| Activates a disabled button | unchanged | why nothing happened ("Type or say a question to turn on Ask.") |

Structure: `h1` VisionAid; `h2` the current step ("Step 1 of 3: Take a photo", "Step 2 of 3: Ask your
question", "Step 3 of 3: Your answer"); the answer is `h3 Answer` with `h4` sections (expiry check,
banknote check, what is unclear, text I could read, printed instructions, changes VisionAid made).
The camera is a `role="group"` named "Camera" whose description says the preview need not be seen;
the `<video>` itself is `aria-hidden`. Status symbols (✓ ✕ ?) are hidden from screen readers, which
hear the words.

## Voice-guided mode

Short sentences for these moments (`lib/guidance/messages.ts`): welcome (when the person chooses the
mode), camera ready, camera unavailable, photo captured (+ advice + next step, as one prompt), listening,
processing, answer ready, request failed. Rules:

- Speech only follows a person's action or a state change they caused; **never on page load**, and a
  reload remembers the mode but says nothing.
- Prompts use the **existing** speech output (one shared player: guidance and answers can never overlap)
  and the existing voice selection, in the **selected language**. If no voice for that language is
  installed the prompt is **not spoken in another language**; the interface says so and the same words
  still reach the live region.
- A new prompt replaces an earlier prompt; a prompt never interrupts an answer being read; pressing
  Listen stops a prompt.
- **Listening starts only after its prompt has finished**, so the microphone never hears VisionAid. A
  second tap during the prompt does nothing.
- **Stop VisionAid voice** (always in the same place in voice-guided mode) and **Escape** stop all speech
  at once and cancel a pending listen. Page hide, page leave and unmount stop it too.
- *Read answers aloud automatically* (off by default, **only effective in voice-guided mode**, even if
  a saved preference says otherwise): after "Your answer is ready." the answer is read with the usual
  Pause/Resume/Stop controls. The existing spoken-answer plan (`spoken-text.ts`) is unchanged.

## Voice commands (optional, English only)

Turned on in settings. A **Say a command** button listens for **one** command, then stops (never in the
background, never on load; the permission prompt follows the tap). It reuses the single recognition
session (`useSpeechInput`), so it cannot overlap dictation. Commands: *capture photo*, *retake photo*,
*start speaking*, *repeat answer*, *ask*, *done*. The whole utterance must be a command (no word spotting), and
a command is run only when it fits the step, otherwise the reason is announced. The outcome is also shown
on screen ("Command understood: …", or what was heard and what can be said now), and silence is explained.
Tapping **Say a command** while VisionAid is speaking **interrupts the speech first and then listens**, so they never
overlap and a prompt never blocks the next command (an earlier version disabled the button during prompts, which made
commands appear to do nothing right after a capture). A **Stop listening**
button cancels at once; page hide, Cancel and unmount abort it. Transcripts are not stored or logged.

- **"Done" ends the conversation.** It does what the Done button does: the photo, question and answer are discarded on the device
  (nothing is sent), speech stops, the camera stays on, focus moves to Capture photo and the announcement says so, so the whole
  process can start again ("capture photo", "start speaking", …). It works once there is a photo (also from the failure screen, and
  while a request is being sent, where it cancels the request like the Cancel button), and, like every command, only as the whole
  utterance ("I am done reading the label" does nothing). It discards the application's session data on this device only: it does
  not delete anything from the device's files and it does not (and cannot) delete anything Google may already have received.
- **"Ask" / "send" (sends only if you opt in).** By default the word only moves focus to the Ask button and says what Ask does; the photo
  and question go to Google only when the person activates Ask. In *Accessibility settings* the person can turn on **Ask by voice (sends
  straight away)** (off by default, and only available while *Voice commands* are on). The wording states that saying "ask" then sends the
  photo and question to Google's Gemini service at once, with no second step, and turning it on is announced. This is the explicit,
  well-defined opt-in that preserves informed consent. Safeguards that stay: it sends only when a photo **and** a question exist and no
  request is running (otherwise it says why and sends nothing); the whole utterance must be the word (ordinary speech containing "ask" does
  nothing); there is still no retry; the announcement and screen say "Sending your photo and question to Google Gemini". Phrases: ask, ask now,
  send, send it, send question, submit ("ask a question" starts dictation instead).
- **"Stop speaking" and "Stop listening" are deliberately not voice commands**: while dictating, the
  microphone is busy with the question; while VisionAid speaks the microphone must be off (it would hear
  VisionAid). Both are buttons (and Escape).
- Hindi and Kannada commands are not implemented: the phrases cannot be validated here, and recognising
  English commands with a Hindi recogniser is unreliable.

### Which command works where (Milestone 10)

One table decides this (`lib/commands/voice-commands.ts`, exhaustively unit-tested; full detail in
`docs/milestone-10-validation.md`). A recognised command that does not fit the step is **never silently
ignored**: a reason written for that step is shown on screen and announced, and nothing changes.

| Step | Commands that work |
|---|---|
| camera off | none |
| camera on, no photo | capture photo |
| photo, no question yet | retake photo, start speaking, done |
| photo and question | retake photo, start speaking, ask, done |
| request being sent | done (cancels the request) |
| answer showing | repeat answer, done |
| request failed | done |
| capturing or dictating | none (VisionAid is busy) |

If voice commands are turned on in a browser without speech recognition, the page says so instead of showing nothing.

## Preferences and privacy

Four choices are remembered in this browser's `localStorage` under one key
(`visionaid.accessibility.v1`): the mode, automatic reading, voice commands, and asking by voice. Nothing is written until
the person changes one, values are validated strictly on read, and **no photo, question, answer, transcript,
language choice or audio is ever stored**. If storage is blocked the choices work for the visit only. The
selected language is still **not** remembered (Milestone 7 decision); a person who always uses Hindi or
Kannada must choose it each visit (a possible follow-up).

## Language status

| | English | Hindi | Kannada |
|---|---|---|---|
| Voice guidance prompts | written, reference | written, **not reviewed by a native speaker** | written, **not reviewed by a native speaker** |
| Read by | en-IN voice | hi-IN voice only | kn-IN voice only |
| Screen-reader announcements and on-screen text | yes | English only (the interface is English) | English only |
| Voice commands | yes | no | no |
| Dictation language, answers, printed text | Milestone 7 behaviour (unchanged) | same | same |

A test checks that every Hindi and Kannada prompt is entirely in its own script, so one matching voice reads
it. Whether the wording is natural and correct has **not** been checked by anyone.

## Browser and device limits (to confirm on real devices)

- **Speech after an asynchronous event** (camera ready, answer ready, automatic reading) is not directly
  caused by a tap. Chrome usually allows it once the page has spoken; **iOS Safari may block it** until speech has been started from a tap
  (the welcome prompt, when the mode is chosen, is that tap). A blocked prompt is reported, not retried.
- **Listening after a spoken prompt** is also started without a tap; a browser may refuse. If so, the error is shown and the next tap starts
  listening at once, without another prompt.
- Some engines never report the end of an utterance. The speech player holds a reference to each utterance and, when the engine
  reports `speaking`/`pending`, notices after about two seconds of silence that a playback ended and releases the controls
  (otherwise "Stop VisionAid voice" and the Listen controls could stay stuck). Verify on real devices.
- Using **Voice guided together with TalkBack or VoiceOver** produces two voices; the settings say so.
- Browser speech recognition may send the person's voice to an external service (as before).
- `aria-live` behaviour differs between screen readers; the contract above is conservative (one polite region,
  no rapid updates) but real TalkBack and VoiceOver behaviour is unverified.
