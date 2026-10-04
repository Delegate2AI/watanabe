import { describe, it, expect, afterEach } from "vitest";
import { buildPackagesPrompt } from "./prompt";

const PARAMS = {
  packageName: "handoff-v11",
  packageDirAbs: "/data/packages/pkg-1/package",
  archiveRelPath: "99-reference/handoffs/handoff-v11/",
};

describe("buildPackagesPrompt", () => {
  it("returns a non-empty string", () => {
    const text = buildPackagesPrompt(PARAMS);
    expect(typeof text).toBe("string");
    expect(text.length).toBeGreaterThan(0);
  });

  it("mentions the package name and its directory", () => {
    const text = buildPackagesPrompt(PARAMS);
    expect(text).toContain(PARAMS.packageName);
    expect(text).toContain(PARAMS.packageDirAbs);
  });

  it("mentions the pre-copied archive path and instructs never to re-stage it", () => {
    const text = buildPackagesPrompt(PARAMS);
    expect(text).toContain(PARAMS.archiveRelPath);
    expect(text.toLowerCase()).toContain("never re-stage it");
  });

  it("states the final-message-is-the-report contract", () => {
    const text = buildPackagesPrompt(PARAMS);
    expect(text).toContain("FINAL MESSAGE = THE INTEGRATION REPORT");
    expect(text.toLowerCase()).toContain("merge request description");
  });

  it("includes the report structure sections", () => {
    const text = buildPackagesPrompt(PARAMS);
    for (const marker of [
      "Placement table",
      "Supersessions applied",
      "Judgment calls",
      "Unresolved conflicts",
      "Files skipped",
    ]) {
      expect(text).toContain(marker);
    }
  });

  it("references INDEX.md, CLAUDE.md, and the SSOT principle", () => {
    const text = buildPackagesPrompt(PARAMS);
    expect(text).toContain("INDEX.md");
    expect(text).toContain("CLAUDE.md");
    expect(text.toLowerCase()).toContain("single-source-of-truth");
  });

  it("never uses an em dash in authored prose", () => {
    const text = buildPackagesPrompt(PARAMS);
    expect(text).not.toContain("—");
  });
});

describe("buildPackagesPrompt on a GitHub deploy", () => {
  const saved = { REPO_URL: process.env.REPO_URL, GIT_HOST: process.env.GIT_HOST };

  afterEach(() => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it("calls the report a Pull Request description, not a Merge Request one", () => {
    process.env.REPO_URL = "https://github.com/acme/kb.git";
    delete process.env.GIT_HOST;
    const text = buildPackagesPrompt(PARAMS);
    expect(text).toContain("Pull Request description");
    expect(text).not.toContain("Merge Request");
  });
});
