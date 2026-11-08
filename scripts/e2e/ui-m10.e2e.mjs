// Usage: node scripts/e2e/ui-m10.e2e.mjs <base URL of a RUNNING production build> [scenario name filter]
// Needs: npm i --no-save puppeteer-core (not a project dependency) and Chrome (CHROME_PATH to override the macOS default).
//
// Browser checks for Milestone 10: INTEGRATED voice workflows, consent, cleanup and recovery.
// /api/ask, SpeechSynthesis and SpeechRecognition are MOCKED; the camera is Chrome's fake device. A "virtual
// screen reader" records what the live regions announce and where focus goes. These prove the app's logic:
// they do NOT prove how TalkBack or VoiceOver sound or behave (that needs a real device, see the checklist).
import puppeteer from "puppeteer-core";

const URL_ = process.argv[2];
const only = process.argv[3];
const CHROME = process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const log = [];
const must = (c, m, x = "") => { log.push(`  ${c ? "PASS" : "FAIL"} ${m}${x ? "  — " + x : ""}`); if (!c) failures++; };

const V = (name, lang) => ({ name, lang, localService: true, default: false, voiceURI: name });
const ALL_VOICES = [V("Veena", "en-IN"), V("Lekha", "hi-IN"), V("Soumya", "kn-IN")];
const base = { intent: "scene_description", answer: "I can see a white box on a table.", details: null, uncertainty: null, confidence: "high", printed_text: null, printed_instructions: null, currency_check: null, expiry_check: null, notices: [], adjustments: [] };
const ok = (over = {}) => ({ status: 200, body: { ...base, ...over } });

function installMocks(cfg) {
  window.__seq = [];
  window.__gum = 0;
  if ((cfg.seedPrefs || cfg.seedRaw !== undefined) && window.name !== "seeded") {
    localStorage.setItem("visionaid.accessibility.v1", cfg.seedRaw !== undefined ? cfg.seedRaw : JSON.stringify(cfg.seedPrefs));
    window.name = "seeded";
  }
  // object URLs and camera tracks, to prove cleanup
  window.__urls = new Set(); window.__tracks = [];
  const cu = URL.createObjectURL.bind(URL), ru = URL.revokeObjectURL.bind(URL);
  URL.createObjectURL = (b) => { const u = cu(b); window.__urls.add(u); return u; };
  URL.revokeObjectURL = (u) => { window.__urls.delete(u); return ru(u); };
  const md = navigator.mediaDevices;
  if (md && md.getUserMedia) { const orig = md.getUserMedia.bind(md); md.getUserMedia = async (...a) => { window.__gum++; const st = await orig(...a); st.getTracks().forEach((t) => window.__tracks.push(t)); return st; }; }
  // ---- a virtual screen reader: live-region announcements and focus
  window.__sr = [];
  const t0 = performance.now();
  const push = (kind, text) => { text = (text || "").replace(/\s+/g, " ").trim(); if (text) window.__sr.push({ t: Math.round(performance.now() - t0), kind, text }); };
  const isLive = (el) => el.nodeType === 1 && el.matches('[role="status"],[role="alert"],[aria-live]:not([aria-live="off"])');
  document.addEventListener("DOMContentLoaded", () => {
    new MutationObserver((muts) => {
      for (const m of muts) {
        if (m.type === "childList") for (const n of m.addedNodes) {
          if (isLive(n)) push(n.getAttribute("role") || "live", n.textContent);
          else if (n.nodeType === 1) n.querySelectorAll?.('[role="alert"],[role="status"],[aria-live]').forEach((e) => push(e.getAttribute("role") || "live", e.textContent));
        }
        let el = m.target.nodeType === 1 ? m.target : m.target.parentElement;
        while (el && !isLive(el)) el = el.parentElement;
        if (el && (m.type === "characterData" || m.type === "childList")) push(el.getAttribute("role") || "live", el.textContent);
      }
    }).observe(document, { subtree: true, childList: true, characterData: true });
    document.addEventListener("focusin", (e) => { const a = e.target; push("FOCUS", `${a.tagName.toLowerCase()}#${a.id || ""}|${(a.textContent || "").trim().slice(0, 40)}`); });
  });
  // ---- recognition
  const rec = { starts: [], aborts: 0, instances: [] };
  window.__rec = rec;
  if (cfg.recog) {
    class R {
      constructor() { this.lang = ""; this.onresult = null; this.onerror = null; this.onend = null; rec.instances.push(this); }
      start() { rec.starts.push(this.lang); window.__seq.push("rec.start"); }
      stop() { setTimeout(() => this.onend?.(), 0); }
      abort() { rec.aborts++; window.__seq.push("rec.abort"); }
    }
    window.SpeechRecognition = R; window.webkitSpeechRecognition = R;
  } else { delete window.SpeechRecognition; delete window.webkitSpeechRecognition; }
  rec.say = (text) => { const i = rec.instances[rec.instances.length - 1]; i.onresult({ results: [{ isFinal: true, length: 1, 0: { transcript: text } }] }); setTimeout(() => i.onend?.(), 0); };
  rec.silence = () => { const i = rec.instances[rec.instances.length - 1]; setTimeout(() => i.onend?.(), 0); };
  rec.fail = (code) => { const i = rec.instances[rec.instances.length - 1]; i.onerror({ error: code }); i.onend?.(); };
  // ---- synthesis
  const tts = { log: [], cancels: 0, queue: [], paused: false };
  window.__tts = tts;
  if (cfg.synth) {
    class Utt { constructor(text) { this.text = text; this.lang = ""; this.voice = null; this.rate = 1; this.pitch = 1; this.volume = 1; this.onstart = null; this.onend = null; this.onerror = null; } }
    window.SpeechSynthesisUtterance = Utt;
    const synth = {
      getVoices: () => cfg.voices,
      speak(u) { tts.log.push({ text: u.text, lang: u.lang, voice: u.voice && u.voice.name }); tts.queue.push(u); window.__seq.push("speak"); },
      cancel() { tts.cancels++; window.__seq.push("cancel"); const cur = tts.queue[0]; tts.queue = []; tts.paused = false; if (cur) setTimeout(() => cur.onerror?.({ error: "canceled" }), 0); },
      pause() { tts.paused = true; }, resume() { tts.paused = false; },
      get paused() { return tts.paused; }, get speaking() { return tts.queue.length > 0; }, get pending() { return false; },
      addEventListener() {}, removeEventListener() {},
    };
    Object.defineProperty(window, "speechSynthesis", { value: synth, configurable: true });
    tts.finishCurrent = () => { const u = tts.queue.shift(); u?.onend?.(); };
  } else { delete window.speechSynthesis; delete window.SpeechSynthesisUtterance; }
}

async function scenario(name, opts, mock, fn) {
  if (only && !name.toLowerCase().includes(only.toLowerCase())) return;
  const cfg = { synth: true, recog: false, voices: ALL_VOICES, seedPrefs: null, seedRaw: undefined, ...opts };
  log.push(`\n# ${name}`);
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", "--no-first-run"] });
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  const errors = [], calls = [], reqs = [];
  page.on("console", (m) => { if (m.type() === "error" && !/^Failed to load resource/.test(m.text())) errors.push(m.text().slice(0, 160)); });
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message.slice(0, 160)));
  page.on("request", (r) => reqs.push({ method: r.method(), url: r.url() }));
  await page.evaluateOnNewDocument(installMocks, cfg);
  await page.setRequestInterception(true);
  page.on("request", (req) => {
    if (req.isInterceptResolutionHandled()) return;
    if (req.url().endsWith("/api/ask") && req.method() === "POST") {
      let body = null; try { body = JSON.parse(req.postData() ?? ""); } catch {}
      const n = calls.push(body);
      Promise.resolve(mock({ n, body })).then(async (p) => {
        if (p.abort) return req.abort("internetdisconnected");
        if (p.delay) await sleep(p.delay);
        await req.respond({ status: p.status, contentType: "application/json", body: JSON.stringify(p.body) });
      }).catch(() => {});
    } else req.continue();
  });
  await page.goto(URL_, { waitUntil: "networkidle0", timeout: 60000 });
  await sleep(400);
  const a = {
    page, calls,
    click: (n) => page.evaluate((n) => { const b = [...document.querySelectorAll("button")].find((x) => x.textContent.trim() === n); if (!b) throw new Error("no button " + n); b.focus(); b.click(); }, n),
    has: (n) => page.evaluate((n) => [...document.querySelectorAll("button")].some((x) => x.textContent.trim() === n), n),
    wait: (n, t = 8000) => page.waitForFunction((n) => [...document.querySelectorAll("button")].some((x) => x.textContent.trim() === n), { timeout: t }, n),
    disabled: (n) => page.evaluate((n) => [...document.querySelectorAll("button")].find((x) => x.textContent.trim() === n)?.getAttribute("aria-disabled") === "true", n),
    text: () => page.evaluate(() => document.body.innerText),
    live: () => page.evaluate(() => document.querySelector('.sr-only[role="status"]')?.textContent ?? ""),
    tts: () => page.evaluate(() => ({ log: window.__tts.log.slice(), cancels: window.__tts.cancels, queue: window.__tts.queue.length })),
    spoken: () => page.evaluate(() => window.__tts.log.map((x) => x.text)),
    seq: () => page.evaluate(() => window.__seq.slice()),
    rec: () => page.evaluate(() => ({ starts: window.__rec.starts.slice(), aborts: window.__rec.aborts })),
    finish: () => page.evaluate(() => window.__tts.finishCurrent()),
    /** The virtual screen reader log, with the duplicate records one DOM change produces collapsed. */
    sr: async () => { const raw = await page.evaluate(() => window.__sr.slice()); const out = []; for (const e of raw) { const last = out[out.length - 1]; if (last && last.kind === e.kind && last.text === e.text && e.t - last.t < 40) continue; out.push(e); } return out; },
    srMark: async () => (await page.evaluate(() => window.__sr.length)),
    srSince: async (mark) => { const raw = await page.evaluate((m) => window.__sr.slice(m), mark); const out = []; for (const e of raw) { const last = out[out.length - 1]; if (last && last.kind === e.kind && last.text === e.text && e.t - last.t < 40) continue; out.push(e); } return out; },
    liveTracks: () => page.evaluate(() => window.__tracks.filter((t) => t.readyState === "live").length),
    urls: () => page.evaluate(() => window.__urls.size),
    say: async (text) => { await a.click("Say a command"); await sleep(120); await page.evaluate((t) => window.__rec.say(t), text); await sleep(650); },
    cmdMsg: () => page.evaluate(() => document.querySelector('[aria-label="Voice controls"] .callout-info')?.textContent.trim() ?? ""),
    activeName: () => page.evaluate(() => document.activeElement?.textContent.trim() ?? ""),
    focusId: () => page.evaluate(() => document.activeElement?.id || document.activeElement?.tagName),
    store: () => page.evaluate(() => Object.fromEntries(Object.keys(localStorage).map((k) => [k, localStorage.getItem(k)]))),
    openSettings: () => page.evaluate(() => { document.querySelector('#a11y-heading').closest("details").open = true; }),
    chooseMode: async (mode) => { await a.openSettings(); await page.click(`input[name="interaction-mode"][value="${mode}"]`); await sleep(150); },
    setup: async (q = "What is this?") => {
      if (await a.has("Start camera")) await a.click("Start camera");
      await a.wait("Capture photo"); await sleep(400);
      await a.click("Capture photo"); await a.wait("Retake photo");
      if (q) { await page.focus("#question-input"); await page.type("#question-input", q); }
    },
    askAndWait: async () => { await a.click("Ask"); await page.waitForSelector("#answer-heading, #failure-heading", { timeout: 8000 }); await sleep(200); },
  };
  try { await fn(a); } catch (e) {
    must(false, "scenario threw", String(e.message).slice(0, 200));
    try { log.push("    DIAG: " + (await a.text()).replace(/\s+/g, " ").slice(0, 400)); } catch {}
  }
  const external = reqs.filter((r) => !/^(http:\/\/localhost|data:|blob:)/.test(r.url));
  must(external.length === 0, "no request left localhost", external.map((r) => r.url.slice(0, 50)).join(","));
  must(reqs.filter((r) => r.method === "POST").every((r) => r.url.endsWith("/api/ask")), "only POSTs are to /api/ask");
  must(errors.length === 0, "no console or page errors", errors.join(" | "));
  await browser.close();
}


const VOICE = { mode: "screen-reader", autoReadAnswers: false, voiceCommands: true, voiceAsk: false };
const ANSWER = ({ n }) => ok({ answer: "Answer number " + n });
const questionValue = (a) => a.page.$eval("#question-input", (e) => e.value);

// ------------------------------------------------------------------------------------------------ A
await scenario("A. Standard workflow (screen-reader-first, no commands)", { recog: true }, ANSWER, async (a) => {
  await a.click("Start camera"); await a.wait("Capture photo"); await sleep(500);
  await a.click("Capture photo"); await a.wait("Retake photo");
  await a.page.type("#question-input", "What is this?");
  await a.click("Ask"); await a.page.waitForSelector("#answer-heading"); await sleep(200);
  must(a.calls.length === 1 && a.calls[0].question === "What is this?", "exactly one request, with the typed question");
  must((await a.tts()).log.length === 0, "nothing spoken by itself");
  await a.click("Listen to answer"); await a.wait("Pause");
  must((await a.spoken()).some((t) => /Answer number 1/.test(t)), "Listen reads the answer on request");
  await a.click("Stop speaking"); await a.wait("Listen to answer");
  must((await a.tts()).queue === 0, "Stop speaking stops it");
  await a.click("Ask another question"); await a.page.waitForSelector("#question-input");
  must((await questionValue(a)) === "", "the new question starts empty");
  await a.page.type("#question-input", "And this?");
  await a.click("Ask"); await a.page.waitForSelector("#answer-heading"); await sleep(200);
  must(a.calls.length === 2 && (await a.page.evaluate(() => document.querySelector("#answer-heading").closest("section").innerText)).includes("Answer number 2"), "second question, second request, its own answer");
  must(Object.keys(await a.store()).length === 0, "nothing stored (no preference was changed)");
});

// ------------------------------------------------------------------------------------------------ B
await scenario("B. Voice-command workflow with Ask by voice OFF: ask never sends", { recog: true, seedPrefs: VOICE }, ANSWER, async (a) => {
  await a.click("Start camera"); await a.wait("Capture photo"); await sleep(500);
  await a.say("capture photo");
  must(await a.has("Retake photo"), "1. capture photo");
  await a.say("start speaking");
  const dictating = await a.page.evaluate(() => document.querySelector("#question-input").readOnly === true);
  must(dictating && await a.has("Stop listening"), "2. start speaking begins dictation");
  await a.page.evaluate(() => window.__rec.say("What does this label say"));
  await a.wait("Start speaking (English)"); await sleep(200);
  must((await questionValue(a)) === "What does this label say", "3. the dictated question is in the box");
  await a.say("ask");
  must(a.calls.length === 0, "4. ask with Ask by voice OFF sends nothing");
  must((await a.activeName()) === "Ask", "   focus moves to the Ask button");
  must(/Focus is on the Ask button: activate it to send/.test(await a.cmdMsg()) && /Focus is on the Ask button/.test(await a.live()), "   and it explains what the button does (on screen and announced)");
  await a.page.click("#question-input"); // focus elsewhere, then activate Ask normally
  await a.click("Ask"); await a.page.waitForSelector("#answer-heading"); await sleep(200);
  must(a.calls.length === 1, "5. activating Ask normally sends exactly one request");
  await a.say("repeat answer");
  must((await a.spoken()).some((t) => /Answer number 1/.test(t)), "6. repeat answer reads the answer");
  await a.say("done");
  must(await a.has("Capture photo") && !(await a.page.evaluate(() => !!document.querySelector("#answer-heading"))), "7. done returns to a fresh capture state");
  await a.say("capture photo");
  must(await a.has("Retake photo") && (await questionValue(a)) === "", "8. a new capture starts with an empty question");
  must(a.calls.length === 1, "no extra request anywhere in the workflow");
});

// ------------------------------------------------------------------------------------------------ C
await scenario("C. Ask by voice ON: exactly one request, even with duplicated recognition events", { recog: true, seedPrefs: { ...VOICE, voiceAsk: true } }, ANSWER, async (a) => {
  await a.click("Start camera"); await a.wait("Capture photo"); await sleep(500);
  await a.click("Capture photo"); await a.wait("Retake photo");
  await a.say("start speaking");
  await a.page.evaluate(() => window.__rec.say("Is this expired"));
  await a.wait("Start speaking (English)"); await sleep(200);
  await a.click("Say a command"); await sleep(120);
  // the browser delivers the same final result and end twice, and a late third time
  await a.page.evaluate(() => { window.__rec.say("ask"); window.__rec.say("ask"); setTimeout(() => window.__rec.say("ask"), 50); });
  await a.page.waitForSelector("#answer-heading", { timeout: 8000 }); await sleep(800);
  must(a.calls.length === 1, "exactly one Gemini request", String(a.calls.length));
  must(a.calls[0].question === "Is this expired", "with the dictated question");
  must((await a.page.evaluate(() => document.querySelector("#answer-heading").closest("section").innerText)).includes("Answer number 1"), "and one answer is shown");
  await a.say("ask");
  must(a.calls.length === 1 && /already sent/.test(await a.cmdMsg()), "saying ask again does not send again, and says why", await a.cmdMsg());
});

await scenario("C2. Ask by voice ON while a request is already in flight", { recog: true, seedPrefs: { ...VOICE, voiceAsk: true } }, () => ({ delay: 1500, ...ok({ answer: "Slow answer" }) }), async (a) => {
  await a.setup("q");
  await a.say("ask");
  must(a.calls.length === 1, "the request was sent");
  await a.say("ask");
  must(a.calls.length === 1 && /already being sent/.test(await a.cmdMsg()), "ask during sending does not send a second request, and says why", await a.cmdMsg());
  await a.page.waitForSelector("#answer-heading", { timeout: 8000 });
  must(a.calls.length === 1, "still one request");
});

// ------------------------------------------------------------------------------------------------ D
await scenario("D. Voice-guided: interrupt a prompt, run a command, recover from a lost completion event", { recog: true, seedPrefs: { mode: "voice-guided", autoReadAnswers: false, voiceCommands: true, voiceAsk: false } }, ANSWER, async (a) => {
  await a.click("Start camera"); await a.wait("Capture photo"); await sleep(500);
  must((await a.tts()).queue === 1 && (await a.spoken()).some((t) => /Camera is ready/.test(t)), "a prompt (camera ready) is playing");
  await a.page.evaluate(() => { window.__seq.length = 0; });
  await a.say("capture photo"); // interrupts the prompt
  const seq = await a.seq();
  must(seq.indexOf("cancel") !== -1 && seq.indexOf("cancel") < seq.indexOf("rec.start"), "the tap interrupted the prompt BEFORE the microphone started", seq.join(","));
  must(await a.has("Retake photo"), "the command ran");
  await a.say("retake photo");
  must(await a.has("Capture photo") && !(await a.has("Retake photo")), "the next command also works (no stuck state)");
  await a.click("Capture photo"); await a.wait("Retake photo"); await sleep(200);
  must(!(await a.disabled("Stop VisionAid voice")), "a prompt is playing again");
  await a.page.evaluate(() => { window.__tts.queue = []; }); // its completion event never arrives
  await sleep(3200);
  must(await a.disabled("Stop VisionAid voice"), "the controls recovered by themselves");
  must(!(await a.disabled("Say a command")), "Say a command was never blocked");
  await a.say("start speaking");
  await a.page.evaluate(() => { for (let i = 0; i < 4; i++) window.__tts.finishCurrent(); });
  await sleep(300);
  must(await a.has("Stop listening") || (await a.rec()).starts.length >= 3, "and the next operation (dictation) starts normally");
});

await scenario("D2. Legitimate speech is never cut short by the recovery timer", { seedPrefs: { mode: "screen-reader", autoReadAnswers: false, voiceCommands: false } }, ANSWER, async (a) => {
  await a.setup("q"); await a.askAndWait();
  await a.click("Listen to answer"); await a.wait("Pause");
  await sleep(5000); // the engine keeps reporting that it is speaking
  must(await a.has("Pause") && (await a.page.evaluate(() => document.body.innerText.includes("Reading the answer aloud"))), "after 5 seconds of ongoing speech it is still speaking");
  await a.page.evaluate(() => window.__tts.finishCurrent()); await sleep(200);
  must(await a.has("Listen to answer"), "it ends when the engine says it ended");
});

// ------------------------------------------------------------------------------------------------ E
await scenario("E. Done: every piece of local session data is discarded, speech stops, the camera stays on", { recog: true, seedPrefs: VOICE }, ANSWER, async (a) => {
  await a.click("Start camera"); await a.wait("Capture photo"); await sleep(500);
  await a.click("Capture photo"); await a.wait("Retake photo");
  must((await a.urls()) === 1, "the photo preview has an object URL");
  await a.page.type("#question-input", "secret question text");
  await a.click("Ask"); await a.page.waitForSelector("#answer-heading"); await sleep(200);
  await a.click("Listen to answer"); await a.wait("Pause");
  must((await a.tts()).queue === 1, "the answer is being read");
  const calls = a.calls.length;
  await a.say("done");
  must((await a.tts()).queue === 0, "speech stopped");
  must((await a.urls()) === 0, "the photo's object URL was released");
  must(await a.page.evaluate(() => !document.querySelector("#answer-heading") && !document.querySelector('img[alt^="The photo you captured"]')), "answer and photo are gone from the page");
  must(a.calls.length === calls, "no request was triggered");
  must((await a.activeName()) === "Capture photo", "focus is on Capture photo");
  must((await a.liveTracks()) === 1, "the camera is still on (one live track)");
  const said = await a.live();
  must(/discarded on this device/.test(said) && !/delet|erased|Google/i.test(said), "the announcement says only that local data was discarded (no claim about Google)", said);
  await a.click("Capture photo"); await a.wait("Retake photo");
  must((await questionValue(a)) === "", "the next question box is empty");
  must(!(await a.page.evaluate(() => document.body.innerText.includes("secret question text") || document.body.innerText.includes("Answer number 1"))), "nothing from the previous round is on the page");
  must(JSON.stringify(Object.values(await a.store())).includes("secret") === false, "nothing from it was stored");
});

await scenario("E2. Done while a request is in flight cancels it safely", { recog: true, seedPrefs: VOICE }, ({ n }) => ({ delay: 1500, ...ok({ answer: "LATE answer " + n }) }), async (a) => {
  await a.setup("q"); await a.click("Ask"); await sleep(300);
  must(a.calls.length === 1 && (await a.page.evaluate(() => !!document.querySelector("#sending-heading"))), "a request is in flight");
  await a.say("done");
  must(await a.has("Capture photo") && /request was cancelled/.test(await a.live()), "done cancelled it and said so", await a.live());
  await sleep(2000);
  must(!(await a.page.evaluate(() => document.body.innerText.includes("LATE answer"))), "the late reply is never shown");
  must(a.calls.length === 1, "no new request");
  await a.click("Capture photo"); await a.wait("Retake photo"); await a.page.type("#question-input", "next");
  await a.click("Ask"); await a.page.waitForSelector("#answer-heading", { timeout: 8000 }); await sleep(200);
  must(a.calls.length === 2 && (await a.page.evaluate(() => document.querySelector("#answer-heading").closest("section").innerText)).includes("LATE answer 2"), "a new round works at once and shows its own answer");
});

// ------------------------------------------------------------------------------------------------ F (failures)
await scenario("F1. Microphone permission denied for a command: explained, nothing stuck, typing works", { recog: true, seedPrefs: VOICE }, ANSWER, async (a) => {
  await a.click("Start camera"); await a.wait("Capture photo"); await sleep(400);
  await a.click("Say a command"); await sleep(120);
  await a.page.evaluate(() => window.__rec.fail("not-allowed")); await sleep(300);
  const alert = await a.page.evaluate(() => document.querySelector('[aria-label="Voice controls"] [role="alert"]')?.textContent ?? "");
  must(/permission was not granted/i.test(alert) && /type your question instead/i.test(alert), "a clear, visible permission message", alert.slice(0, 90));
  must(await a.has("Say a command") && !(await a.has("Stop listening")), "the command control is usable again");
  await a.click("Capture photo"); await a.wait("Retake photo"); await a.page.type("#question-input", "typed");
  await a.click("Ask"); await a.page.waitForSelector("#answer-heading"); await sleep(150);
  must(a.calls.length === 1, "the typed workflow still works");
});

await scenario("F2. No speech recognised: said on screen and announced, no action", { recog: true, seedPrefs: VOICE }, ANSWER, async (a) => {
  await a.click("Start camera"); await a.wait("Capture photo"); await sleep(400);
  await a.click("Say a command"); await sleep(120);
  await a.page.evaluate(() => window.__rec.silence()); await sleep(400);
  must(/I did not hear a command/.test(await a.cmdMsg()) && /I did not hear a command/.test(await a.live()), "visible and announced");
  must(await a.has("Capture photo"), "nothing changed");
});

await scenario("F3. Speech recognition unsupported: voice commands explain, the rest works", { recog: false, seedPrefs: VOICE }, ANSWER, async (a) => {
  must(!(await a.has("Say a command")), "no dead command button");
  must(/Voice commands need speech recognition, which this browser does not provide/.test(await a.text()), "a visible explanation instead");
  await a.setup("typed"); await a.askAndWait();
  must(a.calls.length === 1, "typing and asking still work");
});

await scenario("F4. Network loss with Ask by voice ON: failure screen, no automatic retry", { recog: true, seedPrefs: { ...VOICE, voiceAsk: true } }, () => ({ abort: true }), async (a) => {
  await a.setup("q");
  await a.say("ask");
  await a.page.waitForSelector("#failure-heading", { timeout: 8000 }); await sleep(2500);
  must(a.calls.length === 1, "one request, never retried by itself", String(a.calls.length));
  must(await a.has("Try again"), "Try again is offered");
  await a.say("ask");
  must(a.calls.length === 1 && /Try again/.test(await a.cmdMsg()), "saying ask on the failure screen does not retry; it points to Try again", await a.cmdMsg());
});

await scenario("F5. Page hidden or left while a command is being listened for: everything is released", { recog: true, seedPrefs: VOICE }, ANSWER, async (a) => {
  await a.click("Start camera"); await a.wait("Capture photo"); await sleep(400);
  await a.click("Say a command"); await sleep(120);
  await a.page.evaluate(() => { Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true }); document.dispatchEvent(new Event("visibilitychange")); }); await sleep(300);
  must((await a.rec()).aborts === 1 && (await a.has("Say a command")), "hiding the page aborts command listening");
  await a.page.evaluate(() => { Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true }); });
  must((await a.liveTracks()) === 0, "and the camera was released too");
  await a.click("Start camera"); await a.wait("Capture photo"); await sleep(400);
  await a.click("Say a command"); await sleep(120);
  await a.page.evaluate(() => window.dispatchEvent(new Event("pagehide"))); await sleep(300);
  must((await a.rec()).aborts === 2 && (await a.liveTracks()) === 0, "leaving the page aborts listening and releases the camera");
});

// ------------------------------------------------------------------------------------------------ G (consent)
for (const [label, raw] of [
  ["a string where a boolean belongs", '{"mode":"screen-reader","autoReadAnswers":false,"voiceCommands":true,"voiceAsk":"true"}'],
  ["the number 1", '{"voiceCommands":true,"voiceAsk":1}'],
  ["an array", '{"voiceCommands":true,"voiceAsk":[true]}'],
  ["unknown extra fields", '{"voiceCommands":true,"voiceAsk":false,"sendWithoutAsking":true,"consent":true}'],
  ["Ask by voice set while voice commands are off", '{"voiceCommands":false,"voiceAsk":true}'],
  ["corrupt JSON", "{not json"],
]) {
  await scenario(`G. Stored settings with ${label} never enable sending by voice`, { recog: true, seedRaw: raw }, ANSWER, async (a) => {
    const wantsCommands = /"voiceCommands":true/.test(raw);
    must((await a.has("Say a command")) === wantsCommands, wantsCommands ? "voice commands are on as stored" : "voice commands are off");
    if (wantsCommands) {
      await a.click("Start camera"); await a.wait("Capture photo"); await sleep(400);
      await a.click("Capture photo"); await a.wait("Retake photo"); await a.page.type("#question-input", "q");
      await a.say("ask");
      must(a.calls.length === 0 && (await a.activeName()) === "Ask", "ask only moves to the Ask button (nothing sent)");
    }
    await a.openSettings();
    const box = await a.page.evaluate(() => document.querySelector('input[aria-describedby="voice-ask-help"]').checked);
    must(box === false, "the Ask by voice checkbox is unchecked");
  });
}

await scenario("G2. Ask by voice: defaults, wording and screen-reader description", {}, ANSWER, async (a) => {
  await a.openSettings();
  const info = await a.page.evaluate(() => { const c = document.querySelector('input[aria-describedby="voice-ask-help"]'); return { checked: c.checked, disabled: c.disabled, name: c.closest("label").querySelector("span.font-bold").textContent, help: document.getElementById("voice-ask-help").textContent }; });
  must(!info.checked && info.disabled, "off and unavailable by default");
  must(/sends your photo and question to Google.s Gemini service at once/.test(info.help) && /no second step/.test(info.help), "the description says it sends to Google Gemini at once, with no second step");
  must(/sends straight away/.test(info.name), "the name itself says it sends straight away", info.name);
});

// ------------------------------------------------------------------------------------------------ H (state matrix)
await scenario("H. Every recognised command that cannot run is explained at every step, and changes nothing", { recog: true, seedPrefs: VOICE }, ({ n }) => (n === 1 ? ok({ answer: "Answer 1" }) : { status: 503, body: { error: { code: "UPSTREAM_UNAVAILABLE", message: "busy", retryable: true } } }), async (a) => {
  const ALL = ["capture photo", "retake photo", "start speaking", "repeat answer", "ask", "done"];
  const WORKS = { "camera-off": [], "camera-ready": ["capture photo"], photo: ["retake photo", "start speaking", "done"], ready: ["retake photo", "start speaking", "ask", "done"], answered: ["repeat answer", "done"], failed: ["done"] };
  async function refused(step) {
    for (const c of ALL.filter((x) => !WORKS[step].includes(x))) {
      const before = await a.page.evaluate(() => ({ h: document.querySelector("#session-heading").textContent, n: document.querySelectorAll("h3").length, tracks: window.__tracks.length }));
      const calls = a.calls.length;
      await a.say(c);
      const msg = await a.cmdMsg(), live = await a.live();
      must(msg.length > 20 && !/Command understood|Command not recognised/.test(msg) && live === msg, `${step}: "${c}" is explained on screen and announced`, msg.slice(0, 80));
      const after = await a.page.evaluate(() => ({ h: document.querySelector("#session-heading").textContent, n: document.querySelectorAll("h3").length, tracks: window.__tracks.length }));
      must(JSON.stringify(before) === JSON.stringify(after) && a.calls.length === calls, `${step}: "${c}" changed nothing`);
    }
  }
  await refused("camera-off");
  await a.click("Start camera"); await a.wait("Capture photo"); await sleep(500);
  await refused("camera-ready");
  await a.click("Capture photo"); await a.wait("Retake photo");
  await refused("photo");
  await a.page.type("#question-input", "q");
  await refused("ready");
  await a.click("Ask"); await a.page.waitForSelector("#answer-heading"); await sleep(200);
  await refused("answered");
  await a.click("Ask another question"); await a.page.type("#question-input", "again");
  await a.click("Ask"); await a.page.waitForSelector("#failure-heading"); await sleep(200);
  await refused("failed");
});

// ------------------------------------------------------------------------------------------------ I (mode combinations)
await scenario("I1. Voice-guided + automatic playback + Ask by voice, end to end", { recog: true, seedPrefs: { mode: "voice-guided", autoReadAnswers: true, voiceCommands: true, voiceAsk: true } }, () => ok({ answer: "Auto answer" }), async (a) => {
  await a.click("Start camera"); await a.wait("Capture photo"); await sleep(400);
  await a.click("Capture photo"); await a.wait("Retake photo");
  await a.page.type("#question-input", "q");
  await a.say("ask");
  await a.page.waitForSelector("#answer-heading", { timeout: 8000 }); await sleep(300);
  must(a.calls.length === 1, "one request");
  must((await a.spoken()).at(-1) === "Your answer is ready.", "the prompt comes first");
  for (let i = 0; i < 8; i++) await a.finish();
  await sleep(300);
  must((await a.spoken()).at(-1) === "Auto answer", "then the answer is read automatically");
  await a.click("Stop VisionAid voice"); await sleep(200);
  must((await a.tts()).queue === 0, "Stop VisionAid voice stops it");
  await a.say("repeat answer");
  must((await a.spoken()).at(-1) === "Auto answer", "repeat answer reads it again");
  await a.say("done");
  must((await a.tts()).queue === 0 && await a.has("Capture photo"), "done stops speech and returns to capture");
});

await scenario("I2. Screen-reader mode + voice commands: never speaks by itself, feedback is visible and announced", { recog: true, seedPrefs: VOICE }, ANSWER, async (a) => {
  await a.click("Start camera"); await a.wait("Capture photo"); await sleep(400);
  await a.say("capture photo"); await a.say("retake photo"); await a.say("send my photo to the doctor");
  must((await a.tts()).log.length === 0, "no speech at all");
  must(/I heard .send my photo to the doctor./.test(await a.cmdMsg()) && /I heard/.test(await a.live()), "an unrecognised phrase is shown and announced");
});

console.log(log.join("\n"));
console.log(failures === 0 ? "\nALL PASSED" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
