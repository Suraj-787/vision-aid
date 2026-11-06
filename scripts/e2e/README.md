# Browser tests (headless Chrome)

These scripts drive the real, production-built app in headless Chrome with a fake
camera. `/api/ask` and the speech engines are **mocked**, so no Gemini quota is
used and no real speech is exercised. They prove the app's behaviour, **not**
behaviour on real phones, real Hindi/Kannada recognition or real voices.

They are not part of `npm test` because they need a browser and
`puppeteer-core`, which is deliberately not a project dependency:

```bash
npm i --no-save puppeteer-core axe-core     # temporary; does not touch package.json
npm run build && npx next start -p 3917 &   # use a production build (security headers are production-only)
node scripts/e2e/ui-m1-m6.e2e.mjs http://localhost:3917
node scripts/e2e/ui-m7.e2e.mjs    http://localhost:3917
node scripts/e2e/ui-m8.e2e.mjs    http://localhost:3917
node scripts/e2e/lifecycle.e2e.mjs http://localhost:3917
node scripts/e2e/a11y-audit.mjs   http://localhost:3917
```

Set `CHROME_PATH` if Chrome is not at the macOS default location. Pass a second
argument to run only scenarios whose name contains that text.
