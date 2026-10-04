import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { groupsFilePath, isAuthorityEnabled } from "./config";

const saved = { ...process.env };

afterEach(() => {
  process.env = { ...saved };
});

describe("authority config", () => {
  it("is enabled only when AUTHORITY_ENABLED is exactly 1", () => {
    process.env.AUTHORITY_ENABLED = "1";
    expect(isAuthorityEnabled()).toBe(true);
    process.env.AUTHORITY_ENABLED = "0";
    expect(isAuthorityEnabled()).toBe(false);
    process.env.AUTHORITY_ENABLED = "true";
    expect(isAuthorityEnabled()).toBe(false);
    delete process.env.AUTHORITY_ENABLED;
    expect(isAuthorityEnabled()).toBe(false);
  });

  it("resolves groups.yaml inside the memory worktree", () => {
    process.env.MEMORY_CHECKOUT_DIR = "/tmp/authority-memory";
    expect(groupsFilePath()).toBe(path.join("/tmp/authority-memory", "access", "groups.yaml"));
  });
});
