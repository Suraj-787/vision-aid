// Usage: node scripts/e2e/lifecycle.e2e.mjs <base URL of a RUNNING app, e.g. http://localhost:3917> [scenario name filter]
// Needs: npm i --no-save puppeteer-core (not a project dependency) and Chrome (CHROME_PATH to override the macOS default).
// Run it against a production build: npm run build && npx next start -p 3917
import puppeteer from "puppeteer-core";
const URL_ = process.argv[2];
const CHROME = process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const must = (c, m, x = "") => { console.log(`  ${c ? "PASS" : "FAIL"} ${m}${x ? " — " + x : ""}`); if (!c) fails++; };
const answer = { intent: "scene_description", answer: "A box.", details: null, uncertainty: null, confidence: "high", printed_text: null, printed_instructions: null, currency_check: null, expiry_check: null, notices: [], adjustments: [] };

async function withPage(fn) {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", "--no-first-run"] });
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
  await page.evaluateOnNewDocument(() => {
    window.__tracks = []; window.__urls = new Set(); window.__listeners = 0;
    const md = navigator.mediaDevices; const orig = md.getUserMedia.bind(md);
    md.getUserMedia = async (c) => { window.__lastConstraints = JSON.stringify(c); const s = await orig(c); s.getTracks().forEach((t) => window.__tracks.push(t)); return s; };
    const c = URL.createObjectURL.bind(URL), r = URL.revokeObjectURL.bind(URL);
    URL.createObjectURL = (b) => { const u = c(b); window.__urls.add(u); return u; };
    URL.revokeObjectURL = (u) => { window.__urls.delete(u); return r(u); };
  });
  await page.setRequestInterception(true);
  page.on("request", (req) => { if (req.url().endsWith("/api/ask") && req.method() === "POST") req.respond({ status: 200, contentType: "application/json", body: JSON.stringify(answer) }); else req.continue(); });
  await page.goto(URL_, { waitUntil: "networkidle0" });
  const a = {
    page,
    click: (n) => page.evaluate((n) => { const b = [...document.querySelectorAll("button")].find((x) => x.textContent.trim() === n); if (!b) throw new Error("no " + n); b.click(); }, n),
    wait: (n) => page.waitForFunction((n) => [...document.querySelectorAll("button")].some((x) => x.textContent.trim() === n), { timeout: 8000 }, n),
    live: () => page.evaluate(() => window.__tracks.filter((t) => t.readyState === "live").length),
    urls: () => page.evaluate(() => window.__urls.size),
    hide: (state) => page.evaluate((s) => { Object.defineProperty(document, "visibilityState", { value: s, configurable: true }); document.dispatchEvent(new Event("visibilitychange")); }, state),
  };
  try { await fn(a); } catch (e) { must(false, "threw", e.message); }
  await browser.close();
}
const start = async (a) => { await a.click("Start camera"); await a.wait("Capture photo"); await sleep(300); };
const capture = async (a) => { await a.click("Capture photo"); await a.wait("Retake photo"); };

console.log("# camera: stop"); await withPage(async (a) => { await start(a); must((await a.live()) === 1, "one live track"); await a.click("Stop camera"); await sleep(200); must((await a.live()) === 0, "Stop camera ends every track"); });
console.log("# camera: page hidden"); await withPage(async (a) => { await start(a); await a.hide("hidden"); await sleep(300); must((await a.live()) === 0, "hidden page ends every track"); });
console.log("# camera: pagehide"); await withPage(async (a) => { await start(a); await a.page.evaluate(() => window.dispatchEvent(new Event("pagehide"))); await sleep(300); must((await a.live()) === 0, "pagehide ends every track"); });
console.log("# camera: start twice quickly"); await withPage(async (a) => { await a.page.evaluate(() => { const b = [...document.querySelectorAll("button")].find((x) => x.textContent.trim() === "Start camera"); b.click(); b.click(); }); await a.wait("Capture photo"); await sleep(300); const n = await a.page.evaluate(() => window.__tracks.length); must(n === 1, "double tap requested the camera once", String(n)); });
console.log("# camera: restart after stop (no leak)"); await withPage(async (a) => { for (let i = 0; i < 3; i++) { await start(a); await a.click("Stop camera"); await sleep(250); } must((await a.live()) === 0, "3 start/stop cycles leave no live track"); });
console.log("# object URLs"); await withPage(async (a) => {
  await start(a); await capture(a); must((await a.urls()) === 1, "one preview URL after capture");
  await a.click("Retake photo"); await sleep(200); must((await a.urls()) === 0, "Retake revokes it");
  await a.click("Capture photo"); await a.wait("Retake photo"); await a.click("Cancel"); await sleep(200); must((await a.urls()) === 0, "Cancel revokes it");
  await a.click("Capture photo"); await a.wait("Retake photo"); await a.page.evaluate(() => window.dispatchEvent(new Event("pagehide"))); await sleep(200); must((await a.urls()) === 0, "pagehide revokes it");
});
console.log("# constraints sent to getUserMedia"); await withPage(async (a) => { await start(a); console.log("   ", await a.page.evaluate(() => window.__lastConstraints)); });
console.log(fails ? `\n${fails} FAILURE(S)` : "\nALL PASSED");
