import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { clearProjectionCacheForTests, getProjection, projectionCacheKey } from "./cache";

describe("projection cache", () => {
  let sourceRoot: string;
  let outputRoot: string;

  beforeEach(() => {
    clearProjectionCacheForTests();
    sourceRoot = mkdtempSync(path.join(os.tmpdir(), "authority-cache-source-"));
    outputRoot = mkdtempSync(path.join(os.tmpdir(), "authority-cache-output-"));
    mkdirSync(path.join(sourceRoot, "notes"), { recursive: true });
    writeFileSync(path.join(sourceRoot, "notes", "public.md"), "# Public\n");
  });

  afterEach(() => {
    clearProjectionCacheForTests();
    rmSync(sourceRoot, { recursive: true, force: true });
    rmSync(outputRoot, { recursive: true, force: true });
  });

  it("normalizes clearance order in the key and reuses the cached directory", () => {
    expect(projectionCacheKey(["exec", "all-hands"], "sha-1", "groups-1")).toBe(
      projectionCacheKey(["all-hands", "exec"], "sha-1", "groups-1"),
    );
    const first = getProjection(["exec", "all-hands"], {
      vaultSha: "sha-1",
      groupsHash: "groups-1",
      sourceRoot,
      outputRoot,
    });
    const second = getProjection(["all-hands", "exec"], {
      vaultSha: "sha-1",
      groupsHash: "groups-1",
      sourceRoot,
      outputRoot,
    });

    expect(second).toBe(first);
  });

  it("rebuilds content at a stable clearance path after cache inputs change", () => {
    const base = { sourceRoot, outputRoot };
    const first = getProjection(["all-hands"], {
      ...base,
      vaultSha: "sha-1",
      groupsHash: "groups-1",
    });
    writeFileSync(path.join(sourceRoot, "notes", "public.md"), "# Updated\n");
    const newVault = getProjection(["all-hands"], {
      ...base,
      vaultSha: "sha-2",
      groupsHash: "groups-1",
    });
    const newGroups = getProjection(["all-hands"], {
      ...base,
      vaultSha: "sha-2",
      groupsHash: "groups-2",
    });

    expect(newVault).toBe(first);
    expect(newGroups).toBe(newVault);
    expect(readFileSync(path.join(newVault, "notes", "public.md"), "utf8")).toBe("# Updated\n");
  });

  it("rebuilds when a prior cache key becomes current again", () => {
    const base = { sourceRoot, outputRoot, groupsHash: "groups-1" };
    const first = getProjection(["all-hands"], { ...base, vaultSha: "sha-1" });
    writeFileSync(path.join(sourceRoot, "notes", "public.md"), "# Second\n");
    getProjection(["all-hands"], { ...base, vaultSha: "sha-2" });
    writeFileSync(path.join(sourceRoot, "notes", "public.md"), "# Restored\n");

    const restored = getProjection(["all-hands"], { ...base, vaultSha: "sha-1" });

    expect(restored).toBe(first);
    expect(readFileSync(path.join(restored, "notes", "public.md"), "utf8")).toBe("# Restored\n");
  });
});
