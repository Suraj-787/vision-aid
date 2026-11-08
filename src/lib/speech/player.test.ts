import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mapSynthesisErrorCode, speechOutputError } from "./speech-output-errors.ts";
import { PAUSE_CHECK_MS, SpeechPlayer, WATCHDOG_MS, WATCHDOG_QUIET_CHECKS, type PlayerChunk, type PlayerEvent, type SynthLike, type UtteranceLike } from "./player.ts";

const voice = { name: "Test", lang: "hi-IN", localService: true, default: false };
const chunk = (text: string, lang = "hi-IN"): PlayerChunk => ({ text, lang, voice: { ...voice, lang } });

/** A fake engine that behaves like Chrome: cancel() reports "canceled" on the utterance that was playing. */
class FakeSynth implements SynthLike {
  queue: UtteranceLike[] = [];
  paused = false;
  cancelCalls = 0;
  ignorePause = false;
  throwOnSpeak = false;
  speak(u: UtteranceLike) {
    if (this.throwOnSpeak) throw new Error("engine down");
    this.queue.push(u);
  }
  cancel() {
    this.cancelCalls++;
    const playing = this.queue[0];
    this.queue = [];
    this.paused = false;
    playing?.onerror?.({ error: "canceled" });
  }
  pause() {
    if (!this.ignorePause) this.paused = true;
  }
  resume() {
    this.paused = false;
  }
  /** The engine finishes the utterance at the head of the queue. */
  finishOne() {
    this.queue.shift()?.onend?.();
  }
  failOne(code: string) {
    this.queue[0]?.onerror?.({ error: code });
  }
}

function setup() {
  const synth = new FakeSynth();
  const events: PlayerEvent[] = [];
  const timers: Array<() => void> = [];
  const created: UtteranceLike[] = [];
  const player = new SpeechPlayer({
    synth,
    createUtterance: (text) => {
      const u: UtteranceLike = { text, lang: "", voice: null, rate: 1, pitch: 1, volume: 1, onstart: null, onend: null, onerror: null };
      created.push(u);
      return u;
    },
    onEvent: (e) => events.push(e),
    schedule: (fn) => timers.push(fn),
  });
  const states = () => events.filter((e) => e.type === "state").map((e) => (e as { state: string }).state);
  return { synth, player, events, timers, created, states };
}

describe("SpeechPlayer: playing", () => {
  it("queues every chunk with its own language and voice, in order", () => {
    const { synth, player } = setup();
    assert.equal(player.play([chunk("one", "hi-IN"), chunk("two", "en-IN")]), true);
    assert.deepEqual(synth.queue.map((u) => [u.text, u.lang, (u.voice as { lang: string }).lang]), [["one", "hi-IN", "hi-IN"], ["two", "en-IN", "en-IN"]]);
    assert.equal(player.state, "speaking");
  });

  it("reports finished once, after the last chunk, and returns to idle", () => {
    const { synth, player, events, states } = setup();
    player.play([chunk("a"), chunk("b"), chunk("c")]);
    synth.finishOne();
    synth.finishOne();
    assert.equal(player.state, "speaking");
    assert.equal(events.filter((e) => e.type === "finished").length, 0);
    synth.finishOne();
    assert.equal(player.state, "idle");
    assert.equal(events.filter((e) => e.type === "finished").length, 1);
    assert.deepEqual(states(), ["speaking", "idle"]);
  });

  it("refuses to start while already speaking or paused (no overlapping speech)", () => {
    const { synth, player, created } = setup();
    assert.equal(player.play([chunk("a")]), true);
    assert.equal(player.play([chunk("b")]), false);
    player.pause();
    assert.equal(player.play([chunk("c")]), false);
    assert.equal(created.length, 1);
    assert.equal(synth.queue.length, 1);
  });

  it("refuses an empty plan", () => {
    const { player } = setup();
    assert.equal(player.play([]), false);
    assert.equal(player.state, "idle");
  });

  it("can be played again after finishing", () => {
    const { synth, player } = setup();
    player.play([chunk("a")]);
    synth.finishOne();
    assert.equal(player.play([chunk("b")]), true);
    assert.equal(synth.queue.length, 1);
  });
});

describe("SpeechPlayer: stop and cancellation", () => {
  it("stop clears the whole queue and returns to idle", () => {
    const { synth, player } = setup();
    player.play([chunk("a"), chunk("b"), chunk("c")]);
    player.stop();
    assert.equal(player.state, "idle");
    assert.equal(synth.queue.length, 0);
    assert.equal(synth.cancelCalls, 1);
  });

  it("the engine's own 'canceled' error after stop() is ignored: no error, no extra state", () => {
    const { player, events } = setup();
    player.play([chunk("a")]);
    player.stop();
    assert.equal(events.filter((e) => e.type === "error").length, 0);
    assert.equal(events.filter((e) => e.type === "finished").length, 0);
  });

  it("stop while paused works", () => {
    const { synth, player } = setup();
    player.play([chunk("a")]);
    player.pause();
    player.stop();
    assert.equal(player.state, "idle");
    assert.equal(synth.paused, false);
  });

  it("stop when idle does nothing (does not cancel other speech)", () => {
    const { synth, player, events } = setup();
    player.stop();
    assert.equal(synth.cancelCalls, 0);
    assert.equal(events.length, 0);
  });

  it("late events from a stopped playback cannot change state or finish a new one", () => {
    const { synth, player, created, events } = setup();
    player.play([chunk("old1"), chunk("old2")]);
    const [oldA, oldB] = created;
    player.stop();
    player.play([chunk("new")]);
    oldA.onend?.();
    oldB.onend?.();
    oldA.onerror?.({ error: "synthesis-failed" });
    assert.equal(player.state, "speaking");
    assert.equal(events.filter((e) => e.type === "finished").length, 0);
    assert.equal(events.filter((e) => e.type === "error").length, 0);
    synth.finishOne();
    assert.equal(events.filter((e) => e.type === "finished").length, 1);
  });

  it("stale speech never plays after a new playback started: only the new chunks are queued", () => {
    const { synth, player } = setup();
    player.play([chunk("old")]);
    player.stop();
    player.play([chunk("new")]);
    assert.deepEqual(synth.queue.map((u) => u.text), ["new"]);
  });

  it("dispose cancels speech and silences everything after it", () => {
    const { synth, player, events, created } = setup();
    player.play([chunk("a")]);
    const before = events.length;
    player.dispose();
    assert.equal(synth.cancelCalls, 1);
    created[0].onend?.();
    created[0].onerror?.({ error: "failed" });
    assert.equal(events.length, before, "no events after dispose");
    assert.equal(player.play([chunk("x")]), false);
    player.dispose(); // idempotent
    assert.equal(synth.cancelCalls, 1);
  });

  it("dispose when idle does not touch the engine", () => {
    const { synth, player } = setup();
    player.dispose();
    assert.equal(synth.cancelCalls, 0);
  });
});

describe("SpeechPlayer: pause and resume", () => {
  it("pauses and resumes", () => {
    const { synth, player, states, timers } = setup();
    player.play([chunk("a")]);
    player.pause();
    assert.equal(player.state, "paused");
    assert.equal(synth.paused, true);
    timers.forEach((t) => t()); // the engine really paused: nothing changes
    assert.equal(player.state, "paused");
    player.resume();
    assert.equal(player.state, "speaking");
    assert.equal(synth.paused, false);
    assert.deepEqual(states(), ["speaking", "paused", "speaking"]);
  });

  it("pause and resume do nothing when they do not apply", () => {
    const { synth, player, events } = setup();
    player.pause();
    player.resume();
    assert.equal(events.length, 0);
    player.play([chunk("a")]);
    player.resume(); // not paused
    assert.equal(player.state, "speaking");
    assert.equal(synth.paused, false);
  });

  it("detects an engine that ignores pause() and reports it, staying in 'speaking'", () => {
    const { synth, player, events, timers } = setup();
    synth.ignorePause = true;
    player.play([chunk("a")]);
    player.pause();
    assert.equal(player.state, "paused"); // optimistic until checked
    assert.equal(timers.length, 1);
    timers.forEach((t) => t());
    assert.equal(player.state, "speaking");
    assert.equal(events.filter((e) => e.type === "pause-unsupported").length, 1);
  });

  it("a late pause check cannot affect a newer playback", () => {
    const { synth, player, events, timers } = setup();
    synth.ignorePause = true;
    player.play([chunk("a")]);
    player.pause();
    player.stop();
    player.play([chunk("b")]);
    timers.forEach((t) => t());
    assert.equal(player.state, "speaking");
    assert.equal(events.filter((e) => e.type === "pause-unsupported").length, 0);
  });

  it("the pause check is scheduled", () => {
    assert.ok(PAUSE_CHECK_MS > 0 && PAUSE_CHECK_MS < 1000);
  });
});

describe("SpeechPlayer: errors", () => {
  it("a real engine error stops everything, clears the queue and reports it once", () => {
    const { synth, player, events } = setup();
    player.play([chunk("a"), chunk("b")]);
    synth.failOne("synthesis-failed");
    assert.equal(player.state, "idle");
    assert.equal(synth.queue.length, 0);
    assert.deepEqual(events.filter((e) => e.type === "error"), [{ type: "error", kind: "failed" }]);
    assert.equal(events.filter((e) => e.type === "finished").length, 0);
  });

  it("not-allowed (autoplay policy) is reported as blocked", () => {
    const { synth, player, events } = setup();
    player.play([chunk("a")]);
    synth.failOne("not-allowed");
    assert.deepEqual(events.filter((e) => e.type === "error"), [{ type: "error", kind: "blocked" }]);
  });

  it("an interruption from outside (another app took the audio) ends quietly, without an error", () => {
    const { synth, player, events } = setup();
    player.play([chunk("a")]);
    synth.failOne("interrupted");
    assert.equal(player.state, "idle");
    assert.equal(events.filter((e) => e.type === "error").length, 0);
  });

  it("an engine that throws on speak() leaves the player idle and reports an error", () => {
    const { synth, player, events } = setup();
    synth.throwOnSpeak = true;
    assert.equal(player.play([chunk("a")]), false);
    assert.equal(player.state, "idle");
    assert.deepEqual(events.filter((e) => e.type === "error"), [{ type: "error", kind: "failed" }]);
    synth.throwOnSpeak = false;
    assert.equal(player.play([chunk("b")]), true); // and it recovers
  });
});

describe("speech output error mapping", () => {
  it("maps every documented SpeechSynthesisErrorEvent code", () => {
    assert.equal(mapSynthesisErrorCode("canceled"), "quiet");
    assert.equal(mapSynthesisErrorCode("interrupted"), "quiet");
    assert.equal(mapSynthesisErrorCode("not-allowed"), "blocked");
    assert.equal(mapSynthesisErrorCode("audio-busy"), "audio-busy");
    assert.equal(mapSynthesisErrorCode("audio-hardware"), "audio-busy");
    for (const code of ["synthesis-unavailable", "synthesis-failed", "language-unavailable", "voice-unavailable", "text-too-long", "invalid-argument", "network", "unknown", "", undefined, "something-new"]) {
      assert.equal(mapSynthesisErrorCode(code), "failed", String(code));
    }
  });

  it("every message gives a recovery step and says the text is still shown where relevant", () => {
    for (const kind of ["unsupported", "no-voice", "blocked", "audio-busy", "failed"] as const) {
      const e = speechOutputError(kind);
      assert.equal(e.kind, kind);
      assert.ok(e.message.length > 20, kind);
    }
    assert.match(speechOutputError("unsupported").message, /shown as text/);
    assert.match(speechOutputError("no-voice").message, /shown as text/);
    assert.match(speechOutputError("blocked").message, /Tap Listen again/);
  });
});

/** An engine that reports speaking/pending (so the watchdog applies) and may lose end events. */
class ReportingSynth extends FakeSynth {
  isSpeaking = true;
  isPending = false;
  get speaking() { return this.isSpeaking; }
  get pending() { return this.isPending; }
}

function watched() {
  const synth = new ReportingSynth();
  const events: PlayerEvent[] = [];
  const timers: Array<() => void> = [];
  const created: UtteranceLike[] = [];
  const player = new SpeechPlayer({
    synth,
    createUtterance: (text) => {
      const u: UtteranceLike = { text, lang: "", voice: null, rate: 1, pitch: 1, volume: 1, onstart: null, onend: null, onerror: null };
      created.push(u);
      return u;
    },
    onEvent: (e) => events.push(e),
    schedule: (fn) => timers.push(fn),
  });
  /** Runs the timers that are due now (each may schedule the next check). */
  const tick = () => { const due = timers.splice(0); due.forEach((t) => t()); };
  return { synth, player, events, tick, timers, created };
}

describe("SpeechPlayer: lost end events (watchdog)", () => {
  it("finishes a playback whose end event never arrives once the engine has gone quiet", () => {
    const { synth, player, events, tick } = watched();
    player.play([chunk("a"), chunk("b")]);
    synth.isSpeaking = false; // the engine is silent, but no onend was ever delivered
    for (let i = 0; i < WATCHDOG_QUIET_CHECKS; i++) tick();
    assert.equal(player.state, "idle");
    assert.equal(events.filter((e) => e.type === "finished").length, 1);
  });

  it("needs several consecutive quiet checks, so a brief gap between chunks is not mistaken for the end", () => {
    const { synth, player, events, tick } = watched();
    player.play([chunk("a")]);
    synth.isSpeaking = false;
    tick(); // one quiet check
    synth.isSpeaking = true; // the next chunk started
    tick();
    synth.isSpeaking = false;
    tick();
    assert.equal(player.state, "speaking");
    assert.equal(events.filter((e) => e.type === "finished").length, 0);
  });

  it("does not finish while the engine still reports queued utterances", () => {
    const { synth, player, tick } = watched();
    player.play([chunk("a")]);
    synth.isSpeaking = false;
    synth.isPending = true;
    for (let i = 0; i < 5; i++) tick();
    assert.equal(player.state, "speaking");
  });

  it("never finishes a paused playback (paused is quiet on purpose), and resumes watching afterwards", () => {
    const { synth, player, tick } = watched();
    player.play([chunk("a")]);
    player.pause();
    synth.isSpeaking = false;
    for (let i = 0; i < 6; i++) tick();
    assert.equal(player.state, "paused");
  });

  it("a normal end event still finishes exactly once, and a later watchdog tick does nothing", () => {
    const { synth, player, events, tick } = watched();
    player.play([chunk("a")]);
    synth.finishOne();
    assert.equal(events.filter((e) => e.type === "finished").length, 1);
    synth.isSpeaking = false;
    for (let i = 0; i < 4; i++) tick();
    assert.equal(events.filter((e) => e.type === "finished").length, 1);
  });

  it("a stopped playback's watchdog cannot affect the next playback", () => {
    const { synth, player, events, tick } = watched();
    player.play([chunk("a")]);
    player.stop();
    player.play([chunk("b")]);
    synth.isSpeaking = true;
    for (let i = 0; i < 5; i++) tick();
    assert.equal(player.state, "speaking");
    assert.equal(events.filter((e) => e.type === "finished").length, 0);
  });

  it("is not used for engines that do not report speaking, so existing behaviour is unchanged", () => {
    const { player, timers } = setup();
    player.play([chunk("a")]);
    assert.equal(timers.length, 0);
  });

  it("the interval is sensible", () => {
    assert.ok(WATCHDOG_MS >= 500 && WATCHDOG_MS <= 2000);
  });
});

describe("SpeechPlayer: duplicated, delayed and missing events (Milestone 10)", () => {
  it("a duplicated end event does not count twice, so a multi-part playback does not finish early", () => {
    const { player, events, created } = setup();
    player.play([chunk("a"), chunk("b"), chunk("c")]);
    created[0].onend?.();
    created[0].onend?.(); // the engine delivered the first end twice
    created[0].onend?.();
    assert.equal(player.state, "speaking", "two parts are still to be spoken");
    assert.equal(events.filter((e) => e.type === "finished").length, 0);
    created[1].onend?.();
    created[2].onend?.();
    assert.equal(player.state, "idle");
    assert.equal(events.filter((e) => e.type === "finished").length, 1);
  });

  it("a duplicated error event reports one error", () => {
    const { synth, player, events } = setup();
    player.play([chunk("a")]);
    synth.failOne("synthesis-failed");
    synth.failOne("synthesis-failed");
    assert.equal(events.filter((e) => e.type === "error").length, 1);
  });

  it("a delayed end event after the watchdog already finished the playback is ignored", () => {
    const { synth, player, events, tick, created } = watched();
    player.play([chunk("a")]);
    synth.isSpeaking = false;
    for (let i = 0; i < WATCHDOG_QUIET_CHECKS; i++) tick();
    assert.equal(events.filter((e) => e.type === "finished").length, 1);
    created[0].onend?.(); // arrives late
    assert.equal(events.filter((e) => e.type === "finished").length, 1, "no second finish");
    assert.equal(player.state, "idle");
  });

  it("a delayed end event from an earlier playback cannot end the next one", () => {
    const { synth, player, events, tick, created } = watched();
    player.play([chunk("old")]);
    synth.isSpeaking = false;
    for (let i = 0; i < WATCHDOG_QUIET_CHECKS; i++) tick();
    synth.isSpeaking = true;
    player.play([chunk("new")]);
    created[0].onend?.(); // the OLD utterance's late end
    assert.equal(player.state, "speaking", "the new playback is untouched");
    assert.equal(events.filter((e) => e.type === "finished").length, 1, "only the old playback finished");
  });

  it("legitimate long speech is never cut short: the watchdog does nothing while the engine reports speaking", () => {
    const { synth, player, events, tick } = watched();
    player.play([chunk("a"), chunk("b")]);
    synth.isSpeaking = true;
    for (let i = 0; i < 60; i++) tick(); // a minute of checks
    assert.equal(player.state, "speaking");
    assert.equal(events.filter((e) => e.type === "finished").length, 0);
  });

  it("a slow-starting online voice (queued, not yet speaking) is not mistaken for silence", () => {
    const { synth, player, tick } = watched();
    player.play([chunk("a")]);
    synth.isSpeaking = false;
    synth.isPending = true; // waiting for the network voice to start
    for (let i = 0; i < 20; i++) tick();
    assert.equal(player.state, "speaking");
    synth.isPending = false; // it never started: now it is quiet
    for (let i = 0; i < WATCHDOG_QUIET_CHECKS; i++) tick();
    assert.equal(player.state, "idle");
  });

  it("an interrupted prompt leaves the player ready at once (no stuck state)", () => {
    const { synth, player } = setup();
    player.play([chunk("prompt")]);
    player.stop(); // interrupted by a command
    assert.equal(player.state, "idle");
    assert.equal(player.play([chunk("next")]), true);
    assert.equal(synth.queue.length, 1);
  });

  it("a missing end event after stop(): the next playback works and nothing is double-reported", () => {
    const { synth, player, events } = setup();
    player.play([chunk("a")]);
    player.stop();
    player.play([chunk("b")]);
    synth.finishOne();
    assert.equal(events.filter((e) => e.type === "finished").length, 1);
    assert.equal(player.state, "idle");
  });
});
