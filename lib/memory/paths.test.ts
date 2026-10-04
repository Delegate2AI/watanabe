import { afterEach, describe, expect, it } from "vitest";
import path from "node:path";
import { emailSlug, resolveInMemory, sharedGroupIndexPath, sharedIndexPath, userDir, userIndexPath } from "./paths";

const saved = { ...process.env };
afterEach(() => {
  process.env = { ...saved };
});

describe("memory paths", () => {
  it("slugifies emails to filesystem-safe tokens", () => {
    expect(emailSlug("Jane.Doe+kb@Example.com")).toBe("jane.doe-kb-at-example.com");
  });

  it("builds shared and per-user index paths under the worktree", () => {
    process.env.MEMORY_CHECKOUT_DIR = "/tmp/mem";
    // Inside memory/shared/, not memory/MEMORY.md: the latter is outside the
    // tool layer's writable scope, so no dream could ever update it.
    expect(sharedIndexPath()).toBe(path.join("/tmp/mem", "memory", "shared", "MEMORY.md"));
    expect(sharedGroupIndexPath("finance")).toBe(
      path.join("/tmp/mem", "memory", "shared", "finance", "MEMORY.md"),
    );
    expect(userDir("a@b.com")).toBe(path.join("/tmp/mem", "memory", "users", "a-at-b.com"));
    expect(userIndexPath("a@b.com")).toBe(path.join("/tmp/mem", "memory", "users", "a-at-b.com", "MEMORY.md"));
  });

  it("resolveInMemory rejects traversal and absolute escapes", () => {
    process.env.MEMORY_CHECKOUT_DIR = "/tmp/mem";
    expect(resolveInMemory("memory/shared/x.md")).toBe(path.join("/tmp/mem", "memory", "shared", "x.md"));
    expect(resolveInMemory("../escape.md")).toBeNull();
    expect(resolveInMemory("/etc/passwd")).toBeNull();
  });
});
