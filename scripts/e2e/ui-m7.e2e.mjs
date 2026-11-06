// Usage: node scripts/e2e/ui-m7.e2e.mjs <base URL of a RUNNING app, e.g. http://localhost:3917> [scenario name filter]
// Needs: npm i --no-save puppeteer-core (not a project dependency) and Chrome (CHROME_PATH to override the macOS default).
// Run it against a production build: npm run build && npx next start -p 3917
// Browser checks for Milestone 7 (voice interaction, languages) using MOCKED SpeechSynthesis and
// SpeechRecognition and a MOCKED /api/ask. No Gemini quota is used and no real speech engine is exercised:
// these prove the app's logic, NOT that Hindi/Kannada recognition or voices work on a real device.
import puppeteer from "puppeteer-core";

const URL_ = process.argv[2];
const only = process.argv[3];
const CHROME = process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const log = [];
const must = (c, m, x = "") => { log.push(`  ${c ? "PASS" : "FAIL"} ${m}${x ? "  — " + x : ""}`); if (!c) failures++; };

const HI = "यह एक सफेद डिब्बा है।";
const KN = "ಇದು ಒಂದು ಬಿಳಿ ಪೆಟ್ಟಿಗೆ.";
const V = (name, lang, localService = true) => ({ name, lang, localService, default: false, voiceURI: name });
const EN_ONLY = [V("Veena", "en-IN")];
const ALL_VOICES = [V("Veena", "en-IN"), V("Lekha", "hi-IN"), V("Soumya", "kn-IN")];

const base = {
  intent: "scene_description", answer: "I can see a white box on a table.", details: null, uncertainty: null, confidence: "high",
  printed_text: null, printed_instructions: null, currency_check: null, expiry_check: null, notices: [], adjustments: [],
};
const expiry = {
  status: "not_expired", kind: "expiry", printed_text: "EXP 08/2027", manufacturing_text: null, interpreted_as: "August 2027",
  checked_on: "2026-11-06", checked_on_source: "device",
  explanation: 'The printed expiry date "EXP 08/2027" is read as August 2027. Compared with today\'s date (6 November 2026), that date has not passed yet.',
  assumptions: [],
};
const ok = (over = {}) => ({ status: 200, body: { ...base, ...over } });

// ---- injected into the page before any script runs
function installMocks(cfg) {
  window.__seq = [];
  window.__gum = 0;
  // count camera/microphone requests
  const md = navigator.mediaDevices;
  if (md && md.getUserMedia) {
    const orig = md.getUserMedia.bind(md);
    md.getUserMedia = (...a) => { window.__gum++; return orig(...a); };
  }
  // ---- recognition
  const rec = { starts: [], instances: [] };
  window.__rec = rec;
  if (cfg.recog) {
    class R {
      constructor() { this.lang = ""; this.onresult = null; this.onerror = null; this.onend = null; rec.instances.push(this); }
      start() { rec.starts.push(this.lang); window.__seq.push("rec.start"); }
      stop() { setTimeout(() => this.onend && this.onend(), 0); }
      abort() { window.__seq.push("rec.abort"); }
    }
    window.SpeechRecognition = R; window.webkitSpeechRecognition = R;
  } else { delete window.SpeechRecognition; delete window.webkitSpeechRecognition; }
  rec.say = (text) => { const i = rec.instances[rec.instances.length - 1]; i.onresult({ results: [{ isFinal: true, length: 1, 0: { transcript: text } }] }); setTimeout(() => i.onend?.(), 0); };
  rec.fail = (code) => { const i = rec.instances[rec.instances.length - 1]; i.onerror({ error: code }); i.onend?.(); };
  // ---- synthesis
  const tts = { log: [], cancels: 0, queue: [], paused: false };
  window.__tts = tts;
  if (cfg.synth) {
    class Utt { constructor(text) { this.text = text; this.lang = ""; this.voice = null; this.rate = 1; this.pitch = 1; this.volume = 1; this.onstart = null; this.onend = null; this.onerror = null; } }
    window.SpeechSynthesisUtterance = Utt;
    const listeners = {};
    const synth = {
      getVoices: () => cfg.voices,
      speak(u) { tts.log.push({ text: u.text, lang: u.lang, voice: u.voice && u.voice.name }); tts.queue.push(u); window.__seq.push("speak"); },
      cancel() { tts.cancels++; window.__seq.push("cancel"); const cur = tts.queue[0]; tts.queue = []; tts.paused = false; if (cur) setTimeout(() => cur.onerror && cur.onerror({ error: "canceled" }), 0); },
      pause() { if (!cfg.pauseBroken) tts.paused = true; },
      resume() { tts.paused = false; },
      get paused() { return tts.paused; },
      get speaking() { return tts.queue.length > 0; },
      addEventListener(t, f) { (listeners[t] ||= []).push(f); },
      removeEventListener(t, f) { listeners[t] = (listeners[t] || []).filter((x) => x !== f); },
    };
    Object.defineProperty(window, "speechSynthesis", { value: synth, configurable: true });
    tts.finishCurrent = () => { const u = tts.queue.shift(); if (u && u.onend) u.onend(); };
    tts.failCurrent = (code) => { const u = tts.queue[0]; if (u && u.onerror) u.onerror({ error: code }); };
  } else {
    delete window.speechSynthesis; delete window.SpeechSynthesisUtterance;
  }
}

async function scenario(name, opts, mock, fn) {
  if (only && !name.toLowerCase().includes(only.toLowerCase())) return;
  const cfg = { synth: true, recog: false, voices: ALL_VOICES, pauseBroken: false, ...opts };
  log.push(`\n# ${name}`);
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", "--no-first-run"] });
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
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
        await req.respond({ status: p.status, contentType: "application/json", body: JSON.stringify(p.body) });
      }).catch(() => {});
    } else req.continue();
  });
  await page.goto(URL_, { waitUntil: "networkidle0", timeout: 60000 });
  await sleep(500);
  const a = {
    page, calls,
    click: (n) => page.evaluate((n) => { const b = [...document.querySelectorAll("button")].find((x) => x.textContent.trim() === n); if (!b) throw new Error("no button " + n); b.click(); }, n),
    clickTwice: (n) => page.evaluate((n) => { const b = [...document.querySelectorAll("button")].find((x) => x.textContent.trim() === n); b.click(); b.click(); }, n),
    has: (n) => page.evaluate((n) => [...document.querySelectorAll("button")].some((x) => x.textContent.trim() === n), n),
    wait: (n, t = 8000) => page.waitForFunction((n) => [...document.querySelectorAll("button")].some((x) => x.textContent.trim() === n), { timeout: t }, n),
    waitGone: (n, t = 8000) => page.waitForFunction((n) => ![...document.querySelectorAll("button")].some((x) => x.textContent.trim() === n), { timeout: t }, n),
    disabled: (n) => page.evaluate((n) => [...document.querySelectorAll("button")].find((x) => x.textContent.trim() === n)?.getAttribute("aria-disabled") === "true", n),
    text: () => page.evaluate(() => document.body.innerText),
    answerText: () => page.evaluate(() => document.querySelector("#answer-heading")?.closest("section")?.innerText ?? null),
    tts: () => page.evaluate(() => ({ log: window.__tts.log.slice(), cancels: window.__tts.cancels, queue: window.__tts.queue.length, paused: window.__tts.paused })),
    seq: () => page.evaluate(() => window.__seq.slice()),
    live: () => page.evaluate(() => document.querySelector('.sr-only[role="status"]')?.textContent ?? ""),
    focusText: () => page.evaluate(() => document.activeElement?.textContent?.trim() ?? document.activeElement?.id),
    pick: (lang) => page.select("#app-language", lang),
    setup: async (q = "What is this?") => {
      if (await a.has("Start camera")) await a.click("Start camera");
      await a.wait("Capture photo"); await sleep(400);
      await a.click("Capture photo"); await a.wait("Retake photo");
      await page.focus("#question-input"); await page.type("#question-input", q);
    },
    askAndWait: async () => { await a.click("Ask"); await page.waitForSelector("#answer-heading, #failure-heading", { timeout: 8000 }); await sleep(150); },
  };
  try { await fn(a); } catch (e) {
    must(false, "scenario threw", String(e.message).slice(0, 200));
    try { log.push("    DIAG: " + (await a.text()).replace(/\s+/g, " ").slice(600, 1300)); } catch {}
  }
  const store = await page.evaluate(() => ({ l: localStorage.length, s: sessionStorage.length })).catch(() => ({ l: -1, s: -1 }));
  must(store.l === 0 && store.s === 0, "nothing is written to localStorage or sessionStorage", JSON.stringify(store));
  const external = reqs.filter((r) => !/^(http:\/\/localhost|data:|blob:)/.test(r.url));
  must(external.length === 0, "no request left localhost", external.map((r) => r.url.slice(0, 50)).join(","));
  must(reqs.filter((r) => r.method === "POST").every((r) => r.url.endsWith("/api/ask")), "only POSTs are to /api/ask");
  must(errors.length === 0, "no console or page errors", errors.join(" | "));
  await browser.close();
}

// ---------------------------------------------------------------------------------------------
await scenario("1. Listen, Pause, Resume, Stop, finish; never auto-plays; one utterance at a time", {}, () => ok({
  intent: "expiry_date", answer: 'The printed expiry date "EXP 08/2027" has not passed yet.', uncertainty: "The corner is a little blurry.",
  expiry_check: expiry, notices: ["expiry_limits"], confidence: "medium", adjustments: ["navigation_claim_removed"], details: "DETAILS-SHOULD-NOT-BE-SPOKEN",
  printed_text: "PRINTED-SHOULD-NOT-BE-SPOKEN",
}), async (a) => {
  must((await a.page.evaluate(() => window.__gum)) === 0, "no camera or microphone request on load");
  await a.setup(); await a.askAndWait();
  let t = await a.tts();
  must(t.log.length === 0 && t.queue === 0, "nothing is spoken when the answer appears (no auto-play)");
  must(await a.has("Listen to answer") && await a.has("Stop speaking"), "Listen to answer and Stop speaking are offered");
  must(await a.disabled("Stop speaking"), "Stop speaking is disabled while nothing is playing");
  await a.page.evaluate(() => [...document.querySelectorAll("button")].find((x) => x.textContent.trim() === "Listen to answer").focus());
  await a.click("Listen to answer"); await a.wait("Pause");
  t = await a.tts();
  const spokenAll = t.log.map((x) => x.text).join(" | ");
  must(t.log.length >= 1, "speech started after the tap", spokenAll.slice(0, 80));
  must(spokenAll.includes("has not passed yet") && spokenAll.includes("The corner is a little blurry"), "answer and uncertainty are spoken");
  must(!/DETAILS-SHOULD|PRINTED-SHOULD|Confidence|Understood as|medium|expiry_date|navigation_claim|Ask another|Changes VisionAid/.test(spokenAll), "no metadata, confidence, intent, details, printed text or UI text is spoken");
  must(t.log.every((x) => x.lang === "en-IN" && x.voice === "Veena"), "English is read with the en-IN voice");
  must((await a.text()).includes("Reading the answer aloud"), "state is written as text, not only by button label");
  must((await a.focusText()) === "Pause", "keyboard focus stays on the same button as it changes (Pause)", await a.focusText());
  must(!(await a.has("Listen to answer")), "no second Listen button while playing");
  await a.click("Pause"); await a.wait("Resume"); t = await a.tts();
  must(t.paused === true, "Pause paused the engine");
  must((await a.text()).includes("Paused") && (await a.live()) === "Paused.", "paused state is shown and announced", await a.live());
  await a.click("Resume"); await a.wait("Pause"); t = await a.tts();
  must(t.paused === false, "Resume resumed the engine");
  must((await a.live()) === "Resumed.", "resume announced", await a.live());
  await a.click("Stop speaking"); await a.wait("Listen to answer"); t = await a.tts();
  must(t.queue === 0 && t.cancels >= 1, "Stop speaking cleared everything queued");
  must((await a.live()) === "Stopped reading.", "stop announced", await a.live());
  must(!(await a.text()).includes("Something went wrong") && !(await a.page.evaluate(() => !!document.querySelector('[role="alert"]'))), "the engine's own 'canceled' event is not shown as an error");
  // finish naturally
  await a.click("Listen to answer"); await a.wait("Pause");
  const n = (await a.tts()).queue;
  for (let i = 0; i < n; i++) await a.page.evaluate(() => window.__tts.finishCurrent());
  await a.wait("Listen to answer");
  must((await a.live()) === "Finished reading the answer.", "end of answer announced", await a.live());
  // rapid double activation
  await a.clickTwice("Listen to answer"); await a.wait("Pause");
  t = await a.tts();
  const perPlay = spokenAll.split(" | ").length;
  must(t.log.length === perPlay * 3, "a double tap started only ONE playback", `${t.log.length} utterances, ${perPlay} per playback`);
});

await scenario("2. A new question, Done, Retake and leaving the page stop speech; the next answer is never auto-played", {}, ({ n }) =>
  ok({ answer: n === 1 ? "FIRST answer about a box." : "SECOND answer about a cup." }), async (a) => {
  await a.setup(); await a.askAndWait();
  await a.click("Listen to answer"); await a.wait("Pause");
  let t = await a.tts(); const c0 = t.cancels;
  await a.click("Ask another question"); await a.page.waitForSelector("#question-input");
  t = await a.tts();
  must(t.queue === 0 && t.cancels > c0, "Ask another question stops the speech", `queue ${t.queue}, cancels ${t.cancels}`);
  await a.page.type("#question-input", "And now?"); await a.askAndWait();
  t = await a.tts(); const spoken1 = t.log.length;
  must(t.queue === 0, "the second answer is NOT spoken automatically");
  must((await a.answerText()).includes("SECOND answer"), "second answer shown");
  await a.click("Listen to answer"); await a.wait("Pause"); t = await a.tts();
  const newOnes = t.log.slice(spoken1).map((x) => x.text).join(" ");
  must(newOnes.includes("SECOND answer") && !newOnes.includes("FIRST"), "only the new answer is read", newOnes.slice(0, 60));
  // Done
  const c1 = (await a.tts()).cancels;
  await a.click("Done"); await sleep(200); t = await a.tts();
  must(t.queue === 0 && t.cancels > c1, "Done (cancel) stops speech");
  must(!(await a.has("Listen to answer")), "no read-aloud controls remain once the answer is gone");
});

await scenario("3. Retake, page hidden and pagehide stop speech", {}, () => ok(), async (a) => {
  await a.setup(); await a.askAndWait();
  await a.click("Listen to answer"); await a.wait("Pause");
  await a.click("Retake photo"); await sleep(200);
  let t = await a.tts();
  must(t.queue === 0, "Retake photo stops speech");
  await a.page.evaluate(() => document.querySelector("video") && 0);
  // new capture to get an answer again (camera still on)
  await a.wait("Capture photo"); await a.click("Capture photo"); await a.wait("Retake photo");
  await a.page.type("#question-input", "again"); await a.askAndWait();
  await a.click("Listen to answer"); await a.wait("Pause");
  await a.page.evaluate(() => { Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true }); document.dispatchEvent(new Event("visibilitychange")); });
  await sleep(200); t = await a.tts();
  must(t.queue === 0, "the page being hidden (e.g. screen lock, tab switch) stops speech");
  await a.page.evaluate(() => { Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true }); document.dispatchEvent(new Event("visibilitychange")); });
});

await scenario("3b. pagehide stops speech", {}, () => ok(), async (a) => {
  await a.setup(); await a.askAndWait();
  await a.click("Listen to answer"); await a.wait("Pause");
  await a.page.evaluate(() => window.dispatchEvent(new Event("pagehide")));
  await sleep(200);
  must((await a.tts()).queue === 0, "leaving the page stops speech");
});

await scenario("4. Browser without speech synthesis: text only, clear message", { synth: false }, () => ok(), async (a) => {
  const t0 = await a.text();
  must(/Reading aloud in English: Not available: Spoken answers are not available in this browser/.test(t0.replace(/\s+/g, " ")), "language area says reading aloud is unavailable");
  await a.setup(); await a.askAndWait();
  const t = await a.answerText();
  must(t.includes("I can see a white box on a table."), "the answer is shown as text");
  must(t.includes("Reading aloud is not available in this browser. The answer is shown as text."), "message shown with the answer");
  must(!(await a.has("Listen to answer")), "no dead Listen button");
});

await scenario("5. Hindi chosen but no Hindi voice: told clearly, never read in the wrong voice", { voices: EN_ONLY, recog: true }, () => ok({ answer: HI, expiry_check: expiry, intent: "expiry_date", notices: ["expiry_limits"] }), async (a) => {
  await a.pick("hi-IN"); await sleep(100);
  let t = (await a.text()).replace(/\s+/g, " ");
  must(/Reading aloud in Hindi: Not available: No Hindi voice is installed on this device/.test(t), "selector says no Hindi voice is installed, in words");
  must(t.includes("Your browser decides whether it understands Hindi"), "selector does not promise Hindi recognition");
  await a.setup("यह क्या है?"); await a.askAndWait();
  must(a.calls[0].response_language === "hi-IN", "the request carries response_language hi-IN", String(a.calls[0].response_language));
  await a.click("Listen to answer"); await sleep(300);
  const s = await a.tts();
  must(s.log.length >= 1 && s.log.every((x) => x.lang === "en-IN" && x.voice === "Veena"), "only the English part is spoken, with the English voice");
  must(!s.log.some((x) => x.text.includes("डिब्बा")), "Hindi text is never given to an English voice");
  const ans = (await a.answerText()).replace(/\s+/g, " ");
  must(ans.includes(HI), "the Hindi answer is still shown as text");
  must(/No Hindi voice is installed on this device, so the Hindi part of this answer is not read aloud/.test(ans), "the user is told which part was not read", ans.slice(-200));
});

await scenario("5b. Only Hindi text and no Hindi voice: error with a recovery path, no speech", { voices: EN_ONLY }, () => ok({ answer: HI }), async (a) => {
  await a.pick("hi-IN"); await a.setup("क्या है?"); await a.askAndWait();
  await a.click("Listen to answer"); await sleep(300);
  must((await a.tts()).log.length === 0, "nothing was spoken");
  const alert = await a.page.evaluate(() => document.querySelector('[role="alert"]')?.textContent ?? "");
  must(/No Hindi voice is installed/.test(alert) && /shown as text/.test(alert), "an alert explains and says the text is shown", alert.slice(0, 120));
  must(await a.has("Listen to answer"), "controls are back to idle");
});

await scenario("6. Language switching: voice per language, request language, honest mismatch notes", {}, ({ body }) =>
  body.response_language === "kn-IN" ? ok({ answer: KN, printed_text: "ಪ್ಯಾರಾಸಿಟಮಾಲ್ 500" })
  : body.response_language === "hi-IN" ? ok({ answer: "I can see a white box." }) : ok(), async (a) => {
  const labels = await a.page.evaluate(() => [...document.querySelectorAll("#app-language option")].map((o) => `${o.value}|${o.textContent}|${o.lang}`));
  must(labels.join() === "en-IN|English (India)|en,hi-IN|हिन्दी (Hindi)|hi,kn-IN|ಕನ್ನಡ (Kannada)|kn", "selector lists exactly English, Hindi, Kannada with language attributes", labels.join());
  must((await a.page.evaluate(() => document.querySelector('label[for="app-language"]')?.textContent ?? "")).includes("Language"), "selector has a visible label");
  for (const [lang, name, voice] of [["hi-IN", "Hindi", "Lekha"], ["kn-IN", "Kannada", "Soumya"], ["en-IN", "English", "Veena"]]) {
    await a.pick(lang); await sleep(80);
    const t = (await a.text()).replace(/\s+/g, " ");
    must(t.includes(`Reading aloud in ${name}: Available: A ${name} voice is available (${voice})`), `${name}: voice availability stated in words`);
  }
  // Kannada request -> Kannada answer -> Kannada voice
  await a.pick("kn-IN"); await a.setup("ಇದು ಏನು?"); await a.askAndWait();
  must(a.calls[0].response_language === "kn-IN", "Kannada request carries response_language kn-IN");
  must((await a.page.evaluate(() => document.querySelector("#answer-heading").closest("section").querySelector("p").lang)) === "kn", "answer paragraph is marked lang=kn for screen readers");
  const printed = await a.page.evaluate(() => [...document.querySelectorAll("p")].find((p) => p.textContent.includes("ಪ್ಯಾರಾಸಿಟಮಾಲ್"))?.lang);
  must(printed === "kn" && (await a.answerText()).includes("ಪ್ಯಾರಾಸಿಟಮಾಲ್ 500"), "printed Kannada text is shown unchanged and marked lang=kn");
  await a.click("Listen to answer"); await sleep(200);
  let s = await a.tts();
  must(s.log.length >= 1 && s.log.every((x) => x.lang === "kn-IN" && x.voice === "Soumya"), "Kannada answer is read with the Kannada voice", JSON.stringify(s.log.map((x) => x.voice)));
  must(!s.log.some((x) => x.text.includes("ಪ್ಯಾರಾಸಿಟಮಾಲ್")), "printed text is not read as part of the answer");
  await a.click("Stop speaking"); await a.wait("Listen to answer");
  // Hindi requested but the model answered in English
  await a.click("Ask another question"); await a.page.waitForSelector("#question-input");
  await a.pick("hi-IN"); await a.page.type("#question-input", "यह क्या है?"); await a.askAndWait();
  must(a.calls[1].response_language === "hi-IN", "second request carries hi-IN");
  const at = (await a.answerText()).replace(/\s+/g, " ");
  must(/You asked for Hindi, but this answer is mostly in English\. VisionAid does not translate answers itself\./.test(at), "mismatch is stated, nothing pretends to be translated");
  const before = (await a.tts()).log.length;
  await a.click("Listen to answer"); await sleep(200);
  s = await a.tts();
  must(s.log.slice(before).every((x) => x.voice === "Veena"), "the English answer is read with the English voice, not the Hindi one");
});

await scenario("7. Speech recognition language, typed fallback, duplicate taps, ordering with synthesis", { recog: true }, ({ n }) => ok({ answer: "Answer " + n }), async (a) => {
  must((await a.page.evaluate(() => window.__rec.starts.length)) === 0, "recognition has not started on load (no microphone use)");
  await a.setup("typed question");
  must(await a.has("Start speaking (English)"), "Start speaking names the language");
  for (const [lang, name] of [["en-IN", "English"], ["hi-IN", "Hindi"], ["kn-IN", "Kannada"]]) {
    await a.pick(lang); await sleep(60);
    await a.clickTwice(`Start speaking (${name})`); await a.wait("Stop speaking");
    const starts = await a.page.evaluate(() => window.__rec.starts.slice());
    must(starts[starts.length - 1] === lang, `${name}: recognition language is set explicitly to ${lang}`, starts.join());
    must(await a.page.evaluate(() => document.querySelector("#app-language").getAttribute("aria-disabled") === "true" || document.querySelector("#app-language").disabled), "language cannot be changed while listening");
    await a.page.evaluate((t) => window.__rec.say(t), name === "English" ? "what is this" : name === "Hindi" ? "यह क्या है" : "ಇದು ಏನು");
    await a.wait(`Start speaking (${name})`);
    const q = await a.page.$eval("#question-input", (e) => e.value);
    must(q.length > 0 && q !== "typed question" || q.includes("typed"), `${name}: the recognised text lands in the editable question box`, q);
  }
  const total = await a.page.evaluate(() => window.__rec.starts.length);
  must(total === 3, "double activation started recognition only once each time", String(total));
  // recognition error: typed input still works
  await a.pick("hi-IN"); await a.click("Start speaking (Hindi)"); await a.wait("Stop speaking");
  await a.page.evaluate(() => window.__rec.fail("language-not-supported"));
  await sleep(200);
  const alert = await a.page.evaluate(() => document.querySelector('[role="alert"]')?.textContent ?? "");
  must(alert.length > 10, "a recognition error is explained", alert.slice(0, 100));
  await a.page.click("#question-input", { clickCount: 3 }); await a.page.type("#question-input", "typed instead");
  const typed = await a.page.$eval("#question-input", (e) => ({ v: e.value, ro: e.readOnly }));
  must(typed.v.endsWith("typed instead") && !typed.ro && !(await a.disabled("Ask")), "typing still works after a recognition failure", JSON.stringify(typed) + " askDisabled=" + (await a.disabled("Ask")));
  // ordering: synthesis stops before the microphone starts
  await a.pick("en-IN"); await a.askAndWait();
  await a.click("Listen to answer"); await a.wait("Pause");
  await a.click("Ask another question"); await a.page.waitForSelector("#question-input");
  await a.click("Start speaking (English)"); await a.wait("Stop speaking");
  const seq = await a.seq();
  const lastStart = seq.lastIndexOf("rec.start"), lastCancel = seq.lastIndexOf("cancel");
  must(lastCancel !== -1 && lastCancel < lastStart, "speech was cancelled before the microphone started", seq.slice(-6).join(","));
  const stillQueued = (await a.tts()).queue;
  must(stillQueued === 0, "nothing is speaking while listening");
});

await scenario("8. No recognition support: typed question always works", { recog: false }, () => ok(), async (a) => {
  await a.setup("typed only"); 
  const t = (await a.text()).replace(/\s+/g, " ");
  must(t.includes("Speech input is not available in this browser. Type your question instead."), "clear message");
  must(!(await a.has("Start speaking (English)")), "no dead microphone button");
  await a.askAndWait();
  must(a.calls.length === 1 && a.calls[0].question === "typed only", "typed question works end to end");
  must(a.calls[0].response_language === "en-IN", "default answer language en-IN is sent explicitly");
});

await scenario("9. Speech engine failures", { pauseBroken: true }, () => ok(), async (a) => {
  await a.setup(); await a.askAndWait();
  await a.click("Listen to answer"); await a.wait("Pause");
  await a.click("Pause"); await sleep(500);
  const t = (await a.text()).replace(/\s+/g, " ");
  must(/Pause is not available here/.test(t) && !(await a.has("Resume")), "a device that ignores pause says so and keeps Stop available");
  must((await a.live()).includes("Pause is not available on this device"), "announced", await a.live());
  await a.click("Stop speaking"); await a.wait("Listen to answer");
  await a.click("Listen to answer"); await a.wait("Stop speaking");
  await a.page.evaluate(() => window.__tts.failCurrent("synthesis-failed")); await sleep(200);
  const alert = await a.page.evaluate(() => document.querySelector('[role="alert"]')?.textContent ?? "");
  must(/Reading aloud stopped because of an error/.test(alert), "an engine failure is explained", alert);
  must(await a.has("Listen to answer") && (await a.answerText()).includes("I can see a white box"), "controls reset and the text stays");
  await a.click("Listen to answer"); await a.wait("Stop speaking");
  await a.page.evaluate(() => window.__tts.failCurrent("not-allowed")); await sleep(200);
  must(/did not allow speech to start. Tap Listen again/.test(await a.page.evaluate(() => document.querySelector('[role="alert"]')?.textContent ?? "")), "autoplay-policy block is explained");
});

await scenario("10. Accessibility: roles, labels, announcements, focus, tap targets", {}, () => ok({ answer: "I can see a white box." }), async (a) => {
  await a.setup(); await a.askAndWait();
  must((await a.focusText()) === "Answer", "focus moves to the answer heading, not to the read-aloud controls");
  const info = await a.page.evaluate(() => {
    const group = document.querySelector('[role="group"][aria-label="Read the answer aloud"]');
    const buttons = [...(group?.querySelectorAll("button") ?? [])].map((b) => { const r = b.getBoundingClientRect(); return { t: b.textContent.trim(), h: Math.round(r.height), w: Math.round(r.width) }; });
    const sel = document.querySelector("#app-language");
    return { group: !!group, buttons, described: sel.getAttribute("aria-describedby"), live: document.querySelectorAll('[role="status"][aria-live="polite"]').length };
  });
  must(info.group, "read-aloud controls are a labelled group");
  must(info.buttons.length === 2 && info.buttons.every((b) => b.h >= 44 && b.w >= 44), "buttons are at least 44x44 px", JSON.stringify(info.buttons));
  must(/language-help/.test(info.described) && /language-voice/.test(info.described), "language selector is described by its help and voice-availability text");
  await a.page.keyboard.press("Tab");
  let reached = false;
  for (let i = 0; i < 12 && !reached; i++) { reached = (await a.focusText()) === "Listen to answer"; if (!reached) await a.page.keyboard.press("Tab"); }
  must(reached, "Listen is reachable with the keyboard");
  await a.page.keyboard.press("Enter"); await a.wait("Pause");
  must((await a.focusText()) === "Pause", "after Enter, focus is still on that button", await a.focusText());
  await a.page.keyboard.press("Space"); await a.wait("Resume");
  must((await a.live()) === "Paused.", "keyboard Pause announced");
  must(!(await a.live()).includes("I can see"), "the answer is not announced again while the user is listening", await a.live());
});

await scenario("11. Mixed-script and multilingual printed text stays exactly as printed", {}, () => ok({
  intent: "medicine_label", answer: "I can see a medicine strip.", printed_text: "पैरासिटामोल 500 mg\n[unreadable]\nನಿರ್ದೇಶನ",
  printed_instructions: "भोजन के बाद एक गोली", notices: ["label_only"],
}), async (a) => {
  await a.setup("What does it say?"); await a.askAndWait();
  const t = await a.answerText();
  must(t.includes("पैरासिटामोल 500 mg\n[unreadable]\nನಿರ್ದೇಶನ") || t.includes("पैरासिटामोल 500 mg"), "Devanagari and Kannada printed text shown unchanged, [unreadable] kept");
  must(t.includes("भोजन के बाद एक गोली"), "printed Hindi instructions shown exactly");
  await a.click("Listen to answer"); await sleep(200);
  const spoken = (await a.tts()).log.map((x) => x.text).join(" ");
  must(!spoken.includes("पैरासिटामोल") && !spoken.includes("भोजन"), "printed text and instructions are not read as if they were the AI's answer");
});

await scenario("12. The answer follows the language the question is written in", {}, ({ body }) => ok({ answer: body.response_language === "hi-IN" ? HI : "I can see a white box." }), async (a) => {
  // English is selected (the default) but the question is typed in Hindi letters
  await a.setup("यह क्या है?"); await a.askAndWait();
  must(a.calls[0].response_language === "hi-IN", "a Hindi question is sent with response_language hi-IN although English is selected", String(a.calls[0].response_language));
  const t = (await a.answerText()).replace(/\s+/g, " ");
  must(t.includes(HI), "the Hindi answer is shown");
  must(/Your question is written in Hindi, so Hindi was requested for the answer even though English is selected/.test(t), "the interface says the language was chosen from the question");
  // English letters with English selected stay English
  await a.click("Ask another question"); await a.page.waitForSelector("#question-input");
  await a.page.type("#question-input", "What is this?"); await a.askAndWait();
  must(a.calls[1].response_language === "en-IN", "an English question with English selected stays en-IN");
  // Hindi selected + English letters = the user's explicit choice
  await a.click("Ask another question"); await a.page.waitForSelector("#question-input");
  await a.pick("hi-IN"); await a.page.type("#question-input", "What is this?"); await a.askAndWait();
  must(a.calls[2].response_language === "hi-IN", "Hindi selected with an English-letter question still requests Hindi");
});

console.log(log.join("\n"));
console.log(failures === 0 ? "\nALL PASSED" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
