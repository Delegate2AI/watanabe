import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { IndexMap } from "./build";
import { committedIndexIsStale, getIndex, rebuildIndex, renderIndexMarkdown, stagedIndexMarkdown } from "./cache";

// The cache is pinned to a globalThis singleton (see lib/db/client.ts's
// __portalDb for the pattern this mirrors), so tests must reset that key
// between cases or an earlier test's index would leak into a later one.
const g = globalThis as unknown as { __vaultIndex?: IndexMap };

describe("index cache", () => {
  let vaultDir: string;
  let cacheDir: string;
  const savedEnv = { ...process.env };

  beforeEach(() => {
    delete g.__vaultIndex;

    vaultDir = mkdtempSync(path.join(tmpdir(), "vault-"));
    cacheDir = mkdtempSync(path.join(tmpdir(), "index-cache-"));

    writeFileSync(path.join(vaultDir, "overview.md"), "# Overview\n\nThe top-level overview.\n");
    mkdirSync(path.join(vaultDir, "guides"), { recursive: true });
    writeFileSync(path.join(vaultDir, "guides", "setup.md"), "# Setup Guide\n\nHow to set things up.\n");

    // Point vaultRoot() (lib/repo.ts) straight at vaultDir: LOCAL_REPO_PATH
    // set + no REPO_READ_TOKEN selects the local-dev path, and VAULT_SUBDIR
    // "." means "the repo root IS the vault" so no docs/ subdir is appended.
    process.env.LOCAL_REPO_PATH = vaultDir;
    process.env.VAULT_SUBDIR = ".";
    delete process.env.REPO_READ_TOKEN;
    process.env.INDEX_CACHE_DIR = cacheDir;
  });

  afterEach(() => {
    delete g.__vaultIndex;
    process.env = { ...savedEnv };
    rmSync(vaultDir, { recursive: true, force: true });
    rmSync(cacheDir, { recursive: true, force: true });
  });

  it("rebuildIndex stores a singleton that getIndex returns", () => {
    const built = rebuildIndex();
    expect(built.count).toBe(2);

    const cached = getIndex();
    expect(cached).not.toBeNull();
    expect(cached?.count).toBe(2);
  });

  it("renderIndexMarkdown includes a doc title", () => {
    rebuildIndex();
    const md = renderIndexMarkdown(getIndex()!);
    expect(md).toContain("Overview");
    expect(md).toContain("Setup Guide");
  });

  it("getIndex lazily loads from the on-disk cache when there is no in-memory singleton", () => {
    rebuildIndex();
    delete g.__vaultIndex;

    const loaded = getIndex();
    expect(loaded).not.toBeNull();
    expect(loaded?.count).toBe(2);
  });

  it("getIndex returns null when nothing has been built or cached yet", () => {
    expect(getIndex()).toBeNull();
  });

  it("renderIndexMarkdown omits the trailing description when it is empty", () => {
    const map: IndexMap = {
      generatedFrom: "/tmp/x",
      groups: [{ dir: ".", docs: [{ path: "a.md", title: "A", description: "", tags: [] }] }],
      count: 1,
    };
    const md = renderIndexMarkdown(map);
    expect(md).toContain("- [A](a.md)");
    expect(md).not.toContain("- [A](a.md) -");
  });

  it("stagedIndexMarkdown renders the current cached-or-rebuilt index", () => {
    const built = rebuildIndex();
    expect(stagedIndexMarkdown()).toBe(renderIndexMarkdown(built));
  });

  describe("committedIndexIsStale", () => {
    it("returns false when there is no committed INDEX.md", () => {
      expect(committedIndexIsStale()).toBe(false);
    });

    it("returns true when a committed INDEX.md differs from a fresh render", () => {
      writeFileSync(path.join(vaultDir, "INDEX.md"), "# Stale\n\nThis is not the current index.\n");
      expect(committedIndexIsStale()).toBe(true);
    });

    it("returns false when a committed INDEX.md matches a fresh render", () => {
      // A root-level INDEX.md is excluded from the scan (see build.ts's
      // BUILD_IGNORED_PATTERNS), so it never lists itself: writing exactly
      // what a fresh render produces is a fixed point on the first write,
      // with no convergence loop needed.
      const rendered = renderIndexMarkdown(rebuildIndex());
      writeFileSync(path.join(vaultDir, "INDEX.md"), rendered);
      expect(committedIndexIsStale()).toBe(false);
    });

    it("reuses the cached index instead of forcing a rebuild", () => {
      // Seed the in-memory singleton with a fake index that does NOT match
      // the real vault fixture (2 docs: overview.md, guides/setup.md), then
      // write a committed INDEX.md that matches the FAKE index's render. If
      // committedIndexIsStale() reuses the cached singleton (the fix), this
      // reports "not stale". If it forces a rebuild from the real fixture
      // instead (today's bug), the real 2-doc render won't match the
      // fake-index-based commit, and this would incorrectly report stale.
      const fakeMap: IndexMap = {
        generatedFrom: "fake",
        groups: [{ dir: ".", docs: [{ path: "fake.md", title: "Fake", description: "", tags: [] }] }],
        count: 1,
      };
      g.__vaultIndex = fakeMap;
      writeFileSync(path.join(vaultDir, "INDEX.md"), renderIndexMarkdown(fakeMap));
      expect(committedIndexIsStale()).toBe(false);
    });
  });
});
