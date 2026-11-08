// Usage: node scripts/e2e/ui-m9.e2e.mjs <base URL of a RUNNING production build> [scenario name filter]
// Needs: npm i --no-save puppeteer-core (not a project dependency) and Chrome (CHROME_PATH to override the macOS default).
//
// Browser checks for Milestone 9 (blind accessibility, voice guidance, voice commands).
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

const HI_VOICE_ONLY_EN = [{ name: "Veena", lang: "en-IN", localService: true, default: false, voiceURI: "Veena" }];
const V = (name, lang) => ({ name, lang, localService: true, default: false, voiceURI: name });
const ALL_VOICES = [V("Veena", "en-IN"), V("Lekha", "hi-IN"), V("Soumya", "kn-IN")];
const base = { intent: "scene_description", answer: "I can see a white box on a table.", details: null, uncertainty: null, confidence: "high", printed_text: null, printed_instructions: null, currency_check: null, expiry_check: null, notices: [], adjustments: [] };
const ok = (over = {}) => ({ status: 200, body: { ...base, ...over } });

function installMocks(cfg) {
  window.__seq = [];
  window.__gum = 0;
  if (cfg.seedPrefs && window.name !== "seeded") { localStorage.setItem("visionaid.accessibility.v1", JSON.stringify(cfg.seedPrefs)); window.name = "seeded"; }
  const md = navigator.mediaDevices;
  if (md && md.getUserMedia) { const orig = md.getUserMedia.bind(md); md.getUserMedia = (...a) => { window.__gum++; return orig(...a); }; }
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
  const cfg = { synth: true, recog: false, voices: ALL_VOICES, seedPrefs: null, ...opts };
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
      Promise.resolve(mock({ n, body })).then((p) => req.respond({ status: p.status, contentType: "application/json", body: JSON.stringify(p.body) })).catch(() => {});
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

// ----------------------------------------------------------------------------------------------------
await scenario("1. Entry: purpose, step, camera region and settings are understandable; nothing speaks or listens by itself", { recog: true }, () => ok(), async (a) => {
  const info = await a.page.evaluate(() => ({
    h1: document.querySelector("h1")?.textContent, headings: [...document.querySelectorAll("h1,h2")].map((h) => h.textContent.replace(/\s+/g, " ").trim()),
    tagline: document.querySelector("header p")?.textContent, main: !!document.querySelector("main#main"),
    group: document.querySelector('[role="group"][aria-label="Camera"]')?.getAttribute("aria-describedby"),
    help: document.getElementById("camera-help")?.textContent, videoHidden: document.querySelector("video")?.getAttribute("aria-hidden"),
    mode: document.querySelector("#a11y-heading")?.textContent.replace(/\s+/g, " ").trim(),
  }));
  must(info.h1 === "VisionAid" && /camera sees/i.test(info.tagline ?? ""), "the page has a name and a one-line purpose", `${info.h1} / ${info.tagline}`);
  must(info.headings.includes("Step 1 of 3: Take a photo"), "the current workflow step is a heading", info.headings.join(" | "));
  must(/Now: Screen reader/.test(info.mode ?? ""), "the interaction mode is stated: Screen reader (the default)", info.mode);
  must(info.group === "camera-help" && /do not need to see the preview/i.test(info.help ?? ""), "the camera region has a name and a description that says the preview need not be seen", info.help?.slice(0, 80));
  must(info.videoHidden === "true", "the video element is hidden from assistive technology (no noisy output)");
  must((await a.tts()).log.length === 0 && (await a.rec()).starts.length === 0, "no speech and no listening on page load");
  must((await a.page.evaluate(() => window.__gum)) === 0, "no camera or microphone request on load");
  must(Object.keys(await a.store()).length === 0, "nothing is stored until a preference is changed");
});

await scenario("2. Screen-reader-first flow: single announcements, predictable focus, answer NOT read automatically", { recog: true }, () => ok({ uncertainty: "The corner is blurry." }), async (a) => {
  const m0 = await a.srMark();
  await a.click("Start camera"); await a.wait("Capture photo"); await sleep(400);
  const camera = (await a.srSince(m0)).filter((e) => e.kind === "status").map((e) => e.text);
  must(camera.includes("Waiting for permission. Allow camera access when your browser asks.") && camera.some((t) => t.startsWith("Camera on. Ready to capture a photo.")), "camera states are announced in words: starting, then ready", camera.join(" | "));
  const m1 = await a.srMark();
  await a.click("Capture photo"); await a.wait("Retake photo"); await sleep(300);
  let ev = await a.srSince(m1);
  const focus1 = ev.filter((e) => e.kind === "FOCUS").map((e) => e.text);
  must(focus1[focus1.length - 1]?.startsWith("h3#photo-heading|Photo captured"), "focus moves to the Photo captured heading", focus1.join(" | "));
  const live1 = ev.filter((e) => e.kind === "status").map((e) => e.text);
  must(live1.includes("Next, type or say your question.") && !live1.some((t) => /^Photo captured/.test(t)), "the announcement adds the next step and does not repeat the heading's words", live1.join(" | "));
  await a.page.type("#question-input", "Has this expired?");
  const m2 = await a.srMark();
  await a.click("Ask"); await a.page.waitForSelector("#answer-heading"); await sleep(300);
  ev = await a.srSince(m2);
  const focus2 = ev.filter((e) => e.kind === "FOCUS").map((e) => e.text.split("|")[0]);
  must(focus2.join(",") === "button#,h3#sending-heading,h3#answer-heading", "focus is never lost: Ask, then the sending heading, then the answer heading", focus2.join(","));
  const live2 = ev.filter((e) => e.kind === "status").map((e) => e.text);
  must(live2.some((t) => t.startsWith("Your answer is ready.")), "the announcement says the answer is ready", live2.join(" | "));
  must(!live2.some((t) => /white box/.test(t)), "the answer text is NOT announced automatically");
  must((await a.tts()).log.length === 0, "no speech at all in screen-reader-first mode");
  const dup = (await a.sr()).filter((e) => e.kind === "status").map((e) => e.text).filter((t, i, all) => all.indexOf(t) !== i && t !== "Camera on. Ready to capture a photo.");
  must(dup.length === 0, "no live message was announced twice", dup.join(" | "));
  const heads = await a.page.evaluate(() => [...document.querySelectorAll("section[aria-labelledby='answer-heading'] h3, section[aria-labelledby='answer-heading'] h4")].map((h) => h.tagName + " " + h.textContent.trim()));
  must(heads[0] === "H3 Answer", "the answer has a heading to jump to", heads.join(" | "));
  const m3 = await a.srMark();
  await a.click("Ask another question"); await sleep(200);
  ev = await a.srSince(m3);
  must(ev.filter((e) => e.kind === "FOCUS").map((e) => e.text.split("|")[0]).includes("h3#question-heading"), "Ask another question moves focus to the question step (not lost)");
});

await scenario("3. Disabled buttons explain themselves; transcripts are read back; empty recognition is explained", { recog: true }, () => ok(), async (a) => {
  await a.setup("");
  const m = await a.srMark();
  await a.click("Ask"); await sleep(200);
  must((await a.srSince(m)).some((e) => e.kind === "status" && /Type or say a question/.test(e.text)), "pressing the disabled Ask says why nothing happened");
  must((await a.has("Start speaking (English)")), "dictation button is named Start speaking");
  await a.click("Start speaking (English)"); await a.wait("Stop listening");
  must(!(await a.has("Stop speaking")), "while dictating, the button is Stop listening (not the playback button's name)");
  must((await a.live()).includes("Listening. Speak your question."), "recognition start is announced once", await a.live());
  await a.page.evaluate(() => window.__rec.say("What does this label say"));
  await a.wait("Start speaking (English)"); await sleep(150);
  must((await a.live()) === "Finished listening. Your question: What does this label say. Edit it, or choose Ask.", "the recognised question is read back so it can be corrected", await a.live());
  await a.click("Start speaking (English)"); await a.wait("Stop listening");
  await a.page.evaluate(() => window.__rec.silence()); await sleep(250);
  must(/Nothing was recognised/.test(await a.live()) || /Nothing was recognised/.test((await a.srSince(0)).map((e) => e.text).join(" ")), "silence is explained with a way forward");
});

await scenario("4. Photo quality advice is spoken as advice, never as a block", {}, () => ok(), async (a) => {
  await a.page.evaluate(() => { const orig = CanvasRenderingContext2D.prototype.getImageData; CanvasRenderingContext2D.prototype.getImageData = function (...args) { const d = orig.apply(this, args); for (let i = 0; i < d.data.length; i += 4) { d.data[i] = d.data[i + 1] = d.data[i + 2] = 5; } return d; }; });
  const m = await a.srMark();
  await a.setup("q");
  const live = (await a.srSince(m)).filter((e) => e.kind === "status").map((e) => e.text);
  must(live.some((t) => /may be too dark\. You can retake the photo, or continue with your question\./.test(t)), "a dark photo is announced as advice with both options", live.join(" | "));
  must(!live.some((t) => /well framed|readable|clear photo|perfect/i.test(t)), "capture success is never described as good framing");
  await a.askAndWait();
  must(a.calls.length === 1, "the person can still ask about the photo");
});

await scenario("5. Voice-guided mode: chosen by the person, remembered, never speaks on load, one prompt per event", { recog: true }, () => ok(), async (a) => {
  await a.chooseMode("voice-guided");
  must((await a.spoken())[0]?.startsWith("Welcome to VisionAid. Voice guidance is on."), "choosing the mode speaks a short welcome (the tap is the user gesture)", (await a.spoken())[0]);
  must((await a.tts()).log[0].lang === "en-IN" && (await a.tts()).log[0].voice === "Veena", "in English, with the English voice");
  const st = await a.store();
  must(Object.keys(st).join() === "visionaid.accessibility.v1" && JSON.parse(st["visionaid.accessibility.v1"]).mode === "voice-guided", "only the preference object is stored", JSON.stringify(st));
  must(Object.keys(JSON.parse(st["visionaid.accessibility.v1"])).sort().join() === "autoReadAnswers,mode,voiceAsk,voiceCommands", "…and only its four fields, no content");
  await a.page.reload({ waitUntil: "networkidle0" }); await sleep(400);
  must((await a.tts()).log.length === 0, "after a reload the mode is remembered but nothing is spoken (no speech without a user action)");
  must(/Now: Voice guided/.test(await a.page.evaluate(() => document.querySelector("#a11y-heading").textContent)), "the remembered mode is shown");
  await a.click("Start camera"); await a.wait("Capture photo"); await sleep(500);
  let spoken = await a.spoken();
  must(spoken.filter((t) => /Camera is ready/.test(t)).length === 1, "camera ready is spoken once", spoken.join(" | "));
  await a.click("Capture photo"); await a.wait("Retake photo"); await sleep(200);
  spoken = await a.spoken();
  must(spoken[spoken.length - 1] === "Photo captured. You can now ask your question.", "photo captured + next step is one short prompt", spoken[spoken.length - 1]);
  must(spoken.filter((t) => /^Photo captured/.test(t)).length === 1, "not repeated");
  await a.page.type("#question-input", "What is this?");
  await a.click("Ask"); await a.page.waitForSelector("#answer-heading"); await sleep(300);
  spoken = await a.spoken();
  must(spoken.includes("Processing your question.") || spoken.includes("Your answer is ready."), "processing / ready are spoken", spoken.slice(-3).join(" | "));
  must(spoken[spoken.length - 1] === "Your answer is ready.", "the last prompt is Your answer is ready.");
  must(!spoken.some((t) => /white box/.test(t)), "the answer itself is NOT read automatically (the preference is off by default)");
  const prompts = spoken.filter((t) => t === "Your answer is ready.").length;
  must(prompts === 1, "Your answer is ready is spoken once", String(prompts));
});

await scenario("6. Automatic reading is optional, voice-guided only, and starts after the prompt", {}, () => ok({ answer: "A white box." }), async (a) => {
  await a.chooseMode("voice-guided");
  await a.page.evaluate(() => document.querySelector('input[type="checkbox"][aria-describedby="auto-read-help"]').click()); await sleep(100);
  must(JSON.parse((await a.store())["visionaid.accessibility.v1"]).autoReadAnswers === true, "the choice is saved");
  await a.setup("q"); await a.click("Ask"); await a.page.waitForSelector("#answer-heading"); await sleep(300);
  let spoken = await a.spoken();
  must(spoken[spoken.length - 1] === "Your answer is ready.", "the prompt comes first", spoken.slice(-2).join(" | "));
  await a.finish(); await sleep(250); // the prompt ends by itself
  spoken = await a.spoken();
  must(spoken[spoken.length - 1] === "A white box.", "then the answer is read aloud", spoken.slice(-2).join(" | "));
  must(await a.has("Pause"), "with the usual Pause and Stop controls");
});

await scenario("7. Screen-reader mode never reads automatically, even if the saved preference says so", { seedPrefs: { mode: "screen-reader", autoReadAnswers: true, voiceCommands: false } }, () => ok(), async (a) => {
  await a.setup("q"); await a.askAndWait(); await sleep(300);
  must((await a.tts()).log.length === 0, "nothing is spoken: automatic reading only applies in voice-guided mode");
  const disabled = await a.page.evaluate(() => document.querySelector('input[type="checkbox"][aria-describedby="auto-read-help"]').disabled);
  must(disabled === true, "the automatic-reading option is disabled (and says why) in screen-reader mode");
});

await scenario("8. Prompt before listening: the microphone starts only after VisionAid has finished speaking", { recog: true, seedPrefs: { mode: "voice-guided", autoReadAnswers: false, voiceCommands: false } }, () => ok(), async (a) => {
  await a.setup("");
  await a.page.evaluate(() => { window.__tts.log.length = 0; window.__seq.length = 0; });
  await a.click("Start speaking (English)"); await sleep(200);
  let spoken = await a.spoken();
  must(spoken.length === 1 && spoken[0] === "Listening. Speak your question.", "the prompt is spoken first", spoken.join(" | "));
  must((await a.rec()).starts.length === 0, "recognition has NOT started while VisionAid speaks");
  await a.click("Start speaking (English)"); await sleep(100);
  must((await a.spoken()).length === 1, "a second tap does not start a second prompt");
  await a.finish(); await sleep(250);
  must((await a.rec()).starts.length === 1, "recognition starts when the prompt has finished");
  const seq = await a.seq();
  must(seq.indexOf("speak") < seq.indexOf("rec.start"), "order: speak, then listen", seq.join(","));
  must(await a.has("Stop listening"), "the button now says Stop listening");
});

await scenario("9. Stop VisionAid voice, Escape and Stop listening act immediately and cancel pending listening", { recog: true, seedPrefs: { mode: "voice-guided", autoReadAnswers: false, voiceCommands: false } }, () => ok(), async (a) => {
  await a.setup("");
  await a.page.evaluate(() => { window.__tts.log.length = 0; });
  for (let i = 0; i < 6; i++) await a.finish(); // let the earlier prompts (camera ready, photo captured) end
  await sleep(150);
  must(await a.disabled("Stop VisionAid voice"), "the voice bar's stop button is inactive while nothing is spoken");
  await a.click("Start speaking (English)"); await sleep(150);
  must(!(await a.disabled("Stop VisionAid voice")), "…and active while VisionAid speaks");
  await a.click("Stop VisionAid voice"); await sleep(300);
  let t = await a.tts();
  must(t.queue === 0, "speech stopped at once");
  must((await a.rec()).starts.length === 0, "the pending microphone start was cancelled with it");
  await a.click("Start speaking (English)"); await sleep(150);
  await a.page.keyboard.press("Escape"); await sleep(300);
  t = await a.tts();
  must(t.queue === 0 && (await a.rec()).starts.length === 0, "Escape also stops speech and the pending listening");
  must((await a.live()) === "Speech stopped.", "and says so", await a.live());
});

await scenario("10. Hindi guidance uses the Hindi voice; with no Hindi voice nothing is spoken in another language", { seedPrefs: { mode: "voice-guided", autoReadAnswers: false, voiceCommands: false } }, () => ok(), async (a) => {
  await a.openSettings();
  await a.page.select("#pref-language", "hi-IN"); await sleep(100);
  await a.chooseMode("screen-reader"); await a.chooseMode("voice-guided"); await sleep(200);
  const spoken = (await a.tts()).log;
  const welcome = spoken.find((x) => /आपका स्वागत है/.test(x.text));
  must(!!welcome && welcome.lang === "hi-IN" && welcome.voice === "Lekha", "the Hindi welcome is read by the Hindi voice", JSON.stringify(spoken.map((x) => x.voice)));
  must(spoken.every((x) => x.voice === "Lekha"), "no prompt is read by a voice of another language");
});

await scenario("11. Missing Hindi voice: guidance is not spoken in English, the person is told, text and announcements remain", { voices: HI_VOICE_ONLY_EN, seedPrefs: { mode: "voice-guided", autoReadAnswers: false, voiceCommands: false } }, () => ok(), async (a) => {
  await a.openSettings();
  await a.page.select("#pref-language", "hi-IN"); await sleep(100);
  await a.chooseMode("screen-reader"); await a.chooseMode("voice-guided"); await sleep(200);
  must((await a.tts()).log.length === 0, "nothing was spoken (no wrong-language voice)");
  const t = (await a.text()).replace(/\s+/g, " ");
  must(/Voice guidance cannot be spoken in Hindi/.test(t) && /still announced to your screen reader/.test(t), "the person is told which language has no voice, and that announcements continue", t.slice(t.indexOf("Voice guidance cannot") , t.indexOf("Voice guidance cannot") + 140));
  await a.setup("q");
  must((await a.tts()).log.length === 0, "later prompts are not spoken in English either");
  must((await a.live()).length > 0, "the screen-reader announcements still work");
});

await scenario("12. Failed request: one alert and a focused heading, spoken guidance in voice-guided mode, no automatic retry", { seedPrefs: { mode: "voice-guided", autoReadAnswers: false, voiceCommands: false } }, () => ({ status: 503, body: { error: { code: "UPSTREAM_UNAVAILABLE", message: "The AI service is busy right now. Please try again in a moment.", retryable: true } } }), async (a) => {
  await a.setup("q");
  const m = await a.srMark();
  await a.click("Ask"); await a.page.waitForSelector("#failure-heading"); await sleep(400);
  const ev = await a.srSince(m);
  const alerts = ev.filter((e) => e.kind === "alert" || e.kind === "inserted-alert");
  must(alerts.length === 1 && /busy right now/.test(alerts[0].text), "the error is announced exactly once, as an alert", JSON.stringify(alerts.map((x) => x.text.slice(0, 40))));
  must(!ev.some((e) => e.kind === "status" && /problem/i.test(e.text)), "no extra status announcement repeats it");
  must((await a.focusId()) === "failure-heading", "focus is on the failure heading");
  must((await a.spoken()).includes("Unable to get an answer. You can try again."), "voice-guided mode says so aloud");
  await sleep(1500);
  must(a.calls.length === 1, "no automatic retry");
});

await scenario("13. Voice commands: explicit, one per tap, English, restricted by step, and never send", { recog: true, seedPrefs: { mode: "screen-reader", autoReadAnswers: false, voiceCommands: true } }, ({ n }) => ok({ answer: "Answer " + n }), async (a) => {
  must(await a.has("Say a command"), "the command button is shown because the person turned commands on");
  must((await a.rec()).starts.length === 0, "…but nothing listens until it is pressed");
  await a.click("Say a command"); await sleep(100);
  must((await a.rec()).starts.join() === "en-IN", "listening for one command uses English", (await a.rec()).starts.join());
  must(await a.has("Stop listening"), "an immediate Stop listening is offered");
  must((await a.live()) === "Listening for a command.", "start is announced", await a.live());
  await a.page.evaluate(() => window.__rec.say("retake photo")); await sleep(300);
  must(/Retake photo needs a photo first/.test(await a.live()), "a command that does not fit the step is explained, not run", await a.live());
  must(await a.has("Say a command") && !(await a.has("Stop listening")), "listening ended after one command");
  await a.click("Start camera"); await a.wait("Capture photo"); await sleep(400);
  await a.click("Say a command"); await sleep(100);
  await a.page.evaluate(() => window.__rec.say("Please capture photo")); await sleep(500);
  must(await a.has("Retake photo"), "capture photo captured a photo");
  await a.page.type("#question-input", "q");
  await a.click("Say a command"); await sleep(100);
  await a.page.evaluate(() => window.__rec.say("ask")); await sleep(300);
  must(a.calls.length === 0, "the spoken word ask does NOT send anything");
  must((await a.focusId()) !== "BODY" && (await a.page.evaluate(() => document.activeElement?.textContent.trim())) === "Ask", "it moves focus to the Ask button instead");
  must(/Ask sends your photo and question to Google Gemini/.test(await a.live()), "and says what Ask does", await a.live());
  await a.click("Say a command"); await sleep(100);
  await a.page.evaluate(() => window.__rec.say("send my photo to the doctor")); await sleep(300);
  must(/I heard .send my photo to the doctor.\. Command not recognised\. You can say: retake photo, start speaking, ask, done\./.test(await a.live()), "other speech is not treated as a command; what was heard and only the commands that work now are given", await a.live());
  must(/I heard .send my photo to the doctor./.test(await a.text()), "the same message is visible on screen (not only announced)");
  await a.click("Say a command"); await sleep(100);
  await a.page.evaluate(() => window.__rec.silence()); await sleep(300);
  must(/I did not hear a command\. Tap Say a command and try again\./.test(await a.live()) && /I did not hear a command/.test(await a.text()), "silence is explained, on screen and by announcement");
  must(a.calls.length === 0, "still nothing sent");
  await a.click("Ask"); await a.page.waitForSelector("#answer-heading"); await sleep(200);
  await a.click("Say a command"); await sleep(100);
  await a.page.evaluate(() => window.__rec.say("repeat answer")); await sleep(300);
  must((await a.spoken()).some((t) => /Answer 1/.test(t)), "repeat answer reads the answer (only available once there is one)");
  must(JSON.stringify(JSON.parse((await a.store())["visionaid.accessibility.v1"])) === JSON.stringify({ mode: "screen-reader", autoReadAnswers: false, voiceCommands: true }) && Object.keys(await a.store()).length === 1, "what was said is not stored: only the three preferences are in storage");
});

await scenario("14. Command listening is stopped by Stop listening, page hide and cancel; it never overlaps speech", { recog: true, seedPrefs: { mode: "voice-guided", autoReadAnswers: false, voiceCommands: true } }, () => ok(), async (a) => {
  await a.click("Say a command"); await sleep(100);
  await a.click("Stop listening"); await sleep(100);
  let r = await a.rec();
  must(r.aborts === 1 && (await a.has("Say a command")), "Stop listening aborts at once and runs nothing", JSON.stringify(r));
  await a.click("Say a command"); await sleep(100);
  await a.page.evaluate(() => { Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true }); document.dispatchEvent(new Event("visibilitychange")); }); await sleep(200);
  r = await a.rec();
  must(r.aborts === 2 && (await a.has("Say a command")), "hiding the page stops command listening", JSON.stringify(r));
  await a.page.evaluate(() => { Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true }); document.dispatchEvent(new Event("visibilitychange")); });
  // while VisionAid is speaking, the button is NOT blocked: the tap interrupts the speech, then listens (never both)
  await a.chooseMode("screen-reader"); await a.chooseMode("voice-guided"); await sleep(150);
  must((await a.tts()).queue === 1, "a prompt is playing");
  must(!(await a.disabled("Say a command")), "Say a command stays available while VisionAid speaks");
  await a.page.evaluate(() => { window.__seq.length = 0; });
  await a.click("Say a command"); await sleep(150);
  const seq = await a.seq();
  must((await a.tts()).queue === 0 && seq.indexOf("cancel") !== -1 && seq.indexOf("cancel") < seq.indexOf("rec.start"), "the tap stops the speech first, then starts listening: they never overlap", seq.join(","));
  must((await a.rec()).starts.length === 3 && await a.has("Stop listening"), "listening for the command started");
});

await scenario("15. Unsupported browsers: the default experience still works; settings are honest", { synth: false, recog: false, seedPrefs: { mode: "voice-guided", autoReadAnswers: true, voiceCommands: true } }, () => ok(), async (a) => {
  const t0 = (await a.text()).replace(/\s+/g, " ");
  must(/This browser cannot speak, so voice guidance is silent/.test(t0), "voice-guided without speech output says guidance is silent and that announcements continue");
  must(!(await a.has("Say a command")), "no command button when speech recognition is unsupported");
  await a.setup("typed"); await a.askAndWait();
  must(a.calls.length === 1 && (await a.page.evaluate(() => document.querySelector("#answer-heading").closest("section").innerText)).includes("white box"), "typing and reading still work end to end");
  must(/Your answer is ready\./.test(await a.live()), "the answer-ready announcement still happens");
});

await scenario("16. Settings are labelled, keyboard operable, and explain each choice", {}, () => ok(), async (a) => {
  await a.openSettings();
  const info = await a.page.evaluate(() => {
    const radios = [...document.querySelectorAll('input[name="interaction-mode"]')].map((r) => ({ v: r.value, checked: r.checked, described: document.getElementById(r.getAttribute("aria-describedby"))?.textContent.length > 40, h: Math.round(r.closest("label").getBoundingClientRect().height) }));
    const legend = document.querySelector("fieldset legend")?.textContent;
    const boxes = [...document.querySelectorAll('input[type="checkbox"]')].map((c) => ({ label: c.closest("label").textContent.trim().slice(0, 40), described: !!document.getElementById(c.getAttribute("aria-describedby")) }));
    return { radios, legend, boxes };
  });
  must(info.legend === "How should VisionAid talk to you?", "the choice is a labelled group", info.legend);
  must(info.radios.length === 2 && info.radios[0].checked && info.radios.every((r) => r.described && r.h >= 44), "two options, Screen reader selected, each described, targets at least 44 px", JSON.stringify(info.radios));
  must(info.boxes.length === 3 && info.boxes.every((b) => b.described), "each checkbox explains what it changes");
  await a.page.focus('input[name="interaction-mode"][value="screen-reader"]');
  await a.page.keyboard.press("ArrowDown"); await sleep(200);
  must((await a.page.evaluate(() => document.querySelector('input[name="interaction-mode"]:checked').value)) === "voice-guided", "the arrow keys change the mode");
  const m = await a.srMark();
  await a.chooseMode("screen-reader"); await sleep(100);
  must((await a.srSince(m)).some((e) => /Screen reader mode is on\. VisionAid will not speak by itself\./.test(e.text)), "switching back is announced");
});

for (const mode of ["screen-reader", "voice-guided"]) {
  await scenario(`17. Several commands in a row work in ${mode} mode (capture, retake, capture, start speaking)`, { recog: true, seedPrefs: { mode, autoReadAnswers: false, voiceCommands: true } }, () => ok(), async (a) => {
    await a.click("Start camera"); await a.wait("Capture photo"); await sleep(600);
    const say = async (text) => { await a.click("Say a command"); await sleep(120); await a.page.evaluate((t) => window.__rec.say(t), text); await sleep(600); };
    await say("capture photo");
    must(await a.has("Retake photo"), "1. capture photo");
    await say("retake photo");
    must(await a.has("Capture photo") && !(await a.has("Retake photo")), "2. retake photo, straight after, even while a prompt is still playing");
    await say("take photo");
    must(await a.has("Retake photo"), "3. a variant of capture works");
    const before = (await a.rec()).starts.length;
    await say("start speaking");
    if (mode === "voice-guided") {
      // the prompt is spoken first and listening starts when it has finished (the microphone never hears VisionAid)
      must((await a.spoken()).includes("Listening. Speak your question."), "(voice-guided) the Listening prompt is spoken first");
      must((await a.rec()).starts.length === before + 1, "(voice-guided) dictation has not started while the prompt plays");
      for (let i = 0; i < 6; i++) await a.finish();
      await sleep(300);
    }
    // dictation is a SECOND recognition session, started by the command: the question box is read-only and the listening text shows
    const dictating = await a.page.evaluate(() => document.querySelector("#question-input")?.readOnly === true && document.body.innerText.includes("Listening… speak your question"));
    must(dictating, "4. start speaking really begins dictation (the question step is listening)");
    const r = await a.rec();
    must(r.starts.length === before + 2, "the command listened once and then dictation started (two sessions)", JSON.stringify(r));
    await a.page.evaluate(() => window.__rec.say("What does this say"));
    await sleep(300);
    must((await a.page.$eval("#question-input", (e) => e.value)) === "What does this say", "and the spoken question lands in the question box");
    must(!(await a.text()).includes("Command not recognised"), "none was reported as not understood");
  });
}

await scenario("18. A speech engine that loses end events does not leave the controls stuck", { seedPrefs: { mode: "voice-guided", autoReadAnswers: false, voiceCommands: false } }, () => ok(), async (a) => {
  await a.click("Start camera"); await a.wait("Capture photo"); await sleep(500);
  must(!(await a.disabled("Stop VisionAid voice")), "a prompt is playing");
  await a.page.evaluate(() => { window.__tts.queue = []; }); // the engine goes quiet, but no end event is ever delivered
  await sleep(3200);
  must(await a.disabled("Stop VisionAid voice"), "the player noticed the engine went quiet and released the controls");
  must(await a.page.evaluate(() => !document.body.innerText.includes("Reading the answer aloud")), "nothing claims to be speaking");
});

await scenario("19. Done ends the conversation by voice: discards locally, returns to capture, and can be repeated", { recog: true, seedPrefs: { mode: "screen-reader", autoReadAnswers: false, voiceCommands: true } }, ({ n }) => ok({ answer: "Round " + n + " answer" }), async (a) => {
  const say = async (text) => { await a.click("Say a command"); await sleep(120); await a.page.evaluate((t) => window.__rec.say(t), text); await sleep(600); };
  await a.click("Start camera"); await a.wait("Capture photo"); await sleep(500);
  await say("done");
  must(/Done is available once you have taken a photo/.test(await a.live()), "before there is a photo, done explains itself and changes nothing", await a.live());
  must(await a.has("Capture photo"), "the camera step is untouched");
  await say("capture photo");
  must(await a.has("Retake photo"), "round 1: photo captured by voice");
  await say("I am done reading the label");
  must(await a.has("Retake photo") && /Command not recognised/.test(await a.live()), "a sentence that merely contains the word done does nothing (the whole utterance must be the command)");
  await a.page.type("#question-input", "What is this?");
  await a.askAndWait();
  must((await a.page.evaluate(() => document.querySelector("#answer-heading").closest("section").innerText)).includes("Round 1 answer"), "round 1: the answer is shown");
  const before = a.calls.length;
  await say("done");
  must(!(await a.page.evaluate(() => !!document.querySelector("#answer-heading"))), "done: the answer is gone");
  must(await a.has("Capture photo") && !(await a.has("Retake photo")), "done: back to the capture step with the camera still on");
  must(await a.page.evaluate(() => /^Camera on/.test(document.querySelector('.chip[role="status"]').textContent)), "done: the camera was not switched off");
  must(await a.page.evaluate(() => !document.querySelector('img[alt^="The photo you captured"]')), "done: the photo is discarded");
  must(/^Done\. The photo, question and answer were discarded on this device\./.test(await a.live()), "done is announced", await a.live());
  must((await a.page.evaluate(() => document.activeElement?.textContent.trim())) === "Capture photo", "focus is on Capture photo, ready for the next photo");
  must(a.calls.length === before, "done sends nothing");
  must(JSON.stringify(Object.keys(await a.store())) === JSON.stringify(["visionaid.accessibility.v1"]), "no content was stored");
  await say("capture photo");
  must(await a.has("Retake photo"), "round 2: capture photo again");
  await a.page.type("#question-input", "And this?");
  await a.askAndWait();
  must((await a.page.evaluate(() => document.querySelector("#answer-heading").closest("section").innerText)).includes("Round 2 answer") && a.calls.length === 2, "round 2: a new question gets its own answer");
  must(!(await a.page.evaluate(() => document.body.innerText.includes("Round 1"))), "nothing from round 1 is left on screen");
  await a.click("Done"); await sleep(200);
  must(await a.has("Capture photo"), "the Done button does the same thing");
});

await scenario("20. Done also works from the failure screen and after only a photo", { recog: true, seedPrefs: { mode: "screen-reader", autoReadAnswers: false, voiceCommands: true } }, () => ({ status: 503, body: { error: { code: "UPSTREAM_UNAVAILABLE", message: "The AI service is busy right now.", retryable: true } } }), async (a) => {
  const say = async (text) => { await a.click("Say a command"); await sleep(120); await a.page.evaluate((t) => window.__rec.say(t), text); await sleep(600); };
  await a.setup("q"); await a.click("Ask"); await a.page.waitForSelector("#failure-heading"); await sleep(200);
  await say("done");
  must(await a.has("Capture photo") && !(await a.page.evaluate(() => !!document.querySelector("#failure-heading"))), "done from the failure screen returns to capture");
  await a.click("Capture photo"); await a.wait("Retake photo");
  await say("done");
  must(await a.has("Capture photo") && !(await a.has("Retake photo")), "done after only a photo (no question yet) also returns to capture");
});

await scenario("21. Ask by voice (opt-in): the spoken ask sends, but only when there is a photo and a question, and never from ordinary speech", { recog: true, seedPrefs: { mode: "screen-reader", autoReadAnswers: false, voiceCommands: true, voiceAsk: true } }, ({ n }) => ok({ answer: "Voice answer " + n }), async (a) => {
  const say = async (text) => { await a.click("Say a command"); await sleep(120); await a.page.evaluate((t) => window.__rec.say(t), text); await sleep(700); };
  must(/Ask.{1,3} sends your photo and question to Google Gemini straight away/.test(await a.text()), "the voice bar says plainly that ask sends straight away");
  await a.click("Start camera"); await a.wait("Capture photo"); await sleep(500);
  await say("ask");
  must(a.calls.length === 0 && /Ask needs a photo and a question first/.test(await a.live()), "ask before there is a photo sends nothing and says why", await a.live());
  await a.click("Capture photo"); await a.wait("Retake photo");
  await say("ask");
  must(a.calls.length === 0 && /Ask needs a question first/.test(await a.live()), "ask with a photo but no question sends nothing and says a question is needed");
  await a.page.type("#question-input", "What is this?");
  await say("can you ask my doctor about this");
  must(a.calls.length === 0, "ordinary speech that contains the word ask sends nothing");
  await say("ask");
  await a.page.waitForSelector("#answer-heading", { timeout: 8000 }); await sleep(200);
  must(a.calls.length === 1 && a.calls[0].question === "What is this?", "ask sent the photo and the question, once");
  must((await a.page.evaluate(() => document.querySelector("#answer-heading").closest("section").innerText)).includes("Voice answer 1"), "and the answer is shown");
  must((await a.srSince(0)).some((e) => e.kind === "status" && /^Sending your photo and question to Google's Gemini service\. Please wait\./.test(e.text)), "the announcement says what was sent, to whom");
  await say("ask");
  must(a.calls.length === 1, "saying ask again with an answer showing sends nothing more");
  await a.click("Ask another question"); await a.page.type("#question-input", "And this?");
  await say("send it");
  await a.page.waitForSelector("#answer-heading"); await sleep(200);
  must(a.calls.length === 2, "send it also works");
  must(JSON.parse((await a.store())["visionaid.accessibility.v1"]).voiceAsk === true && !/Voice answer|What is this/.test(JSON.stringify(await a.store())), "storage holds the preference only, no content");
});

await scenario("22. Ask by voice is off by default, needs voice commands, is plainly worded, and is remembered only when chosen", { recog: true }, () => ok(), async (a) => {
  await a.openSettings();
  const box = () => a.page.evaluate(() => { const c = document.querySelector('input[aria-describedby="voice-ask-help"]'); return { checked: c.checked, disabled: c.disabled, help: document.getElementById("voice-ask-help").textContent }; });
  let b = await box();
  must(!b.checked && b.disabled, "off by default, and unavailable while voice commands are off", JSON.stringify({ c: b.checked, d: b.disabled }));
  must(/Turn on Voice commands first/.test(b.help) && /sends your photo and question to Google.s Gemini service at once/.test(b.help), "the help text says it sends to Google Gemini at once");
  await a.page.evaluate(() => document.querySelector('input[aria-describedby="commands-help"]').click()); await sleep(150);
  b = await box();
  must(!b.checked && !b.disabled, "turning voice commands on makes it available, still off");
  must(/When off, it only moves to the Ask button and you send it yourself/.test(b.help), "and explains the off behaviour");
  const m = await a.srMark();
  await a.page.evaluate(() => document.querySelector('input[aria-describedby="voice-ask-help"]').click()); await sleep(200);
  must((await a.srSince(m)).some((e) => /Ask by voice is on\. Saying ask will send your photo and question to Google Gemini straight away\./.test(e.text)), "turning it on is announced with what it does");
  must(JSON.parse((await a.store())["visionaid.accessibility.v1"]).voiceAsk === true, "the choice is saved");
  await a.page.evaluate(() => document.querySelector('input[aria-describedby="commands-help"]').click()); await sleep(150);
  b = await box();
  must(b.disabled, "turning voice commands off makes ask-by-voice inactive again (it cannot send without commands)");
});

console.log(log.join("\n"));
console.log(failures === 0 ? "\nALL PASSED" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
