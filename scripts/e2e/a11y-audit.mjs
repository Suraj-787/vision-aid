// Usage: node scripts/e2e/a11y-audit.mjs <base URL>   (axe-core + layout + focus audit in light/dark and 390/320 px)
// Needs: npm i --no-save puppeteer-core axe-core (not project dependencies).
import puppeteer from "puppeteer-core";
import fs from "node:fs";
import { createRequire } from "node:module";
const URL_ = process.argv[2];
const CHROME = process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const axeSrc = fs.readFileSync(createRequire(import.meta.url).resolve("axe-core/axe.min.js"), "utf8");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const answer = { intent: "expiry_date", answer: 'The printed expiry date "EXP 08/2027" has not passed yet.', details: "More details here.", uncertainty: "The corner is blurry.", confidence: "medium",
  printed_text: "EXP 08/2027", printed_instructions: null, currency_check: { status: "identified", denomination: 500, evidence: "numeral", message: "This looks like a ₹500 note." },
  expiry_check: { status: "not_expired", kind: "expiry", printed_text: "EXP 08/2027", manufacturing_text: "MFG 02/2026", interpreted_as: "August 2027", checked_on: "2026-11-06", checked_on_source: "device", explanation: "x has not passed yet.", assumptions: ["a"] },
  notices: ["expiry_limits", "currency_limits"], adjustments: ["navigation_claim_removed"] };

async function run(scheme, width, zoom = false, reduceMotion = false, prefs = null) {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", "--no-first-run"] });
  const page = await browser.newPage();
  await page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: scheme }, { name: "prefers-reduced-motion", value: reduceMotion ? "reduce" : "no-preference" }]);
  await page.setViewport({ width, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  let mode = "ok";
  if (prefs) await page.evaluateOnNewDocument((p) => { localStorage.setItem("visionaid.accessibility.v1", JSON.stringify(p)); }, prefs);
  await page.setRequestInterception(true);
  page.on("request", (req) => {
    if (req.url().endsWith("/api/ask") && req.method() === "POST") {
      if (mode === "fail") return req.respond({ status: 503, contentType: "application/json", body: JSON.stringify({ error: { code: "UPSTREAM_UNAVAILABLE", message: "The AI service is busy. Try again.", retryable: true } }) });
      return req.respond({ status: 200, contentType: "application/json", body: JSON.stringify(answer) });
    }
    req.continue();
  });
  await page.goto(URL_, { waitUntil: "networkidle0" });
  await page.evaluate(axeSrc);
  if (zoom) await page.addStyleTag({ content: "html { font-size: 225% !important; }" }); // 200% text enlargement on top of the 112.5% base
  const out = { scheme, width, zoom, reduceMotion, states: {} };
  const axe = async (name) => {
    const r = await page.evaluate(async () => { const r = await axe.run(document, { resultTypes: ["violations", "incomplete"], runOnly: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"] }); return { v: r.violations.map((x) => ({ id: x.id, impact: x.impact, n: x.nodes.length, sample: x.nodes[0].html.slice(0, 120), msg: x.nodes[0].failureSummary?.split("\n")[1] })), inc: r.incomplete.map((x) => ({ id: x.id, n: x.nodes.length })) }; });
    const targets = await page.evaluate(() => [...document.querySelectorAll("button, a[href], select, textarea, input, summary, [tabindex]:not([tabindex='-1'])")].filter((e) => e.offsetParent !== null && !e.closest(".sr-only") && getComputedStyle(e).position !== "fixed").map((e) => { const r = (e.tagName === "INPUT" && e.closest("label") ? e.closest("label") : e).getBoundingClientRect(); /* a radio or checkbox is activated through its whole label */ return { t: (e.textContent || e.id || e.tagName).trim().slice(0, 30), w: Math.round(r.width), h: Math.round(r.height) }; }).filter((x) => x.w < 44 || x.h < 44));
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    const focus = await page.evaluate(() => { const a = document.activeElement; return a === document.body ? "BODY (focus lost)" : `${a.tagName.toLowerCase()}#${a.id}:${(a.textContent || "").trim().slice(0, 25)}`; });
    out.states[name] = { violations: r.v, incomplete: r.inc, smallTargets: targets, overflow, focus };
  };
  const click = (n) => page.evaluate((n) => { const b = [...document.querySelectorAll("button")].find((x) => x.textContent.trim() === n); if (!b) throw new Error("no " + n); b.focus(); b.click(); }, n);
  const wait = (n) => page.waitForFunction((n) => [...document.querySelectorAll("button")].some((x) => x.textContent.trim() === n), { timeout: 8000 }, n);
  await axe("initial");
  await page.evaluate(() => { document.querySelector("#a11y-heading").closest("details").open = true; });
  await axe("settings-open"); // the accessibility settings expanded
  await page.evaluate(() => { document.querySelector("#a11y-heading").closest("details").open = false; });
  await click("Start camera"); await wait("Capture photo"); await sleep(500);
  await axe("camera-ready");
  await click("Capture photo"); await wait("Retake photo"); await sleep(300);
  out.captured = await page.evaluate(() => document.querySelector("#photo-heading")?.closest("section")?.innerText.match(/(\d+) × (\d+) pixels, (\d+) KB/)?.[0]);
  await axe("after-capture");
  await page.type("#question-input", "Has this expired?");
  await click("Ask"); await page.waitForSelector("#answer-heading"); await sleep(300);
  await axe("answer");
  mode = "fail";
  await click("Ask another question"); await page.waitForSelector("#question-input");
  await page.type("#question-input", "again");
  await click("Ask"); await page.waitForSelector("#failure-heading"); await sleep(300);
  await axe("failure");
  out.animation = await page.evaluate(() => { const el = document.querySelector(".btn"); return el ? getComputedStyle(el).transitionDuration : ""; });
  await browser.close();
  return out;
}
const results = [];
const RUNS = [["light", 320], ["light", 360], ["light", 390], ["dark", 390], ["light", 430], ["light", 768], ["light", 1280], ["dark", 1280]];
for (const [scheme, width] of RUNS) results.push(await run(scheme, width));
results.push(await run("light", 390, true)); // 200% text enlargement
results.push(await run("light", 320, true));
results.push(await run("light", 390, false, true)); // reduced motion
// voice-guided mode with voice commands on (adds the voice bar)
results.push(await run("light", 390, false, false, { mode: "voice-guided", autoReadAnswers: true, voiceCommands: true }));
results.push(await run("dark", 1280, false, false, { mode: "voice-guided", autoReadAnswers: false, voiceCommands: true }));
for (const r of results) {
  console.log(`\n=== ${r.scheme} ${r.width}px${r.zoom ? " TEXT 200%" : ""}${r.reduceMotion ? " REDUCED-MOTION (button transition " + r.animation + ")" : ""}  captured: ${r.captured}`);
  for (const [name, s] of Object.entries(r.states)) {
    console.log(` [${name}] focus=${s.focus} overflow=${s.overflow} smallTargets=${JSON.stringify(s.smallTargets)}`);
    for (const v of s.violations) console.log(`    VIOLATION ${v.id} (${v.impact}) x${v.n}: ${v.msg} | ${v.sample}`);
    const inc = s.incomplete.filter((i) => i.id !== "color-contrast" || true).map((i) => `${i.id}x${i.n}`).join(", ");
    if (inc) console.log(`    needs-review: ${inc}`);
  }
}
