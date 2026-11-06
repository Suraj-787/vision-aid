/**
 * Security headers for every response (Milestone 8), applied in production by
 * next.config.ts. Pure data so it can be unit-tested.
 *
 * The Content-Security-Policy is deliberately strict where it protects users:
 * - connect-src 'self': the page can only talk to VisionAid's own server, so the
 *   photo, question and answer cannot be sent anywhere else even if a script were
 *   injected (the server forwards the photo and question to Google, not the page).
 * - frame-ancestors 'none' / X-Frame-Options: the camera page cannot be embedded
 *   in another site (clickjacking).
 * - object-src 'none', base-uri and form-action 'self'.
 *
 * Known limit: script-src and style-src keep 'unsafe-inline' because Next.js
 * inlines its bootstrap scripts and the pages are statically generated, so a
 * per-request nonce is not available. Browser speech recognition and speech
 * synthesis run inside the browser and are not controlled by this policy.
 */
export const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' blob: data:",
  "media-src 'self' blob:",
  "connect-src 'self'",
  "font-src 'self'",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

export const SECURITY_HEADERS: ReadonlyArray<{ key: string; value: string }> = [
  { key: "Content-Security-Policy", value: CONTENT_SECURITY_POLICY },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "no-referrer" },
  // Camera and microphone only for VisionAid itself, nothing else the app does not use.
  {
    key: "Permissions-Policy",
    value: "camera=(self), microphone=(self), geolocation=(), payment=(), usb=(), serial=(), bluetooth=()",
  },
];
