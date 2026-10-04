import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const loadSkillRegistryMock = vi.fn();
vi.mock("./registry", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./registry")>();
  return { ...actual, loadSkillRegistry: (...args: unknown[]) => loadSkillRegistryMock(...args) };
});

const { preflightSlug } = await import("./preflight");
const { skillsStoreDir } = await import("./config");

const savedEnv = { ...process.env };
let tmpRoot: string;

beforeEach(() => {
  tmpRoot = mkdtempSync(path.join(os.tmpdir(), "skill-preflight-"));
  process.env.PORTAL_SKILLS_DIR = path.join(tmpRoot, "store");
  loadSkillRegistryMock.mockReset().mockReturnValue({ entries: [], errors: [] });
});

afterEach(() => {
  process.env = { ...savedEnv };
  rmSync(tmpRoot, { recursive: true, force: true });
});

function makeStoreDir(slug: string): void {
  mkdirSync(path.join(skillsStoreDir(), slug), { recursive: true });
}

describe("preflightSlug", () => {
  it("refuses a malformed slug as invalid", () => {
    expect(preflightSlug("Not Valid!", "git")).toEqual({ ok: false, reason: "invalid" });
  });

  it("refuses a reserved slug as invalid", () => {
    expect(preflightSlug("kb", "git")).toEqual({ ok: false, reason: "invalid" });
  });

  it("passes an unknown slug with nothing registered and no store content", () => {
    expect(preflightSlug("brand-guidelines", "git")).toEqual({ ok: true });
  });

  it("allows a same-type replace of an already registered slug", () => {
    loadSkillRegistryMock.mockReturnValue({
      entries: [
        {
          slug: "brand-guidelines",
          title: "Brand Guidelines",
          source: { type: "git", url: "https://git.example/skills.git", ref: "main", commit: "abc123" },
          groups: [],
          compat: { scripts: [], tools: [] },
        },
      ],
      errors: [],
    });

    expect(preflightSlug("brand-guidelines", "git")).toEqual({ ok: true });
  });

  it("refuses a different-type collision against a registered slug", () => {
    loadSkillRegistryMock.mockReturnValue({
      entries: [
        {
          slug: "brand-guidelines",
          title: "Brand Guidelines",
          source: { type: "authored", author: "alice@example.com", rev: "abc123" },
          groups: [],
          compat: { scripts: [], tools: [] },
        },
      ],
      errors: [],
    });

    expect(preflightSlug("brand-guidelines", "zip")).toEqual({ ok: false, reason: "registry" });
  });

  it("refuses a slug that failed to parse in the registry, regardless of incoming type", () => {
    loadSkillRegistryMock.mockReturnValue({
      entries: [],
      errors: [{ slug: "brand-guidelines", reason: "invalid skill entry" }],
    });

    expect(preflightSlug("brand-guidelines", "git")).toEqual({ ok: false, reason: "registry" });
  });

  it("passes an unknown slug even when an untracked store directory already exists", () => {
    makeStoreDir("brand-guidelines");

    expect(preflightSlug("brand-guidelines", "git")).toEqual({ ok: true });
  });
});
