# Dependency audit notes

## Status (updated 2026-11-02, Milestone 3)

`npm audit`: **16 moderate** findings. `npm audit --omit=dev`: **0 vulnerabilities**.
Rechecked after adding `@google/genai` 2.32.0 in Milestone 3: unchanged (no new
advisories, none in `@google/genai` or its dependencies).

All 16 come from one advisory: `minimatch < 11.0.1` — denial of service via
globparts amplification
([GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249)).
Every affected package is in the development-only ESLint chain
(`eslint`, `eslint-config-next`, `@next/eslint-plugin-next`,
`typescript-eslint` and its sub-packages, `eslint-plugin-import`,
`eslint-plugin-jsx-a11y`, `eslint-plugin-react`, `@eslint/*`). None ship to the
browser or run in production.

## Decision

- Existing dependencies are intentionally left unchanged. The only addition so far is
  `@google/genai` (Milestone 3; the official SDK, needed to create ephemeral tokens).
- Do **not** run `npm audit fix --force` (it proposes a breaking downgrade to
  `eslint@4.0.0`).
- No npm `overrides` are used.

## Recheck

Re-run `npm audit` and `npm audit --omit=dev` at a later milestone, and look for newer
`eslint-config-next` / `typescript-eslint` releases that bump `minimatch`.
