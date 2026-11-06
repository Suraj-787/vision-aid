// Usage: node scripts/e2e/ui-m8.e2e.mjs <base URL of a RUNNING app, e.g. http://localhost:3917> [scenario name filter]
// Needs: npm i --no-save puppeteer-core (not a project dependency) and Chrome (CHROME_PATH to override the macOS default).
// Run it against a production build: npm run build && npx next start -p 3917
// Browser checks for Milestone 8 (reliability, permissions, network, security headers, image pipeline).
// /api/ask and the speech engines are MOCKED; camera is Chrome's fake device. No Gemini quota is used.
// These prove the app's logic, NOT behaviour on real phones.
import puppeteer from "puppeteer-core";

const URL_ = process.argv[2];
const only = process.argv[3];
const CHROME = process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const log = [];
const must = (c, m, x = "") => { log.push(`  ${c ? "PASS" : "FAIL"} ${m}${x ? "  — " + x : ""}`); if (!c) failures++; };

const HI = "यह एक सफेद डिब्बा है।";
const V = (name, lang, localService = true) => ({ name, lang, localService, default: false, voiceURI: name });
const ALL_VOICES = [V("Veena", "en-IN"), V("Lekha", "hi-IN"), V("Soumya", "kn-IN")];

const base = {
  intent: "scene_description", answer: "I can see a white box on a table.", details: null, uncertainty: null, confidence: "high",
  printed_text: null, printed_instructions: null, currency_check: null, expiry_check: null, notices: [], adjustments: [],
};
const ok = (over = {}) => ({ status: 200, body: { ...base, ...over } });

// ---- injected into the page before any script runs
function installMocks(cfg) {
  window.__seq = [];
  window.__gum = 0;
  if (cfg.gumDeny) { navigator.mediaDevices.getUserMedia = () => { window.__gum++; return Promise.reject(new DOMException("Permission denied", "NotAllowedError")); }; }
  if (cfg.blockImageData) { CanvasRenderingContext2D.prototype.getImageData = () => { throw new DOMException("blocked", "SecurityError"); }; }
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
  const cfg = { synth: true, recog: false, voices: ALL_VOICES, pauseBroken: false, gumDeny: false, blockImageData: false, ...opts };
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
        if (p.abort) return req.abort("internetdisconnected");
        if (p.delay) await sleep(p.delay);
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
const jpegSize = (b64) => { // reads the SOF marker of a base64 JPEG
  const buf = Buffer.from(b64, "base64");
  if (buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  let i = 2;
  while (i + 9 < buf.length) {
    if (buf[i] !== 0xff) return null;
    const m = buf[i + 1];
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7), bytes: buf.length };
    i += 2 + buf.readUInt16BE(i + 2);
  }
  return null;
};

await scenario("1. Image pipeline: sharper capture, valid JPEG within the limits, quality tips never block", {}, () => ok(), async (a) => {
  await a.setup("What does it say?");
  const review = await a.page.evaluate(() => document.querySelector("#photo-heading").closest("section").innerText);
  const m = review.match(/(\d+) × (\d+) pixels, (\d+) KB/);
  must(m && Number(m[1]) <= 1280 && Number(m[1]) > 640, "photo is larger than the old 640x480 default and capped at 1280 px", m && m[0]);
  must(m && Number(m[1]) / Number(m[2]) > 1.7 && Number(m[1]) / Number(m[2]) < 1.85, "aspect ratio is kept (16:9 source stays 16:9)", m && (m[1] / m[2]).toFixed(2));
  await a.askAndWait();
  const sent = jpegSize(a.calls[0].image);
  must(sent && sent.w <= 1280 && sent.h <= 1280 && sent.bytes < 2 * 1024 * 1024, "the request carries a real JPEG within the size and dimension limits", JSON.stringify(sent));
  must(sent && sent.w === Number(m[1]) && sent.h === Number(m[2]), "the JPEG that is sent is the one that was shown for review");
});

await scenario("2. A browser that blocks canvas pixel reads still captures and asks (quality tips are advisory)", { blockImageData: true }, () => ok(), async (a) => {
  await a.setup("q");
  must(await a.has("Retake photo"), "capture succeeded although the quality analysis could not run");
  const t = await a.text();
  must(!/Photo quality tip/.test(t) && !/could not be prepared/.test(t), "no error and no invented quality warning");
  await a.askAndWait();
  must(a.calls.length === 1 && (await a.answerText()).includes("white box"), "Ask works");
});

await scenario("3. Network interruption: one request, a clear message, Try again is the user's choice", {}, ({ n }) => (n === 1 ? { abort: true } : ok({ answer: "Recovered answer." })), async (a) => {
  await a.setup("q"); await a.click("Ask");
  await a.page.waitForSelector("#failure-heading", { timeout: 8000 }); await sleep(2500);
  must(a.calls.length === 1, "no automatic retry (still exactly one request after 2.5 s)", String(a.calls.length));
  const t = (await a.text()).replace(/\s+/g, " ");
  must(/Could not get an answer/.test(t) && /connection|network|internet/i.test(t), "message explains a connection problem", t.slice(t.indexOf("Could not"), t.indexOf("Could not") + 160));
  must((await a.focusText()).startsWith("Could not get an answer"), "focus moves to the failure heading");
  must(await a.has("Try again") && await a.has("Edit question"), "recovery choices are offered");
  must(await a.has("Cancel"), "the photo can still be discarded");
  await a.click("Try again"); await a.page.waitForSelector("#answer-heading", { timeout: 8000 });
  must(a.calls.length === 2 && (await a.answerText()).includes("Recovered answer."), "Try again sends exactly one new request and shows the answer");
});

await scenario("4. Cancel while waiting, then ask again: nothing is shown for the abandoned question", {}, ({ n }) => (n === 1 ? { delay: 1500, ...ok({ answer: "OLD answer" }) } : ok({ answer: "NEW answer" })), async (a) => {
  await a.setup("first question"); await a.click("Ask");
  for (let i = 0; i < 100 && a.calls.length < 1; i++) await sleep(50);
  must(a.calls.length === 1, "the first request is in flight before Cancel is pressed");
  await a.click("Cancel"); await sleep(300);
  must(!(await a.text()).includes("Could not get an answer"), "Cancel is not an error");
  await sleep(1600);
  must(!(await a.text()).includes("OLD answer"), "the late reply to the cancelled question is never shown");
  await a.wait("Capture photo"); await a.click("Capture photo"); await a.wait("Retake photo");
  await a.page.type("#question-input", "second question"); await a.askAndWait();
  must((await a.answerText()).includes("NEW answer") && !(await a.answerText()).includes("OLD"), "the next question gets its own answer", String(await a.answerText()).slice(0, 80) + " calls=" + JSON.stringify(a.calls.map((c) => c.question)));
  must(a.calls.length === 2, "one request per question");
});

await scenario("5. Camera permission denied: explained, nothing left running, can try again", { gumDeny: true }, () => ok(), async (a) => {
  await a.click("Start camera"); await sleep(600);
  const t = (await a.text()).replace(/\s+/g, " ");
  must(/permission|allow|blocked/i.test(t), "message explains the permission problem and how to fix it", t.slice(t.search(/permission/i) - 40, t.search(/permission/i) + 120));
  must(await a.has("Start camera"), "Start camera is offered again");
  must(!(await a.page.evaluate(() => !!document.querySelector("video")?.srcObject)), "no stream is attached");
  must(a.calls.length === 0, "nothing was sent");
});

await scenario("6. Microphone/speech permission denied: explained; typing still completes the flow", { recog: true }, () => ok(), async (a) => {
  await a.setup("");
  await a.click("Start speaking (English)"); await a.wait("Stop speaking");
  await a.page.evaluate(() => window.__rec.fail("not-allowed")); await sleep(300);
  const alert = await a.page.evaluate(() => document.querySelector('[role="alert"]')?.textContent ?? "");
  must(/permission was not granted/i.test(alert) && /type your question instead/i.test(alert), "denial explained with a typing alternative", alert.slice(0, 90));
  await a.page.type("#question-input", "typed after denial"); await a.askAndWait();
  must(a.calls.length === 1 && a.calls[0].question === "typed after denial", "typed question works end to end");
});

await scenario("7. Server messages: busy, rate limit and bad reply give a recovery path, never raw text", {}, ({ n }) =>
  n === 1 ? { status: 429, body: { error: { code: "RATE_LIMITED", message: "Too many questions. Please wait a moment.", retryable: true } } }
  : n === 2 ? { status: 200, body: { answer: "old five-field format" } }
  : { status: 502, body: "<html>Bad gateway SECRET-INTERNAL</html>" }, async (a) => {
  await a.setup("q"); await a.askAndWait();
  let t = (await a.text()).replace(/\s+/g, " ");
  must(/Too many questions/.test(t) && await a.has("Try again"), "rate limit: friendly message and Try again");
  await a.click("Try again"); await a.page.waitForSelector("#failure-heading"); await sleep(200);
  t = (await a.text()).replace(/\s+/g, " ");
  must(!/old five-field format/.test(t) && /Could not get an answer/.test(t), "a reply in the wrong format is rejected, not displayed");
  await a.click("Try again"); await sleep(400);
  t = (await a.text()).replace(/\s+/g, " ");
  must(!/SECRET-INTERNAL|Bad gateway|<html>/.test(t), "an HTML error page from a proxy is never shown");
  must(a.calls.length === 3, "exactly one request per click");
});

await scenario("8. Production security headers and no policy violations during a full flow", {}, () => ok({ answer: HI }), async (a) => {
  const h = await a.page.evaluate(async () => { const r = await fetch("/", { cache: "no-store" }); return Object.fromEntries([...r.headers].filter(([k]) => /content-security|x-frame|x-content-type|referrer|permissions/.test(k))); });
  must(/connect-src 'self'/.test(h["content-security-policy"] ?? ""), "CSP restricts connections to this site", (h["content-security-policy"] ?? "").slice(0, 60));
  must(/frame-ancestors 'none'/.test(h["content-security-policy"] ?? "") && h["x-frame-options"] === "DENY", "page cannot be framed");
  must(h["x-content-type-options"] === "nosniff" && h["referrer-policy"] === "no-referrer", "nosniff and no-referrer");
  must(/camera=\(self\)/.test(h["permissions-policy"] ?? ""), "permissions policy limits camera/microphone to this site");
  const get = await a.page.evaluate(async () => { const r = await fetch("/api/live-token"); return r.status; });
  must(get === 405 || get === 404, "live-token is not a GET endpoint", String(get));
  await a.setup("यह क्या है?"); await a.pick("hi-IN"); await a.askAndWait();
  must((await a.answerText()).includes(HI), "a full camera -> photo -> answer flow works under the policy (no console errors are collected by the harness)");
  await a.click("Listen to answer"); await a.wait("Pause"); await a.click("Stop speaking");
  must(true, "speech controls work under the policy");
});

console.log(log.join("\n"));
console.log(failures === 0 ? "\nALL PASSED" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
