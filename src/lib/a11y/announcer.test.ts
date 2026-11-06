import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Announcer, DEDUPE_MS, REANNOUNCE_GAP_MS } from "./announcer.ts";

function setup() {
  let clock = 0;
  const sets: string[] = [];
  const timers: Array<{ fn: () => void; at: number; id: number; live: boolean }> = [];
  let next = 1;
  const a = new Announcer({
    set: (t) => sets.push(t),
    now: () => clock,
    schedule: (fn, ms) => {
      const t = { fn, at: clock + ms, id: next++, live: true };
      timers.push(t);
      return t.id;
    },
    cancel: (h) => {
      const t = timers.find((x) => x.id === h);
      if (t) t.live = false;
    },
  });
  const advance = (ms: number) => {
    clock += ms;
    for (const t of timers) if (t.live && t.at <= clock) { t.live = false; t.fn(); }
  };
  return { a, sets, advance };
}

describe("Announcer", () => {
  it("sets a different message immediately, so it is an ordinary content change", () => {
    const { a, sets } = setup();
    assert.equal(a.announce("Photo captured."), "set");
    assert.deepEqual(sets, ["Photo captured."]);
    assert.equal(a.announce("Your answer is ready."), "set");
    assert.deepEqual(sets, ["Photo captured.", "Your answer is ready."]);
  });

  it("never announces the same message twice in quick succession", () => {
    const { a, sets, advance } = setup();
    a.announce("Paused.");
    advance(DEDUPE_MS - 1);
    assert.equal(a.announce("Paused."), "skipped");
    assert.deepEqual(sets, ["Paused."]);
  });

  it("announces the same message again later by clearing and re-setting the region", () => {
    const { a, sets, advance } = setup();
    a.announce("Paused.");
    advance(DEDUPE_MS + 10);
    assert.equal(a.announce("Paused."), "re-announced");
    assert.deepEqual(sets, ["Paused.", ""]);
    advance(REANNOUNCE_GAP_MS);
    assert.deepEqual(sets, ["Paused.", "", "Paused."]);
  });

  it("an empty message clears the region and forgets the last message", () => {
    const { a, sets } = setup();
    a.announce("Stopped reading.");
    assert.equal(a.announce(""), "cleared");
    assert.equal(a.announce("Stopped reading."), "set"); // allowed again straight away
    assert.deepEqual(sets, ["Stopped reading.", "", "Stopped reading."]);
  });

  it("a new message cancels a pending re-announcement (no stale text appears later)", () => {
    const { a, sets, advance } = setup();
    a.announce("A");
    advance(DEDUPE_MS + 10);
    a.announce("A"); // clear now, re-set in 60 ms
    a.announce("B");
    advance(500);
    assert.deepEqual(sets, ["A", "", "B"]);
  });

  it("dispose cancels a pending re-announcement", () => {
    const { a, sets, advance } = setup();
    a.announce("A");
    advance(DEDUPE_MS + 10);
    a.announce("A");
    a.dispose();
    advance(500);
    assert.deepEqual(sets, ["A", ""]);
  });

  it("trims whitespace and treats blank text as clearing", () => {
    const { a, sets } = setup();
    a.announce("  Hello  ");
    a.announce("   ");
    assert.deepEqual(sets, ["Hello", ""]);
  });
});
