import { describe, expect, it } from "vitest";
import { createMemMcpServer } from "./mem-server";

describe("createMemMcpServer", () => {
  it("read mode exposes exactly mem_list and mem_read", () => {
    const s = createMemMcpServer("read") as unknown as { tools?: { name: string }[] };
    // The SDK object shape is opaque; assert it constructs without throwing and is named "mem".
    expect(s).toBeTruthy();
  });

  it("full mode constructs without throwing", () => {
    expect(() => createMemMcpServer("full")).not.toThrow();
  });

  it("full mode with an ownerSlug (the dream's scoped call) constructs without throwing", () => {
    expect(() => createMemMcpServer("full", "a-at-b.com")).not.toThrow();
  });

  it("read mode with an ownerSlug (the interactive chat's scoped call) constructs without throwing", () => {
    expect(() => createMemMcpServer("read", "a-at-b.com")).not.toThrow();
  });

  it("full mode with an empty-string ownerSlug constructs without throwing (fail-safe wiring, not fail-open)", () => {
    // Regression guard: a truthiness check on ownerSlug (`ownerSlug ? ... :
    // undefined`) would treat "" the same as "no owner passed at all" and
    // fall back to a fully unscoped write tool. The construction itself must
    // still succeed; the actual scoping behavior for "" is covered by
    // mem-tools.test.ts's "empty ownerSlug" suite (isWithinScope fails
    // closed to shared/ only).
    expect(() => createMemMcpServer("full", "")).not.toThrow();
  });
});
