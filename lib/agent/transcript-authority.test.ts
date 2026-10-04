import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearProjectionCacheForTests } from "@/lib/authority/cache";
import { vaultRootFor } from "@/lib/repo";

const storedMessages = new Map<string, unknown[]>();

vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  getSessionMessages: vi.fn(async (_sessionId: string, options: { dir: string }) =>
    storedMessages.get(options.dir) ?? [],
  ),
}));

const { loadTranscript } = await import("./transcript");

describe("authority transcript storage", () => {
  let vault: string;
  let memory: string;
  let projections: string;
  const savedEnv = { ...process.env };

  beforeEach(() => {
    clearProjectionCacheForTests();
    storedMessages.clear();
    vault = mkdtempSync(path.join(os.tmpdir(), "authority-transcript-vault-"));
    memory = mkdtempSync(path.join(os.tmpdir(), "authority-transcript-memory-"));
    projections = mkdtempSync(path.join(os.tmpdir(), "authority-transcript-projections-"));
    mkdirSync(path.join(vault, ".git", "refs", "heads"), { recursive: true });
    writeFileSync(path.join(vault, ".git", "HEAD"), "ref: refs/heads/main\n");
    writeFileSync(path.join(vault, ".git", "refs", "heads", "main"), "sha-before\n");
    writeFileSync(path.join(vault, "exec.md"), "---\nvisibility: exec\n---\nBefore\n");
    mkdirSync(path.join(memory, "access"), { recursive: true });
    writeFileSync(path.join(memory, "access", "groups.yaml"), "groups:\n  exec: [exec@example.com]\n");
    process.env.AUTHORITY_ENABLED = "1";
    process.env.LOCAL_REPO_PATH = vault;
    process.env.VAULT_SUBDIR = ".";
    process.env.AUTHORITY_PROJECTION_DIR = projections;
    process.env.MEMORY_CHECKOUT_DIR = memory;
  });

  afterEach(() => {
    clearProjectionCacheForTests();
    process.env = { ...savedEnv };
    rmSync(vault, { recursive: true, force: true });
    rmSync(memory, { recursive: true, force: true });
    rmSync(projections, { recursive: true, force: true });
  });

  it("loads a non-all-hands session after the vault SHA changes", async () => {
    const clearance = ["all-hands", "exec"];
    const writeRoot = vaultRootFor(clearance);
    storedMessages.set(writeRoot, [
      {
        type: "user",
        uuid: "user-1",
        session_id: "session-1",
        message: { content: "Prior exec message" },
        parent_tool_use_id: null,
      },
    ]);

    writeFileSync(path.join(vault, "new.md"), "New public note\n");
    writeFileSync(path.join(vault, ".git", "refs", "heads", "main"), "sha-after\n");

    const turns = await loadTranscript("session-1", clearance);

    expect(vaultRootFor(clearance)).toBe(writeRoot);
    expect(turns).toEqual([{ id: "user-1", role: "user", content: "Prior exec message" }]);
  });
});
