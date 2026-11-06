// Test-only module resolution hooks for `npm test` (Node's built-in runner).
// Mirrors two things Next.js does at build time so server modules can be unit
// tested unchanged: the "@/..." alias from tsconfig.json, and the `server-only`
// guard package (which Next resolves internally and which is a no-op here).
import { existsSync } from "node:fs";
import { dirname, resolve as resolvePath } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const srcRoot = resolvePath(dirname(fileURLToPath(import.meta.url)), "../src");

export async function resolve(specifier, context, nextResolve) {
  if (specifier === "server-only") {
    return { url: "data:text/javascript,", shortCircuit: true };
  }
  if (specifier.startsWith("@/")) {
    const base = resolvePath(srcRoot, specifier.slice(2));
    for (const candidate of [`${base}.ts`, `${base}.tsx`, resolvePath(base, "index.ts")]) {
      if (existsSync(candidate)) return nextResolve(pathToFileURL(candidate).href, context);
    }
  }
  return nextResolve(specifier, context);
}
