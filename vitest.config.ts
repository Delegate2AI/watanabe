import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

// The default environment stays `node`: the bulk of the suite is
// pure-function/DB/route tests that need node (better-sqlite3, git fixtures).
// Component tests (spec 18) opt into jsdom per file with a
// `// @vitest-environment jsdom` docblock, so they get a DOM without forcing
// jsdom (and its cost) on every node test. `@vitejs/plugin-react` enables JSX
// transform + Fast Refresh-free React rendering under Testing Library.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
      // `server-only` throws on import outside an RSC graph, which is the point
      // of it (see lib/config/index.ts) but makes it unimportable here.
      "server-only": path.resolve(__dirname, "test/stubs/server-only.ts"),
    },
  },
  test: {
    environment: "node",
    // Exposes `afterEach` as a global so @testing-library/react auto-registers
    // its cleanup between component tests. Additive only: the existing node
    // suites keep their explicit `import { describe, it, expect } from "vitest"`
    // and are unaffected (they never import Testing Library, so no cleanup runs
    // in the node environment).
    globals: true,
    // jest-dom matchers (`toBeInTheDocument`, ...) extend `expect`. Importing
    // the setup only registers matchers, so it is harmless under the node
    // environment used by non-component suites.
    setupFiles: ["test/setup-dom.ts"],
    // `data/` is runtime-mounted KB content (a git checkout of a *different*
    // this app's source. A stale committed copy under `data/repo/portal/`
    // (an old snapshot of this app itself) carries its own out-of-date
    // `*.test.ts` files that fail against the current source — excluded here
    // for the same reason `tsconfig.json` excludes `data` from type-checking.
    exclude: ["**/node_modules/**", "**/.next/**", "**/data/**"],
    // Several suites drive real git fixtures (repo-write, kb-mcp quality,
    // memory, packages runner); under a loaded machine their parallel git
    // subprocess contention can stretch a single test past vitest's default
    // 5s and flake. Generous ceiling, no effect on healthy runs.
    testTimeout: 60_000,
  },
});
