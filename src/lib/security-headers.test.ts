import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CONTENT_SECURITY_POLICY, SECURITY_HEADERS } from "./security-headers.ts";

const directive = (name: string) =>
  CONTENT_SECURITY_POLICY.split("; ").find((d) => d.startsWith(`${name} `) || d === name);

describe("security headers", () => {
  it("the page can only connect to its own server, so content cannot be sent elsewhere by the page", () => {
    assert.equal(directive("connect-src"), "connect-src 'self'");
  });

  it("cannot be framed, and allows no plugins or foreign base/form targets", () => {
    assert.equal(directive("frame-ancestors"), "frame-ancestors 'none'");
    assert.equal(directive("object-src"), "object-src 'none'");
    assert.equal(directive("base-uri"), "base-uri 'self'");
    assert.equal(directive("form-action"), "form-action 'self'");
  });

  it("allows what the app needs: its own scripts, blob: previews and the camera stream", () => {
    assert.match(directive("script-src") ?? "", /'self'/);
    assert.match(directive("img-src") ?? "", /blob:/); // the captured photo preview
    assert.match(directive("media-src") ?? "", /blob:/);
    assert.match(directive("worker-src") ?? "", /'self'/); // audio worklet for the microphone test
  });

  it("never allows eval or a wildcard source", () => {
    assert.doesNotMatch(CONTENT_SECURITY_POLICY, /unsafe-eval/);
    assert.doesNotMatch(CONTENT_SECURITY_POLICY, /(^|[ ;])\*($|[ ;])/);
    assert.doesNotMatch(CONTENT_SECURITY_POLICY, /https?:\/\//);
  });

  it("sets the other standard headers once each", () => {
    const keys = SECURITY_HEADERS.map((h) => h.key);
    assert.equal(new Set(keys).size, keys.length);
    const get = (k: string) => SECURITY_HEADERS.find((h) => h.key === k)?.value;
    assert.equal(get("X-Content-Type-Options"), "nosniff");
    assert.equal(get("X-Frame-Options"), "DENY");
    assert.equal(get("Referrer-Policy"), "no-referrer");
  });

  it("limits camera and microphone to this site and disables unused powerful features", () => {
    const policy = SECURITY_HEADERS.find((h) => h.key === "Permissions-Policy")?.value ?? "";
    assert.match(policy, /camera=\(self\)/);
    assert.match(policy, /microphone=\(self\)/);
    assert.match(policy, /geolocation=\(\)/);
  });
});
