import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  classifySharedPath,
  isWithinFileReadScope,
  isWithinListScope,
  isWithinDeleteScope,
  isWithinWriteScope,
  visibleSharedRootEntries,
  isSafeGroupName,
  sanitizeClearance,
  type MemScope,
} from "./scope";

let dir: string;
const saved = { ...process.env };

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "memscope-"));
  process.env.MEMORY_CHECKOUT_DIR = dir;
});
afterEach(() => {
  process.env = { ...saved };
  rmSync(dir, { recursive: true, force: true });
});

/** Absolute path for a memory-relative path, matching what resolveInMemory returns. */
const abs = (rel: string) => path.resolve(dir, rel);

const scope = (clearance: string[], ownerSlug = "a-at-b.com"): MemScope => ({ ownerSlug, clearance });

describe("classifySharedPath", () => {
  it("classifies the shared root, legacy files, group dirs, and group files", () => {
    expect(classifySharedPath("memory/shared")).toEqual({ kind: "shared-root" });
    expect(classifySharedPath("memory/shared/legacy.md")).toEqual({ kind: "legacy" });
    expect(classifySharedPath("memory/shared/finance")).toEqual({ kind: "group", group: "finance" });
    expect(classifySharedPath("memory/shared/finance/x.md")).toEqual({ kind: "group", group: "finance" });
    expect(classifySharedPath("memory/users/a/x.md")).toEqual({ kind: "not-shared" });
  });
});

describe("read scope over shared memory", () => {
  it("allows a group file when the caller is cleared for that group", () => {
    expect(isWithinFileReadScope(abs("memory/shared/finance/x.md"), scope(["all-hands", "finance"]))).toBe(true);
  });

  it("denies a group file when the caller is not cleared for that group", () => {
    expect(isWithinFileReadScope(abs("memory/shared/finance/x.md"), scope(["all-hands"]))).toBe(false);
  });

  it("denies a group that does not exist the same way as one not cleared for", () => {
    // Non-existent and not-cleared-for must be indistinguishable, so probing
    // cannot enumerate group names.
    expect(isWithinFileReadScope(abs("memory/shared/nope/x.md"), scope(["all-hands"]))).toBe(false);
  });

  it("treats a legacy flat file as all-hands", () => {
    expect(isWithinFileReadScope(abs("memory/shared/legacy.md"), scope(["all-hands"]))).toBe(true);
  });

  it("grants nothing under shared for an empty clearance", () => {
    expect(isWithinFileReadScope(abs("memory/shared/legacy.md"), scope([]))).toBe(false);
    expect(isWithinFileReadScope(abs("memory/shared/finance/x.md"), scope([]))).toBe(false);
  });

  it("still allows the caller's own private subtree regardless of clearance", () => {
    expect(isWithinFileReadScope(abs("memory/users/a-at-b.com/x.md"), scope([]))).toBe(true);
  });

  it("denies another user's private subtree", () => {
    expect(isWithinFileReadScope(abs("memory/users/other-at-b.com/x.md"), scope(["all-hands"]))).toBe(false);
  });
});

describe("write scope over shared memory", () => {
  it("allows a write into a cleared group", () => {
    expect(isWithinWriteScope(abs("memory/shared/finance/x.md"), scope(["all-hands", "finance"]))).toBe(true);
  });

  it("denies a write into an uncleared group", () => {
    expect(isWithinWriteScope(abs("memory/shared/finance/x.md"), scope(["all-hands"]))).toBe(false);
  });

  it("denies a write to a legacy flat path, so new writes always carry a group", () => {
    expect(isWithinWriteScope(abs("memory/shared/legacy.md"), scope(["all-hands"]))).toBe(false);
  });

  it("denies every shared write for an empty clearance", () => {
    expect(isWithinWriteScope(abs("memory/shared/all-hands/x.md"), scope([]))).toBe(false);
  });
});

describe("list scope", () => {
  it("allows the structural roots and the caller's own user dir", () => {
    expect(isWithinListScope(abs("memory"), scope(["all-hands"]))).toBe(true);
    expect(isWithinListScope(abs("memory/shared"), scope(["all-hands"]))).toBe(true);
    expect(isWithinListScope(abs("memory/users/a-at-b.com"), scope(["all-hands"]))).toBe(true);
  });

  it("never allows listing the bare users directory", () => {
    expect(isWithinListScope(abs("memory/users"), scope(["all-hands"]))).toBe(false);
  });

  it("allows a cleared group dir and denies an uncleared one", () => {
    expect(isWithinListScope(abs("memory/shared/finance"), scope(["all-hands", "finance"]))).toBe(true);
    expect(isWithinListScope(abs("memory/shared/finance"), scope(["all-hands"]))).toBe(false);
  });
});

describe("visibleSharedRootEntries", () => {
  const entries = [
    { name: "all-hands", isDir: true },
    { name: "finance", isDir: true },
    { name: "legal", isDir: true },
    { name: "legacy.md", isDir: false },
  ];

  it("shows only cleared group dirs, so uncleared group names are not enumerable", () => {
    const visible = visibleSharedRootEntries(entries, ["all-hands", "finance"]);
    expect(visible.map((e) => e.name)).toEqual(["all-hands", "finance", "legacy.md"]);
  });

  it("hides legacy files from a caller without all-hands", () => {
    expect(visibleSharedRootEntries(entries, ["finance"]).map((e) => e.name)).toEqual(["finance"]);
  });

  it("shows nothing for an empty clearance", () => {
    expect(visibleSharedRootEntries(entries, [])).toEqual([]);
  });
});

/**
 * Review follow-ups. Each of these guards a hole found by adversarial review
 * of the first cut of spec 32.
 */
describe("clearance sanitization", () => {
  it("rejects traversal-shaped group names, which reach path.join in recall", () => {
    expect(isSafeGroupName("../users/victim-at-example.com")).toBe(false);
    expect(isSafeGroupName("..")).toBe(false);
    expect(isSafeGroupName(".")).toBe(false);
    expect(isSafeGroupName("eng/backend")).toBe(false);
    expect(isSafeGroupName("")).toBe(false);
  });

  it("accepts ordinary group slugs", () => {
    expect(isSafeGroupName("all-hands")).toBe(true);
    expect(isSafeGroupName("finance")).toBe(true);
  });

  it("drops unsafe entries rather than throwing", () => {
    expect(sanitizeClearance(["all-hands", "../evil", "finance"])).toEqual(["all-hands", "finance"]);
  });

  it("tolerates a missing or malformed clearance, preserving the never-throws contract", () => {
    expect(sanitizeClearance(undefined)).toEqual([]);
    expect(sanitizeClearance(null)).toEqual([]);
    expect(sanitizeClearance("all-hands")).toEqual([]);
    expect(sanitizeClearance([1, null, "finance"])).toEqual(["finance"]);
  });

  it("grants nothing when a scope carries no clearance at all, instead of throwing", () => {
    const broken = { ownerSlug: "a-at-b.com" } as unknown as MemScope;
    expect(() => isWithinFileReadScope(abs("memory/shared/finance/x.md"), broken)).not.toThrow();
    expect(isWithinFileReadScope(abs("memory/shared/finance/x.md"), broken)).toBe(false);
    expect(isWithinWriteScope(abs("memory/shared/finance/x.md"), broken)).toBe(false);
    expect(isWithinListScope(abs("memory/shared/finance"), broken)).toBe(false);
    // The owner's own subtree does not depend on clearance, so it still works.
    expect(isWithinFileReadScope(abs("memory/users/a-at-b.com/x.md"), broken)).toBe(true);
  });

  it("a traversal group name grants no access even if it appears in clearance", () => {
    const forged = { ownerSlug: "a-at-b.com", clearance: ["../users/other-at-b.com"] };
    expect(isWithinFileReadScope(abs("memory/users/other-at-b.com/x.md"), forged)).toBe(false);
  });
});

describe("legacy flat files", () => {
  const allHands = { ownerSlug: "a-at-b.com", clearance: ["all-hands"] };

  it("are deletable by an all-hands holder, so D32.5's remedy actually exists", () => {
    expect(isWithinDeleteScope(abs("memory/shared/legacy.md"), allHands)).toBe(true);
  });

  it("are still not WRITABLE, so new content always carries a group label", () => {
    expect(isWithinWriteScope(abs("memory/shared/legacy.md"), allHands)).toBe(false);
  });

  it("are not deletable without all-hands", () => {
    expect(isWithinDeleteScope(abs("memory/shared/legacy.md"), { ownerSlug: "a", clearance: [] })).toBe(false);
  });

  it("keeps delete scoped: another group's file is still undeletable", () => {
    expect(isWithinDeleteScope(abs("memory/shared/finance/x.md"), allHands)).toBe(false);
  });
});
