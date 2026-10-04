import { afterEach, describe, expect, it } from "vitest";
import { isMemoryEnabled, MEMORY_BRANCH, memoryWorktreeDir } from "./config";

const saved = { ...process.env };
afterEach(() => {
  process.env = { ...saved };
});

describe("memory config", () => {
  it("isMemoryEnabled is true only when MEMORY_ENABLED=1", () => {
    process.env.MEMORY_ENABLED = "1";
    expect(isMemoryEnabled()).toBe(true);
    process.env.MEMORY_ENABLED = "0";
    expect(isMemoryEnabled()).toBe(false);
    delete process.env.MEMORY_ENABLED;
    expect(isMemoryEnabled()).toBe(false);
  });

  it("branch name is portal-memory", () => {
    expect(MEMORY_BRANCH).toBe("portal-memory");
  });

  it("memoryWorktreeDir honors MEMORY_CHECKOUT_DIR override", () => {
    process.env.MEMORY_CHECKOUT_DIR = "/tmp/mem-test";
    expect(memoryWorktreeDir()).toBe("/tmp/mem-test");
  });
});
