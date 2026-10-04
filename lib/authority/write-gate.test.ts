import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { effectiveCanWrite } from "./write-gate";
import { getConfig } from "@/lib/config";

let memoryRoot: string;
const savedEnv = { ...process.env };

beforeEach(() => {
  memoryRoot = mkdtempSync(path.join(os.tmpdir(), "write-gate-"));
  mkdirSync(path.join(memoryRoot, "access"), { recursive: true });
  writeFileSync(
    path.join(memoryRoot, "access", "roles.yaml"),
    "roles:\n  editor: [editor@example.com]\n  admin: [admin@example.com]\ndefault: viewer\n",
  );
  process.env.MEMORY_CHECKOUT_DIR = memoryRoot;
  process.env.KB_WRITE_ENABLED = "1";
  process.env.ROLES_ENABLED = "1";
});

afterEach(() => {
  process.env = { ...savedEnv };
  rmSync(memoryRoot, { recursive: true, force: true });
});

describe("effectiveCanWrite", () => {
  it("denies viewers and allows editors when both flags are on", () => {
    expect(effectiveCanWrite("viewer@example.com")).toBe(false);
    expect(effectiveCanWrite("editor@example.com")).toBe(true);
  });

  it("denies every role when the master switch is off, including admin and the bot", () => {
    process.env.KB_WRITE_ENABLED = "0";
    expect(effectiveCanWrite("editor@example.com")).toBe(false);
    expect(effectiveCanWrite("admin@example.com")).toBe(false);
    // The implicit-admin portal bot is not exempt from the master kill switch.
    expect(effectiveCanWrite(getConfig().git.botEmail)).toBe(false);
  });

  it("preserves today's master-switch behavior when roles are off", () => {
    process.env.ROLES_ENABLED = "0";
    expect(effectiveCanWrite("viewer@example.com")).toBe(true);
  });
});
