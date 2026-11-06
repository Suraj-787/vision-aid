// Usage: node scripts/e2e/ui-m1-m6.e2e.mjs <base URL of a RUNNING app, e.g. http://localhost:3917> [scenario name filter]
// Needs: npm i --no-save puppeteer-core (not a project dependency) and Chrome (CHROME_PATH to override the macOS default).
// Run it against a production build: npm run build && npx next start -p 3917
// Browser checks for Milestone 6 + regression of the Milestone 1-5 flow.
// /api/ask is MOCKED (no Gemini quota). Fake camera/microphone devices.
import puppeteer from "puppeteer-core";

const URL_ = process.argv[2];
const only = process.argv[3];
const CHROME = process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const log = [];
const must = (c, m, x = "") => { log.push(`  ${c ? "PASS" : "FAIL"} ${m}${x ? "  — " + x : ""}`); if (!c) failures++; };

const base = {
  intent: "text_reading", answer: "I can see a white box.", details: null, uncertainty: null, confidence: "high",
  printed_text: null, printed_instructions: null, currency_check: null, expiry_check: null, notices: [], adjustments: [],
};
const expiry = (over = {}) => ({
  status: "not_expired", kind: "expiry", printed_text: "EXP 08/2027", manufacturing_text: "MFG 02/2026",
  interpreted_as: "August 2027", checked_on: "2026-11-06", checked_on_source: "device",
  explanation: 'The printed expiry date "EXP 08/2027" is read as August 2027. Compared with today\'s date (6 November 2026), that date has not passed yet.',
  assumptions: ["Only a month and year are printed, so I treated it as valid through the end of the month (31 August 2027)."], ...over,
});
const ok = (over = {}) => ({ status: 200, body: { ...base, ...over } });

async function scenario(name, mock, fn) {
  if (only && !name.toLowerCase().includes(only.toLowerCase())) return;
  log.push(`\n# ${name}`);
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", "--no-first-run"] });
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const errors = [], calls = [], reqs = [];
  page.on("console", (m) => { if (m.type() === "error" && !/^Failed to load resource/.test(m.text())) errors.push(m.text().slice(0, 160)); });
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message.slice(0, 160)));
  page.on("request", (r) => reqs.push({ method: r.method(), url: r.url() }));
  await page.evaluateOnNewDocument("delete window.SpeechRecognition; delete window.webkitSpeechRecognition;");
  await page.setRequestInterception(true);
  page.on("request", (req) => {
    if (req.isInterceptResolutionHandled()) return;
    if (req.url().endsWith("/api/ask") && req.method() === "POST") {
      let body = null; try { body = JSON.parse(req.postData() ?? ""); } catch {}
      const n = calls.push(body);
      Promise.resolve(mock({ n, body })).then(async (p) => {
        if (p.delay) await sleep(p.delay);
        await req.respond({ status: p.status, contentType: p.contentType ?? "application/json", headers: p.headers ?? {}, body: typeof p.body === "string" ? p.body : JSON.stringify(p.body) });
      }).catch(() => {});
    } else req.continue();
  });
  await page.goto(URL_, { waitUntil: "networkidle0", timeout: 60000 });
  await sleep(500);
  const a = {
    page, calls,
    click: (n) => page.evaluate((n) => { const b = [...document.querySelectorAll("button")].find((x) => x.textContent.trim() === n); if (!b) throw new Error("no button " + n); b.click(); }, n),
    has: (n) => page.evaluate((n) => [...document.querySelectorAll("button")].some((x) => x.textContent.trim() === n), n),
    wait: (n, t = 8000) => page.waitForFunction((n) => [...document.querySelectorAll("button")].some((x) => x.textContent.trim() === n), { timeout: t }, n),
    text: () => page.evaluate(() => document.body.innerText),
    answerText: () => page.evaluate(() => document.querySelector("#answer-heading")?.closest("section")?.innerText ?? null),
    setup: async (q = "Has this expired?") => {
      if (await a.has("Start camera")) await a.click("Start camera");
      await a.wait("Capture photo"); await sleep(400);
      await a.click("Capture photo"); await a.wait("Retake photo");
      await page.focus("#question-input"); await page.type("#question-input", q);
    },
    askAndWait: async () => { await a.click("Ask"); await page.waitForSelector("#answer-heading, #failure-heading", { timeout: 8000 }); },
  };
  try { await fn(a); } catch (e) {
    must(false, "scenario threw", String(e.message).slice(0, 200));
    try { log.push("    DIAG: " + (await a.text()).replace(/\s+/g, " ").slice(700, 1300)); } catch {}
  }
  const external = reqs.filter((r) => !/^(http:\/\/localhost|data:|blob:)/.test(r.url));
  must(external.length === 0, "no request left localhost", external.map((r) => r.url.slice(0, 50)).join(","));
  must(reqs.filter((r) => r.method === "POST").every((r) => r.url.endsWith("/api/ask")), "only POSTs are to /api/ask");
  must(errors.length === 0, "no console or page errors", errors.join(" | "));
  await browser.close();
}

// ----------------------------------------------------------------------------
await scenario("1. Expiry answer: card, printed text, assumptions, notice, nothing sent before Ask", () => ok({
  intent: "expiry_date", answer: 'The printed expiry date "EXP 08/2027" has not passed yet. The manufacturing date is 02/2026.',
  printed_text: "FRESH ORANGE JUICE\nMFG: 02/2026\nEXP: 08/2027", expiry_check: expiry(), notices: ["expiry_limits"],
}), async (a) => {
  await a.setup();
  must(a.calls.length === 0, "no /api/ask request before Ask");
  await a.askAndWait();
  must(a.calls.length === 1, "exactly one request after Ask");
  const c = a.calls[0];
  must(Object.keys(c).sort().join() === "image,local_date,question,response_language", "request has image, question, local_date and response_language", Object.keys(c).join());
  const d = new Date();
  const expectDate = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  must(c.local_date === expectDate, "local_date is the device's own calendar date", c.local_date);
  must(/^\d{4}-\d{2}-\d{2}$/.test(c.local_date) && c.image.startsWith("/9j/"), "date format and JPEG payload");
  const t = await a.answerText();
  must(t.includes("has not passed yet"), "primary answer shown");
  must(/Understood as: Checking an expiry date/.test(t), "intent shown in friendly words");
  must(/Confidence: High\. This is the AI's rough guess, not a guarantee/.test(t), "confidence is a word with a caveat, not a number");
  must(!/\d+\s?%/.test(t), "no percentage anywhere");
  must(t.includes("Expiry check") && t.includes("✓ Not expired yet"), "expiry card with status as text and symbol");
  must(t.includes("Printed on the package: EXP 08/2027"), "original printed date shown");
  must(t.includes("Read as: August 2027"), "interpretation shown next to it");
  must(t.includes("Manufacturing date printed: MFG 02/2026 (not used as an expiry date)"), "manufacturing date shown as context only");
  must(/Compared with: 6 November 2026 \(your device's date\)/.test(t), "comparison date and its source shown");
  must(t.includes("treated it as valid through the end of the month"), "month/year assumption stated");
  must(t.includes("does not tell you whether the product is safe"), "expiry notice shown");
  must(t.includes("FRESH ORANGE JUICE") && t.includes("Copied from the photo by the AI, not written by it"), "printed text shown and attributed");
  const focus = await a.page.evaluate(() => document.activeElement?.id);
  must(focus === "answer-heading", "focus moved to the answer", focus);
  const sr = await a.page.evaluate(() => document.querySelector('.sr-only[role="status"]').textContent);
  // Milestone 9: focus moves to the Answer heading and the live region only says the answer is ready.
  // The answer text is no longer read out automatically (the person navigates to it or taps Listen).
  must(/^Your answer is ready\./.test(sr), "the screen-reader announcement says the answer is ready", sr.slice(0, 80));
  must(!sr.includes("not passed yet") && !sr.includes("Compared with today"), "the answer's own text is NOT read out automatically", sr.slice(0, 80));
});

await scenario("2. Expired and unclear statuses read clearly (not colour alone)", ({ n }) =>
  n === 1 ? ok({ intent: "expiry_date", answer: 'The printed expiry date "03/2025" has passed.', expiry_check: expiry({ status: "expired", printed_text: "03/2025", manufacturing_text: null, interpreted_as: "March 2025", explanation: "The printed expiry date \"03/2025\" is read as March 2025. Compared with today's date (6 November 2026), that date has passed." }), notices: ["expiry_limits"] })
  : ok({ intent: "expiry_date", answer: "I cannot tell whether it has expired. See the expiry check below.", expiry_check: expiry({ status: "unclear", kind: null, printed_text: null, manufacturing_text: "MFG 15/09/2025", interpreted_as: null, assumptions: [], explanation: 'Only a manufacturing or packing date was found ("15/09/2025"). That is not an expiry date, so I cannot tell whether the product has expired.' }), notices: ["expiry_limits"] }),
async (a) => {
  await a.setup();
  await a.askAndWait();
  let t = await a.answerText();
  must(t.includes("✕ Expired") && t.includes("has passed"), "expired status shown as text");
  await a.click("Ask another question");
  await a.page.waitForSelector("#question-input");
  await a.page.type("#question-input", "And this one?");
  await a.askAndWait();
  t = await a.answerText();
  must(t.includes("? Unclear") && t.includes("not an expiry date"), "unclear status shown as text with the reason");
  must(t.includes("printed on the package: no expiry date found".replace("printed", "Printed")), "missing expiry date stated plainly");
  must(!/✓ Not expired yet/.test(t) && !/✕ Expired/.test(t), "an unclear result never shows a verdict");
});

await scenario("3. Currency: identified, then uncertain with no value shown", ({ n }) =>
  n === 1 ? ok({ intent: "currency_identification", answer: "This looks like a ₹500 note, based on what is visible in the photo.", confidence: "high",
    currency_check: { status: "identified", denomination: 500, evidence: "The printed numeral 500 and the portrait.", message: "This looks like a ₹500 note, based on what is visible in the photo." }, notices: ["currency_limits"] })
  : ok({ intent: "currency_identification", answer: "I could not tell which banknote this is from the photo. Lay the whole note flat, in good light, with the number clearly visible, then take the photo again.", confidence: "low",
    uncertainty: "The AI said it is not confident in this answer. The photo may be unclear, so please double-check.",
    currency_check: { status: "uncertain", denomination: null, evidence: null, message: "I could not tell which banknote this is from the photo. Lay the whole note flat, in good light, with the number clearly visible, then take the photo again." },
    notices: ["currency_limits"], adjustments: ["currency_conclusion_replaced"] }),
async (a) => {
  await a.setup("What note is this?");
  await a.askAndWait();
  let t = await a.answerText();
  must(t.includes("Banknote check") && t.includes("Appears to be: ₹500"), "identified note shown as 'appears to be'");
  must(t.includes("What the AI said it saw: The printed numeral 500"), "evidence shown");
  must(t.includes("cannot tell whether a note is genuine or counterfeit"), "authenticity limit always shown");
  must(!/I am not sure about this answer/.test(t), "no low-confidence banner for high confidence");
  await a.click("Ask another question");
  await a.page.waitForSelector("#question-input");
  await a.page.type("#question-input", "What about this one?");
  await a.askAndWait();
  t = await a.answerText();
  must(t.includes("? Could not tell the value") && !/Appears to be/.test(t), "uncertain note shows no value");
  must(/I am not sure about this answer\. Please double-check it, or retake the photo\./.test(t), "low-confidence banner shown");
  must(t.includes("Confidence: Low."), "confidence word shown");
  must(t.includes("Changes VisionAid made") && t.includes("statement about the note's value was replaced"), "the removal is disclosed, not silent");
  must(t.includes("What is unclear"), "uncertainty section shown");
});

await scenario("4. Medicine label: printed text separate from the AI's words, with the notice", () => ok({
  intent: "medicine_label", answer: "The label says take 1 tablet every 6 hours. I can't give medical advice or say how to take a medicine. I can only read what is printed. Please ask a pharmacist or doctor.",
  printed_text: "CROCIN 500\nTake 1 tablet every 6 hours.", printed_instructions: "Take 1 tablet every 6 hours.", notices: ["label_only"], adjustments: ["medical_advice_removed"],
}), async (a) => {
  await a.setup("How many should I take?");
  await a.askAndWait();
  const t = await a.answerText();
  must(t.includes("Printed instructions, copied as written") && t.includes("Take 1 tablet every 6 hours."), "printed instructions in their own labelled block");
  must(t.includes("VisionAid does not give medical advice or dosing guidance"), "label-only notice");
  must(t.includes("Text I could read in the photo") && t.includes("CROCIN 500"), "printed text block");
  must(t.includes("sounded like medical advice, which VisionAid does not give"), "removed advice is disclosed");
  must(!/Expiry check|Banknote check/.test(t), "no irrelevant cards");
});

await scenario("5. Plain answers stay simple; HTML in any field is shown as text", () => ok({
  intent: "scene_description", answer: '<img src=x onerror="window.__xss=1"> A mug <script>window.__xss=2</script>', confidence: "medium",
  details: "<b>bold</b>", uncertainty: "<i>x</i>",
}), async (a) => {
  await a.setup("What is this?");
  await a.askAndWait();
  const t = await a.answerText();
  must(!/Expiry check|Banknote check|Changes VisionAid made|Printed instructions|Text I could read/.test(t), "no extra cards for a plain answer");
  must(t.includes("Confidence: Medium.") && t.includes("Understood as: Describing the scene"), "intent and confidence line shown");
  must(t.includes('<img src=x onerror="window.__xss=1">') && t.includes("<b>bold</b>"), "HTML is rendered as literal text");
  const r = await a.page.evaluate(() => ({ xss: window.__xss ?? null, bold: document.querySelectorAll("#answer-heading ~ div b, #answer-heading ~ p img").length }));
  must(r.xss === null && r.bold === 0, "nothing was injected or executed", JSON.stringify(r));
});

await scenario("6. Unknown intent is not announced as a category", () => ok({ intent: "unknown", answer: "I am not sure what you are asking." }), async (a) => {
  await a.setup("hmm");
  await a.askAndWait();
  const t = await a.answerText();
  must(!/Understood as/.test(t) && /Confidence: High/.test(t), "no 'Understood as' line for unknown, confidence still shown");
});

await scenario("7. Replies that do not match the new schema are rejected safely", ({ n }) => [
  { status: 200, body: { answer: "old five-field reply", details: null, uncertainty: null, printed_text: null, printed_instructions: null } },
  { status: 200, body: { ...base, intent: "banana" } },
  { status: 200, body: { ...base, confidence: "99%" } },
  { status: 200, body: { ...base, expiry_check: { status: "safe" } } },
  { status: 200, body: { ...base, currency_check: { status: "identified", denomination: 1000, evidence: null, message: "m" } } },
  { status: 200, body: { ...base, adjustments: ["made_up"] } },
][n - 1], async (a) => {
  await a.setup();
  for (let i = 1; i <= 6; i++) {
    await a.click(i === 1 ? "Ask" : "Try again");
    await a.page.waitForFunction(() => !!document.querySelector("#failure-heading") && !document.querySelector("#sending-heading"), { timeout: 8000 });
    const t = await a.text();
    must(/unexpected reply/.test(t) && (await a.answerText()) === null, `malformed reply #${i} -> generic error, no answer shown`);
  }
});

await scenario("8. Errors, retry, duplicate prevention, cancel (Milestone 5 behaviour intact)", ({ n }) =>
  n === 1 ? { status: 502, body: { error: { code: "UPSTREAM_UNAVAILABLE", message: "The AI service is unavailable right now. Please try again in a moment.", retryable: true } } }
  : { ...ok({ answer: "Second try worked." }), delay: 800 },
async (a) => {
  await a.setup();
  await a.page.evaluate(() => { const b = [...document.querySelectorAll("button")].find((x) => x.textContent.trim() === "Ask"); b.click(); b.click(); b.click(); });
  await a.page.waitForSelector("#failure-heading", { timeout: 8000 });
  must(a.calls.length === 1, "triple click sends one request");
  must((await a.text()).includes("The AI service is unavailable") && (await a.has("Try again")), "error shown with Try again");
  await sleep(1200);
  must(a.calls.length === 1, "no automatic retry");
  await a.click("Try again");
  await a.page.waitForSelector("#sending-heading");
  must(a.calls.length === 2 && a.calls[1].question === a.calls[0].question && a.calls[1].image === a.calls[0].image, "retry reuses the same photo and question");
  await a.click("Cancel");
  await a.wait("Capture photo");
  await sleep(1200);
  must(!(await a.text()).includes("Second try worked"), "a reply arriving after Cancel is ignored");
});

await scenario("9. Camera, capture, retake, Stop camera and microphone test still work", () => ok(), async (a) => {
  await a.click("Start camera"); await a.wait("Capture photo");
  const cam = await a.page.evaluate(() => document.querySelector('.chip[role="status"]').textContent);
  must(cam.startsWith("Camera on"), "camera starts on tap (status chip says Camera on)", cam);
  await sleep(400); await a.click("Capture photo"); await a.wait("Retake photo");
  must(await a.page.evaluate(() => { const i = document.querySelector('img[alt^="The photo you captured"]'); return !!i && i.naturalWidth > 0 && Math.max(i.naturalWidth, i.naturalHeight) <= 1280; }), "captured image shown, at most 1280 px (raised from 768 in Milestone 8)");
  await a.click("Retake photo"); await a.wait("Capture photo");
  await a.click("Capture photo"); await a.wait("Retake photo");
  await a.click("Stop camera"); await sleep(300);
  must((await a.page.evaluate(() => document.querySelector('.chip[role="status"]').textContent)).startsWith("Camera off"), "Stop camera turns the camera off (status chip says Camera off)");
  await a.page.evaluate(() => { [...document.querySelectorAll("details")].find((d) => d.textContent.includes("Microphone test")).open = true; });
  await a.click("Start microphone");
  await a.page.waitForFunction(() => document.querySelector("#mic-heading").closest("section").querySelector('[role="status"]').textContent.startsWith("Microphone is on"), { timeout: 8000 });
  must(true, "microphone test starts (Milestone 2)");
  await a.click("Stop microphone"); await sleep(300);
  must((await a.page.evaluate(() => document.querySelector("#mic-heading").closest("section").querySelector('[role="status"]').textContent)).startsWith("Microphone is off"), "microphone test stops");
});

console.log(log.join("\n"));
console.log(failures ? `\n${failures} FAILURE(S)` : "\nALL CHECKS PASSED");
process.exit(failures ? 1 : 0);
