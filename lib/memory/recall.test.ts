import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { buildMemoryContextSync } from "./recall";

let dir: string;
const saved = { ...process.env };
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "recall-"));
  process.env.MEMORY_CHECKOUT_DIR = dir;
  process.env.MEMORY_ENABLED = "1";
  const root = path.join(dir, "memory");
  mkdirSync(path.join(root, "users", "a-at-b.com"), { recursive: true });
  writeFileSync(path.join(root, "CLAUDE.md"), "GOVERN", "utf8");
  // The legacy flat shared index lives INSIDE memory/shared/. memory/MEMORY.md
  // is a dead path (outside the writable scope), seeded here with a decoy so a
  // regression that reads it again is caught.
  mkdirSync(path.join(root, "shared"), { recursive: true });
  writeFileSync(path.join(root, "shared", "MEMORY.md"), "SHARED-INDEX", "utf8");
  writeFileSync(path.join(root, "MEMORY.md"), "DEAD-INDEX-SHOULD-NOT-BE-READ", "utf8");
  writeFileSync(path.join(root, "users", "a-at-b.com", "MEMORY.md"), "MY-INDEX", "utf8");
});
afterEach(() => {
  process.env = { ...saved };
  rmSync(dir, { recursive: true, force: true });
});

describe("buildMemoryContextSync", () => {
  it("returns empty when memory disabled", () => {
    process.env.MEMORY_ENABLED = "0";
    expect(buildMemoryContextSync("a@b.com")).toBe("");
  });

  it("includes governance, the legacy shared index, and the user's index", () => {
    const ctx = buildMemoryContextSync("a@b.com", ["all-hands"]);
    expect(ctx).toContain("GOVERN");
    expect(ctx).toContain("SHARED-INDEX");
    expect(ctx).toContain("MY-INDEX");
  });

  /**
   * Spec 32 R2: recall never touches the mem MCP server, so the scope checks
   * in ./scope do not cover it. An index line pulled into the system prompt is
   * a disclosure on its own, even if a follow-up mem_read would be denied.
   */
  describe("clearance scoping", () => {
    beforeEach(() => {
      const shared = path.join(dir, "memory", "shared");
      mkdirSync(path.join(shared, "finance"), { recursive: true });
      mkdirSync(path.join(shared, "all-hands"), { recursive: true });
      writeFileSync(path.join(shared, "finance", "MEMORY.md"), "FINANCE-INDEX", "utf8");
      writeFileSync(path.join(shared, "all-hands", "MEMORY.md"), "ALLHANDS-INDEX", "utf8");
    });

    it("includes a group index the caller is cleared for", () => {
      const ctx = buildMemoryContextSync("a@b.com", ["all-hands", "finance"]);
      expect(ctx).toContain("FINANCE-INDEX");
      expect(ctx).toContain("ALLHANDS-INDEX");
    });

    it("omits an uncleared group's index, and its name, from the prompt", () => {
      const ctx = buildMemoryContextSync("a@b.com", ["all-hands"]);
      expect(ctx).toContain("ALLHANDS-INDEX");
      expect(ctx).not.toContain("FINANCE-INDEX");
      expect(ctx).not.toContain("finance");
    });

    it("omits the legacy shared index from a caller without all-hands", () => {
      const ctx = buildMemoryContextSync("a@b.com", ["finance"]);
      expect(ctx).toContain("FINANCE-INDEX");
      expect(ctx).not.toContain("SHARED-INDEX");
    });

    it("exposes no shared memory at all for an empty clearance", () => {
      const ctx = buildMemoryContextSync("a@b.com", []);
      expect(ctx).toContain("MY-INDEX");
      expect(ctx).not.toContain("SHARED-INDEX");
      expect(ctx).not.toContain("FINANCE-INDEX");
      expect(ctx).not.toContain("ALLHANDS-INDEX");
    });

    it("ignores a traversal-shaped group name instead of reading outside the shared tree", () => {
      // groups.yaml keys are unvalidated, and recall uses clearance as PATH
      // INPUT. An unsanitized key would pull another user's private index
      // straight into this prompt.
      writeFileSync(path.join(dir, "memory", "users", "a-at-b.com", "MEMORY.md"), "MY-INDEX", "utf8");
      const victim = path.join(dir, "memory", "users", "victim-at-b.com");
      mkdirSync(victim, { recursive: true });
      writeFileSync(path.join(victim, "MEMORY.md"), "VICTIM-PRIVATE", "utf8");
      const ctx = buildMemoryContextSync("a@b.com", ["../users/victim-at-b.com"]);
      expect(ctx).not.toContain("VICTIM-PRIVATE");
    });

    it("never reads memory/MEMORY.md, which no dream can write", () => {
      const ctx = buildMemoryContextSync("a@b.com", ["all-hands"]);
      expect(ctx).not.toContain("DEAD-INDEX-SHOULD-NOT-BE-READ");
      expect(ctx).toContain("SHARED-INDEX");
    });

    it("survives a malformed clearance without throwing", () => {
      expect(() => buildMemoryContextSync("a@b.com", undefined as never)).not.toThrow();
      expect(() => buildMemoryContextSync("a@b.com", "all-hands" as never)).not.toThrow();
    });

    it("defaults to no shared memory when clearance is omitted entirely", () => {
      const ctx = buildMemoryContextSync("a@b.com");
      expect(ctx).not.toContain("SHARED-INDEX");
      expect(ctx).not.toContain("FINANCE-INDEX");
    });
  });
});
