import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { gateAgentTool } from "./permissions";

const SUBMIT_TOOL = "mcp__kb__kb_submit";
let memoryRoot: string;
const savedEnv = { ...process.env };

beforeEach(() => {
  memoryRoot = mkdtempSync(path.join(os.tmpdir(), "permissions-roles-"));
  mkdirSync(path.join(memoryRoot, "access"), { recursive: true });
  writeFileSync(
    path.join(memoryRoot, "access", "roles.yaml"),
    "roles:\n  editor: [editor@example.com]\ndefault: viewer\n",
  );
  process.env.MEMORY_CHECKOUT_DIR = memoryRoot;
  process.env.KB_WRITE_ENABLED = "1";
  process.env.ROLES_ENABLED = "1";
});

afterEach(() => {
  process.env = { ...savedEnv };
  rmSync(memoryRoot, { recursive: true, force: true });
});

describe("role-aware write tool gate", () => {
  it("denies a viewer and confirm-gates an editor", () => {
    expect(gateAgentTool(SUBMIT_TOOL, {}, "thread-1", "/repo", "viewer@example.com")).toBe("deny");
    expect(gateAgentTool(SUBMIT_TOOL, {}, "thread-1", "/repo", "editor@example.com")).toBe("confirm");
  });

  it("keeps the master switch authoritative", () => {
    process.env.KB_WRITE_ENABLED = "0";
    expect(gateAgentTool(SUBMIT_TOOL, {}, "thread-1", "/repo", "editor@example.com")).toBe("deny");
  });

  it("preserves existing behavior when roles are off", () => {
    process.env.ROLES_ENABLED = "0";
    expect(gateAgentTool(SUBMIT_TOOL, {}, "thread-1", "/repo", "viewer@example.com")).toBe("confirm");
  });

  it.each(["mcp__kb__kb_stage_move", "mcp__kb__kb_check"])(
    "denies a viewer and allows an editor for %s",
    (tool) => {
      expect(gateAgentTool(tool, {}, "thread-1", "/repo", "viewer@example.com")).toBe("deny");
      expect(gateAgentTool(tool, {}, "thread-1", "/repo", "editor@example.com")).toBe("allow");
    },
  );
});
