import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // `data/` is runtime-mounted KB content (a git checkout of a *different*
    // project) plus a stale committed snapshot of this app's own old source
    // under `data/repo/portal/` and a full Quartz checkout under
    // `data/repo/quartz/` — none of it is this app's source, and it carries
    // its own lint violations against a different/older ruleset.
    "data/**",
  ]),
]);

export default eslintConfig;
