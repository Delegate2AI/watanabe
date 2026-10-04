import { describe, it, expect } from "vitest";
import path from "node:path";
import { loadConfig } from "./load";

/**
 * `portal.example.yaml` is documentation, and documentation that does not parse
 * is worse than none. This pins it to the real schema.
 */
const EXAMPLE = path.resolve(__dirname, "../../portal.example.yaml");

describe("portal.example.yaml", () => {
  it("parses and validates against the schema", () => {
    const c = loadConfig(
      { PORTAL_CONFIG: EXAMPLE, LOCAL_REPO_PATH: "/kb", PORTAL_PROXY_ASSERT_SECRET: "s3cret" },
      process.cwd(),
    );
    expect(c.auth.mode).toBe("proxy-header");
    expect(c.app.name).toBe("Watanabe");
    expect(c.app.starters.map((s) => s.id)).toEqual(["whats-in-the-kb", "find-a-decision"]);
  });

  it("its ${VAR} placeholders resolve from the environment", () => {
    const c = loadConfig(
      { PORTAL_CONFIG: EXAMPLE, LOCAL_REPO_PATH: "/kb", PORTAL_PROXY_ASSERT_SECRET: "s3cret" },
      process.cwd(),
    );
    expect(c.repo.path).toBe("/kb");
    if (c.auth.mode !== "proxy-header") throw new Error("mode");
    expect(c.auth.proxyHeader.assertSecret).toBe("s3cret");
  });

  // The file documents ${VAR} as required-or-fatal; prove it, so the doc and the
  // behavior cannot drift.
  it("fails to load when a referenced variable is unset", () => {
    expect(() => loadConfig({ PORTAL_CONFIG: EXAMPLE }, process.cwd())).toThrowError(
      /\$\{LOCAL_REPO_PATH\}/,
    );
  });

  it("every icon it names is in the allowlist", () => {
    const c = loadConfig(
      { PORTAL_CONFIG: EXAMPLE, LOCAL_REPO_PATH: "/kb", PORTAL_PROXY_ASSERT_SECRET: "s" },
      process.cwd(),
    );
    expect(c.app.starters.map((s) => s.icon)).toEqual(["BookOpen", "Scale"]);
  });
});
