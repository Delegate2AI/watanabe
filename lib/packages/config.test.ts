import { afterEach, beforeEach, describe, expect, it } from "vitest";
import path from "node:path";
import {
  isPackagesEnabled,
  packagesRoot,
  packageDir,
  maxTotalBytes,
  maxFileBytes,
  maxEntryCount,
  packagesMaxBudgetUsd,
  packagesMaxTurns,
} from "./config";

// Fixed delete-list of every env var this module reads, restored in
// beforeEach/afterEach so tests never leak state into each other or into
// other test files (never vi.stubEnv, per repo convention).
const ENV_KEYS = [
  "PACKAGES_ENABLED",
  "PACKAGES_DATA_DIR",
  "PACKAGES_MAX_TOTAL_BYTES",
  "PACKAGES_MAX_FILE_BYTES",
  "PACKAGES_MAX_ENTRY_COUNT",
  "PACKAGES_MAX_BUDGET_USD",
  "PACKAGES_MAX_TURNS",
  "KB_WRITE_ENABLED",
];

function clearEnv() {
  for (const key of ENV_KEYS) delete process.env[key];
}

beforeEach(clearEnv);
afterEach(clearEnv);

describe("packages config", () => {
  it("isPackagesEnabled requires BOTH PACKAGES_ENABLED=1 AND KB_WRITE_ENABLED=1", () => {
    // Neither set.
    expect(isPackagesEnabled()).toBe(false);

    // PACKAGES_ENABLED alone is insufficient.
    process.env.PACKAGES_ENABLED = "1";
    expect(isPackagesEnabled()).toBe(false);

    // KB_WRITE_ENABLED alone is insufficient.
    delete process.env.PACKAGES_ENABLED;
    process.env.KB_WRITE_ENABLED = "1";
    expect(isPackagesEnabled()).toBe(false);

    // Both set is required and sufficient.
    process.env.PACKAGES_ENABLED = "1";
    expect(isPackagesEnabled()).toBe(true);

    // Either flipped off disables it again.
    process.env.PACKAGES_ENABLED = "0";
    expect(isPackagesEnabled()).toBe(false);
    process.env.PACKAGES_ENABLED = "1";
    process.env.KB_WRITE_ENABLED = "0";
    expect(isPackagesEnabled()).toBe(false);
  });

  it("packagesRoot honors override, defaults to /data/packages", () => {
    expect(packagesRoot()).toBe("/data/packages");
    process.env.PACKAGES_DATA_DIR = "/tmp/pkgs";
    expect(packagesRoot()).toBe("/tmp/pkgs");
  });

  it("packagesRoot resolves a relative override against cwd", () => {
    process.env.PACKAGES_DATA_DIR = "relative-pkgs";
    expect(packagesRoot()).toBe(path.resolve(process.cwd(), "relative-pkgs"));
  });

  it("packageDir joins <root>/<id>/package for a safe id", () => {
    process.env.PACKAGES_DATA_DIR = "/tmp/pkgs";
    expect(packageDir("abc-123_XYZ")).toBe("/tmp/pkgs/abc-123_XYZ/package");
  });

  it("packageDir throws for an id with path-trick characters", () => {
    expect(() => packageDir("../etc")).toThrow();
    expect(() => packageDir("a/b")).toThrow();
    expect(() => packageDir("")).toThrow();
    expect(() => packageDir(".")).toThrow();
    expect(() => packageDir("a b")).toThrow();
  });

  it("maxTotalBytes/maxFileBytes/maxEntryCount default to 50 MB / 10 MB / 500 and honor env overrides", () => {
    expect(maxTotalBytes()).toBe(50 * 1024 * 1024);
    expect(maxFileBytes()).toBe(10 * 1024 * 1024);
    expect(maxEntryCount()).toBe(500);

    process.env.PACKAGES_MAX_TOTAL_BYTES = "1000";
    expect(maxTotalBytes()).toBe(1000);
    process.env.PACKAGES_MAX_FILE_BYTES = "500";
    expect(maxFileBytes()).toBe(500);
    process.env.PACKAGES_MAX_ENTRY_COUNT = "10";
    expect(maxEntryCount()).toBe(10);
  });

  it("maxTotalBytes/maxFileBytes/maxEntryCount fall back to the exact defaults on malformed env", () => {
    process.env.PACKAGES_MAX_TOTAL_BYTES = "not-a-number";
    expect(maxTotalBytes()).toBe(50 * 1024 * 1024);
    process.env.PACKAGES_MAX_FILE_BYTES = "-5";
    expect(maxFileBytes()).toBe(10 * 1024 * 1024);
    process.env.PACKAGES_MAX_ENTRY_COUNT = "0";
    expect(maxEntryCount()).toBe(500);
  });

  it("packagesMaxBudgetUsd/packagesMaxTurns default to $5 / 100 turns and honor env overrides", () => {
    expect(packagesMaxBudgetUsd()).toBe(5);
    expect(packagesMaxTurns()).toBe(100);

    process.env.PACKAGES_MAX_BUDGET_USD = "12.5";
    expect(packagesMaxBudgetUsd()).toBe(12.5);
    process.env.PACKAGES_MAX_TURNS = "77";
    expect(packagesMaxTurns()).toBe(77);
  });
});
