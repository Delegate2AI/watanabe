import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { memList, memRead, memWrite, memDelete } from "./mem-tools";

let dir: string;
const saved = { ...process.env };

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "memtools-"));
  mkdirSync(path.join(dir, "memory", "shared"), { recursive: true });
  process.env.MEMORY_CHECKOUT_DIR = dir;
});
afterEach(() => {
  process.env = { ...saved };
  rmSync(dir, { recursive: true, force: true });
});

const text = (r: { content: { text: string }[] }) => r.content[0].text;

describe("mem tools", () => {
  it("writes then reads a memory file", async () => {
    await memWrite({ path: "memory/shared/x.md", content: "body" });
    expect(text(await memRead({ path: "memory/shared/x.md" }))).toContain("body");
  });

  it("lists memory entries", async () => {
    await memWrite({ path: "memory/shared/x.md", content: "b" });
    expect(text(await memList({ path: "memory/shared" }))).toContain("x.md");
  });

  it("rejects traversal and non-markdown paths", async () => {
    expect(text(await memWrite({ path: "../evil.md", content: "x" }))).toMatch(/outside|denied|invalid/i);
    expect(text(await memWrite({ path: "memory/shared/x.txt", content: "x" }))).toMatch(/markdown|\.md/i);
  });

  it("deletes a memory file", async () => {
    await memWrite({ path: "memory/shared/x.md", content: "b" });
    await memDelete({ path: "memory/shared/x.md" });
    expect(text(await memRead({ path: "memory/shared/x.md" }))).toMatch(/not found|no such/i);
  });

  it("handles write errors without throwing", async () => {
    const sharedPath = path.join(dir, "memory", "shared");
    rmSync(sharedPath, { recursive: true });
    writeFileSync(sharedPath, "blocking file");
    const result = await memWrite({ path: "memory/shared/x.md", content: "x" });
    expect(text(result)).toMatch(/could not write/i);
  });
});

describe("mem tools write scope (dream's bypassPermissions guard)", () => {
  const scope = { ownerSlug: "a-at-b.com", clearance: ["all-hands"] };

  it("allows a scoped write into the owner's own users/ subtree", async () => {
    const result = await memWrite({ path: "memory/users/a-at-b.com/x.md", content: "body" }, scope);
    expect(text(result)).toMatch(/^Wrote/);
    expect(existsSync(path.join(dir, "memory", "users", "a-at-b.com", "x.md"))).toBe(true);
  });

  it("allows a scoped write into the shared subtree", async () => {
    const result = await memWrite({ path: "memory/shared/all-hands/y.md", content: "body" }, scope);
    expect(text(result)).toMatch(/^Wrote/);
    expect(existsSync(path.join(dir, "memory", "shared", "all-hands", "y.md"))).toBe(true);
  });

  it("rejects a scoped write into another user's subtree, and does not write the file", async () => {
    const result = await memWrite({ path: "memory/users/other/z.md", content: "body" }, scope);
    expect(text(result)).toMatch(/outside your writable memory scope|denied/i);
    expect(existsSync(path.join(dir, "memory", "users", "other", "z.md"))).toBe(false);
  });

  it("rejects a scoped delete outside the owner's subtree, and does not delete the file", async () => {
    mkdirSync(path.join(dir, "memory", "users", "other"), { recursive: true });
    writeFileSync(path.join(dir, "memory", "users", "other", "z.md"), "keep me");
    const result = await memDelete({ path: "memory/users/other/z.md" }, scope);
    expect(text(result)).toMatch(/outside your writable memory scope|denied/i);
    expect(existsSync(path.join(dir, "memory", "users", "other", "z.md"))).toBe(true);
  });

  it("leaves unscoped calls (no scope argument) unaffected, for back-compat", async () => {
    const result = await memWrite({ path: "memory/users/other/z.md", content: "body" });
    expect(text(result)).toMatch(/^Wrote/);
  });
});

describe("mem tools write scope with an empty ownerSlug (fail-safe, not fail-open)", () => {
  // A scoped-but-empty slug must NOT degrade into a "memory/users/" prefix
  // that would match every user's subtree, and must NOT be treated the same
  // as "no scope at all" (fully unscoped). It should fail closed: shared/
  // writes still work, every users/ write is denied.
  const emptyScope = { ownerSlug: "", clearance: ["all-hands"] };

  it("still allows a scoped write into the shared subtree", async () => {
    const result = await memWrite({ path: "memory/shared/all-hands/y.md", content: "body" }, emptyScope);
    expect(text(result)).toMatch(/^Wrote/);
    expect(existsSync(path.join(dir, "memory", "shared", "all-hands", "y.md"))).toBe(true);
  });

  it("denies a write into any user's subtree, not just some", async () => {
    const result = await memWrite({ path: "memory/users/someone/z.md", content: "body" }, emptyScope);
    expect(text(result)).toMatch(/outside your writable memory scope|denied/i);
    expect(existsSync(path.join(dir, "memory", "users", "someone", "z.md"))).toBe(false);
  });

  it("denies a delete into any user's subtree", async () => {
    mkdirSync(path.join(dir, "memory", "users", "someone"), { recursive: true });
    writeFileSync(path.join(dir, "memory", "users", "someone", "z.md"), "keep me");
    const result = await memDelete({ path: "memory/users/someone/z.md" }, emptyScope);
    expect(text(result)).toMatch(/outside your writable memory scope|denied/i);
    expect(existsSync(path.join(dir, "memory", "users", "someone", "z.md"))).toBe(true);
  });
});

describe("mem tools read scope (chat recall + dream's own reads)", () => {
  const scope = { ownerSlug: "a-at-b.com", clearance: ["all-hands"] };

  it("allows reading a file in the owner's own users/ subtree", async () => {
    await memWrite({ path: "memory/users/a-at-b.com/x.md", content: "body" });
    const result = await memRead({ path: "memory/users/a-at-b.com/x.md" }, scope);
    expect(text(result)).toBe("body");
  });

  it("allows reading a file in the shared subtree", async () => {
    await memWrite({ path: "memory/shared/all-hands/y.md", content: "body" });
    const result = await memRead({ path: "memory/shared/all-hands/y.md" }, scope);
    expect(text(result)).toBe("body");
  });

  it("rejects reading a file in another user's subtree", async () => {
    await memWrite({ path: "memory/users/other/z.md", content: "secret" });
    const result = await memRead({ path: "memory/users/other/z.md" }, scope);
    expect(text(result)).toMatch(/outside your readable memory scope|denied/i);
    expect(text(result)).not.toContain("secret");
  });

  it("allows listing the memory root (structural only)", async () => {
    const result = await memList({ path: "memory" }, scope);
    expect(text(result)).toMatch(/shared\/|users\//);
  });

  it("allows listing the shared subtree, showing cleared group dirs", async () => {
    await memWrite({ path: "memory/shared/all-hands/y.md", content: "b" });
    const result = await memList({ path: "memory/shared" }, scope);
    expect(text(result)).toContain("all-hands/");
  });

  it("allows listing inside a cleared group dir", async () => {
    await memWrite({ path: "memory/shared/all-hands/y.md", content: "b" });
    const result = await memList({ path: "memory/shared/all-hands" }, scope);
    expect(text(result)).toContain("y.md");
  });

  it("allows listing the owner's own users/ subtree", async () => {
    await memWrite({ path: "memory/users/a-at-b.com/x.md", content: "b" });
    const result = await memList({ path: "memory/users/a-at-b.com" }, scope);
    expect(text(result)).toContain("x.md");
  });

  it("rejects listing the bare users/ directory (blocks enumerating other users' slugs)", async () => {
    await memWrite({ path: "memory/users/a-at-b.com/x.md", content: "b" });
    await memWrite({ path: "memory/users/other/z.md", content: "b" });
    const result = await memList({ path: "memory/users" }, scope);
    expect(text(result)).toMatch(/outside your readable memory scope|denied/i);
    expect(text(result)).not.toContain("other");
  });

  it("rejects listing another user's subtree directly", async () => {
    await memWrite({ path: "memory/users/other/z.md", content: "b" });
    const result = await memList({ path: "memory/users/other" }, scope);
    expect(text(result)).toMatch(/outside your readable memory scope|denied/i);
  });

  it("leaves unscoped calls (no scope argument) unaffected, for back-compat", async () => {
    await memWrite({ path: "memory/users/other/z.md", content: "body" });
    const result = await memRead({ path: "memory/users/other/z.md" });
    expect(text(result)).toBe("body");
  });
});

describe("mem tools read scope with an empty ownerSlug (fail-safe, not fail-open)", () => {
  const emptyScope = { ownerSlug: "", clearance: ["all-hands"] };

  it("still allows reading the shared subtree", async () => {
    await memWrite({ path: "memory/shared/all-hands/y.md", content: "body" });
    const result = await memRead({ path: "memory/shared/all-hands/y.md" }, emptyScope);
    expect(text(result)).toBe("body");
  });

  it("denies reading any user's subtree, not just some", async () => {
    await memWrite({ path: "memory/users/someone/z.md", content: "secret" });
    const result = await memRead({ path: "memory/users/someone/z.md" }, emptyScope);
    expect(text(result)).toMatch(/outside your readable memory scope|denied/i);
  });

  it("denies listing the bare users/ directory", async () => {
    await memWrite({ path: "memory/users/someone/z.md", content: "b" });
    const result = await memList({ path: "memory/users" }, emptyScope);
    expect(text(result)).toMatch(/outside your readable memory scope|denied/i);
  });
});

/**
 * Spec 32: shared memory is group-scoped. Before this, every authenticated
 * user could read all of memory/shared/**, so a fact consolidated out of a
 * restricted-group conversation was readable by everyone.
 */
describe("mem tools clearance scope over shared memory (spec 32)", () => {
  const finance = { ownerSlug: "a-at-b.com", clearance: ["all-hands", "finance"] };
  const allHandsOnly = { ownerSlug: "b-at-b.com", clearance: ["all-hands"] };

  it("denies reading another group's memory and does not leak its contents", async () => {
    await memWrite({ path: "memory/shared/finance/q3.md", content: "revenue-secret" });
    const result = await memRead({ path: "memory/shared/finance/q3.md" }, allHandsOnly);
    expect(text(result)).toMatch(/outside your readable memory scope|denied/i);
    expect(text(result)).not.toContain("revenue-secret");
  });

  it("allows reading a group the caller is cleared for", async () => {
    await memWrite({ path: "memory/shared/finance/q3.md", content: "revenue-secret" });
    expect(text(await memRead({ path: "memory/shared/finance/q3.md" }, finance))).toBe("revenue-secret");
  });

  it("hides uncleared group dirs when listing the shared root, so group names stay unenumerable", async () => {
    await memWrite({ path: "memory/shared/finance/q3.md", content: "b" });
    await memWrite({ path: "memory/shared/all-hands/x.md", content: "b" });
    const result = await memList({ path: "memory/shared" }, allHandsOnly);
    expect(text(result)).toContain("all-hands/");
    expect(text(result)).not.toContain("finance");
  });

  it("denies listing an uncleared group dir", async () => {
    await memWrite({ path: "memory/shared/finance/q3.md", content: "b" });
    const result = await memList({ path: "memory/shared/finance" }, allHandsOnly);
    expect(text(result)).toMatch(/outside your readable memory scope|denied/i);
  });

  it("denies a WRITE into an uncleared group, the dream's bypassPermissions guard", async () => {
    const result = await memWrite(
      { path: "memory/shared/finance/leak.md", content: "x" },
      allHandsOnly,
    );
    expect(text(result)).toMatch(/outside your writable memory scope|denied/i);
    expect(text(await memRead({ path: "memory/shared/finance/leak.md" }, finance))).toMatch(/not found/i);
  });

  it("denies deleting another group's memory", async () => {
    await memWrite({ path: "memory/shared/finance/q3.md", content: "keep" });
    const result = await memDelete({ path: "memory/shared/finance/q3.md" }, allHandsOnly);
    expect(text(result)).toMatch(/outside your writable memory scope|denied/i);
    expect(text(await memRead({ path: "memory/shared/finance/q3.md" }, finance))).toBe("keep");
  });

  it("reports an uncleared group and a nonexistent one identically, so errors are not an oracle", async () => {
    await memWrite({ path: "memory/shared/finance/q3.md", content: "b" });
    // Compare the REASON, not the whole string: the message echoes the
    // caller's own requested path, which tells them nothing they did not
    // already supply. What must not differ is whether the group exists.
    const reason = (t: string) => t.replace(/^Path "[^"]*"/, "");
    const real = reason(text(await memRead({ path: "memory/shared/finance/q3.md" }, allHandsOnly)));
    const fake = reason(text(await memRead({ path: "memory/shared/nosuchgroup/q3.md" }, allHandsOnly)));
    expect(real).toBe(fake);
    expect(real).toMatch(/denied/i);
  });

  it("reads legacy flat shared files as all-hands but refuses to write them", async () => {
    await memWrite({ path: "memory/shared/legacy.md", content: "old-team-fact" });
    expect(text(await memRead({ path: "memory/shared/legacy.md" }, allHandsOnly))).toBe("old-team-fact");
    const write = await memWrite({ path: "memory/shared/new.md", content: "x" }, allHandsOnly);
    expect(text(write)).toMatch(/outside your writable memory scope|denied/i);
  });

  it("grants nothing under shared for an empty clearance", async () => {
    const none = { ownerSlug: "c-at-b.com", clearance: [] };
    await memWrite({ path: "memory/shared/all-hands/x.md", content: "team" });
    await memWrite({ path: "memory/shared/legacy.md", content: "old" });
    expect(text(await memRead({ path: "memory/shared/all-hands/x.md" }, none))).toMatch(/denied/i);
    expect(text(await memRead({ path: "memory/shared/legacy.md" }, none))).toMatch(/denied/i);
  });
});

describe("legacy flat shared files (spec 32 D32.5 remedy)", () => {
  const allHands = { ownerSlug: "a-at-b.com", clearance: ["all-hands"] };

  it("can be deleted so a restricted fact found there can actually be removed", async () => {
    await memWrite({ path: "memory/shared/legacy.md", content: "oops-restricted" });
    expect(text(await memDelete({ path: "memory/shared/legacy.md" }, allHands))).toMatch(/^Deleted/);
    expect(text(await memRead({ path: "memory/shared/legacy.md" }, allHands))).toMatch(/not found/i);
  });

  it("still cannot be overwritten in place", async () => {
    await memWrite({ path: "memory/shared/legacy.md", content: "original" });
    expect(text(await memWrite({ path: "memory/shared/legacy.md", content: "new" }, allHands))).toMatch(/denied/i);
    expect(text(await memRead({ path: "memory/shared/legacy.md" }, allHands))).toBe("original");
  });
});

describe("mem tools tolerate a scope with no clearance (never-throws contract)", () => {
  const broken = { ownerSlug: "a-at-b.com" } as unknown as Parameters<typeof memRead>[1];

  it("denies rather than rejecting", async () => {
    await memWrite({ path: "memory/shared/finance/x.md", content: "secret" });
    await expect(memRead({ path: "memory/shared/finance/x.md" }, broken)).resolves.toBeDefined();
    expect(text(await memRead({ path: "memory/shared/finance/x.md" }, broken))).toMatch(/denied/i);
    expect(text(await memList({ path: "memory/shared/finance" }, broken))).toMatch(/denied/i);
    expect(text(await memWrite({ path: "memory/shared/finance/y.md", content: "x" }, broken))).toMatch(/denied/i);
    expect(text(await memDelete({ path: "memory/shared/finance/x.md" }, broken))).toMatch(/denied/i);
  });

  it("still lists the shared root without throwing", async () => {
    await memWrite({ path: "memory/shared/finance/x.md", content: "b" });
    const result = await memList({ path: "memory/shared" }, broken);
    expect(text(result)).not.toContain("finance");
  });
});
