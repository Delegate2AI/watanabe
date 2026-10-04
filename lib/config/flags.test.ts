import { mkdirSync, mkdtempSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invalidateFlagOverridesCache, isFlagEnabled, loadFlagOverrides } from "./flags";

describe("loadFlagOverrides", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(path.join(os.tmpdir(), "flag-overrides-"));
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(root, { recursive: true, force: true });
  });

  it("returns an empty object for a missing file, with no error logged", () => {
    expect(loadFlagOverrides(path.join(root, "missing.yaml"))).toEqual({});
    expect(console.error).not.toHaveBeenCalled();
  });

  it("returns an empty object for malformed YAML, and logs it", () => {
    const filePath = path.join(root, "access", "flags.yaml");
    mkdirSync(path.dirname(filePath), { recursive: true });
    writeFileSync(filePath, "flags: [not, a, map\n");

    expect(loadFlagOverrides(filePath)).toEqual({});
    expect(console.error).toHaveBeenCalledOnce();
  });

  it("loads boolean overrides", () => {
    const filePath = path.join(root, "flags.yaml");
    writeFileSync(filePath, "flags:\n  MEMORY_ENABLED: true\n  INDEX_ENABLED: false\n");

    expect(loadFlagOverrides(filePath)).toEqual({
      MEMORY_ENABLED: true,
      INDEX_ENABLED: false,
    });
  });

  it("drops an unknown flag key instead of discarding every other override", () => {
    const filePath = path.join(root, "flags.yaml");
    writeFileSync(
      filePath,
      "flags:\n  MEMORY_ENABLED: true\n  SOME_RETIRED_FLAG: true\n  INDEX_ENABLED: false\n",
    );

    expect(loadFlagOverrides(filePath)).toEqual({
      MEMORY_ENABLED: true,
      INDEX_ENABLED: false,
    });
    expect(console.error).not.toHaveBeenCalled();
  });
});

describe("isFlagEnabled caching", () => {
  let root: string;
  let filePath: string;

  beforeEach(() => {
    root = mkdtempSync(path.join(os.tmpdir(), "flag-cache-"));
    filePath = path.join(root, "flags.yaml");
    writeFileSync(filePath, "flags:\n  MEMORY_ENABLED: true\n");
    process.env.MEMORY_CHECKOUT_DIR = root;
    invalidateFlagOverridesCache();
  });

  afterEach(() => {
    delete process.env.MEMORY_CHECKOUT_DIR;
    invalidateFlagOverridesCache();
    rmSync(root, { recursive: true, force: true });
  });

  /** Rewrite the overrides file with an mtime far enough away to be unambiguous. */
  function rewriteOutOfBand(target: string, body: string, secondsLater: number): void {
    const before = statSync(target).mtime;
    writeFileSync(target, body);
    const when = new Date(before.getTime() + secondsLater * 1000);
    utimesSync(target, when, when);
  }

  // That an untouched file is served from cache, and at what syscall cost, is
  // asserted in flags-cache.test.ts, which fakes node:fs so reads and stats can
  // be counted. A temp-dir test cannot tell a cache hit from a re-read.

  it("still honours an explicit invalidation", () => {
    mkdirSync(path.join(root, "access"), { recursive: true });
    const target = path.join(root, "access", "flags.yaml");
    writeFileSync(target, "flags:\n  MEMORY_ENABLED: true\n");
    expect(isFlagEnabled("MEMORY_ENABLED")).toBe(true);

    writeFileSync(target, "flags:\n  MEMORY_ENABLED: false\n");
    invalidateFlagOverridesCache();

    expect(isFlagEnabled("MEMORY_ENABLED")).toBe(false);
  });

  it("picks up a write this process never made, with no explicit invalidation", () => {
    // The reachable case: `git reset --hard FETCH_HEAD` in ensureMemoryWorktree,
    // or commitPrivateAccess rebasing onto a portal-memory branch where someone
    // edited flags.yaml in the GitLab web UI. Nothing calls into this module, so
    // a process-lifetime cache would serve the old value until a restart.
    mkdirSync(path.join(root, "access"), { recursive: true });
    const target = path.join(root, "access", "flags.yaml");
    writeFileSync(target, "flags:\n  MEMORY_ENABLED: true\n");
    expect(isFlagEnabled("MEMORY_ENABLED")).toBe(true);

    rewriteOutOfBand(target, "flags:\n  MEMORY_ENABLED: false\n", 5);

    expect(isFlagEnabled("MEMORY_ENABLED")).toBe(false);
  });

  it("picks up an out-of-band file appearing and then being removed", () => {
    // Both directions of the absent-file sentinel: no file is a cacheable state
    // too, so neither transition may be missed.
    delete process.env.MEMORY_ENABLED;
    mkdirSync(path.join(root, "access"), { recursive: true });
    const target = path.join(root, "access", "flags.yaml");

    expect(isFlagEnabled("MEMORY_ENABLED")).toBe(false);

    writeFileSync(target, "flags:\n  MEMORY_ENABLED: true\n");
    expect(isFlagEnabled("MEMORY_ENABLED")).toBe(true);

    rmSync(target);
    expect(isFlagEnabled("MEMORY_ENABLED")).toBe(false);
  });
});

describe("isFlagEnabled", () => {
  afterEach(() => {
    delete process.env.MEMORY_ENABLED;
  });

  it("uses an override before the environment", () => {
    process.env.MEMORY_ENABLED = "0";
    expect(isFlagEnabled("MEMORY_ENABLED", { MEMORY_ENABLED: true })).toBe(true);
  });

  it("falls back to the environment when no override exists", () => {
    process.env.MEMORY_ENABLED = "1";
    expect(isFlagEnabled("MEMORY_ENABLED", {})).toBe(true);
    process.env.MEMORY_ENABLED = "true";
    expect(isFlagEnabled("MEMORY_ENABLED", {})).toBe(false);
  });

  it("lets a false override win over an enabled environment value", () => {
    process.env.MEMORY_ENABLED = "1";
    expect(isFlagEnabled("MEMORY_ENABLED", { MEMORY_ENABLED: false })).toBe(false);
  });
});
