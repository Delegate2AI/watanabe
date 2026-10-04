import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ensureWorktreeMock = vi.fn();
const submitMock = vi.fn();
const discardMock = vi.fn();
let worktreeRoot: string;
vi.mock("@/lib/repo-write", () => ({
  ensureWorktree: (...args: unknown[]) => ensureWorktreeMock(...args),
  submit: (...args: unknown[]) => submitMock(...args),
  discard: (...args: unknown[]) => discardMock(...args),
  worktreeVaultRoot: () => worktreeRoot,
}));

import { setNoteVisibility } from "./set-visibility";

const ADMIN = "admin@example.com";

function frontmatter(file: string): string[] {
  const content = readFileSync(file, "utf8");
  const body = content.match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1] ?? "";
  return body.split("\n").filter((l) => l.trim().startsWith("- ")).map((l) => l.replace(/^\s*-\s*/, "").trim());
}

describe("setNoteVisibility", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(path.join(os.tmpdir(), "set-visibility-"));
    worktreeRoot = path.join(root, "docs");
    mkdirSync(path.join(root, "access"), { recursive: true });
    mkdirSync(path.join(worktreeRoot, "09-finance"), { recursive: true });
    writeFileSync(path.join(root, "access", "groups.yaml"), "groups:\n  exec: [e@example.com]\n  finance: [f@example.com]\n");
    writeFileSync(path.join(root, "access", "roles.yaml"), "roles:\n  admin: [admin@example.com]\ndefault: viewer\n");
    writeFileSync(
      path.join(worktreeRoot, "09-finance", "fees.md"),
      "---\ntitle: Fees\ntype: note\nvisibility:\n  - all-hands\n---\n\nBody\n",
    );
    writeFileSync(
      path.join(worktreeRoot, "09-finance", "model.md"),
      "---\ntitle: Model\nvisibility: all-hands\n---\n\nBody\n",
    );
    process.env.AUTHORITY_ENABLED = "1";
    process.env.ROLES_ENABLED = "1";
    process.env.KB_ACCESS_UI_ENABLED = "1";
    process.env.KB_WRITE_MODE = "direct";
    process.env.REPO_WRITE_TOKEN = "test-token";
    ensureWorktreeMock.mockReset().mockResolvedValue(root);
    submitMock.mockReset().mockResolvedValue({ ok: true, branch: "main" });
    discardMock.mockReset().mockResolvedValue(undefined);
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
    delete process.env.AUTHORITY_ENABLED;
    delete process.env.ROLES_ENABLED;
    delete process.env.KB_ACCESS_UI_ENABLED;
    delete process.env.KB_WRITE_MODE;
    delete process.env.REPO_WRITE_TOKEN;
  });

  it("rewrites a single non-meeting note's visibility", async () => {
    const result = await setNoteVisibility("09-finance/fees.md", ["exec"], ADMIN, { accessRoot: root });
    expect(result.ok).toBe(true);
    expect(result.count).toBe(1);
    expect(frontmatter(path.join(worktreeRoot, "09-finance", "fees.md"))).toEqual(["exec"]);
    expect(submitMock).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ mode: "direct" }));
  });

  it("bulk-applies to every .md under a folder in one submit", async () => {
    const result = await setNoteVisibility("09-finance", ["finance"], ADMIN, { accessRoot: root });
    expect(result.ok).toBe(true);
    expect(result.count).toBe(2);
    expect(frontmatter(path.join(worktreeRoot, "09-finance", "fees.md"))).toEqual(["finance"]);
    expect(frontmatter(path.join(worktreeRoot, "09-finance", "model.md"))).toEqual(["finance"]);
    expect(submitMock).toHaveBeenCalledTimes(1);
  });

  it("rejects a non-existent group", async () => {
    const result = await setNoteVisibility("09-finance/fees.md", ["nope"], ADMIN, { accessRoot: root });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/visibility/i);
    expect(submitMock).not.toHaveBeenCalled();
  });

  it("rejects a reserved prototype key as a group", async () => {
    const result = await setNoteVisibility("09-finance/fees.md", ["__proto__"], ADMIN, { accessRoot: root });
    expect(result.ok).toBe(false);
    expect(submitMock).not.toHaveBeenCalled();
  });

  it("skips an unparseable file in folder mode, reports it, still commits the rest", async () => {
    writeFileSync(path.join(worktreeRoot, "09-finance", "broken.md"), "no frontmatter here\n");
    const result = await setNoteVisibility("09-finance", ["exec"], ADMIN, { accessRoot: root });
    expect(result.ok).toBe(true);
    expect(result.count).toBe(2);
    expect(result.skipped).toContain("09-finance/broken.md");
  });

  it("is forbidden for a non-admin", async () => {
    const result = await setNoteVisibility("09-finance/fees.md", ["exec"], "nobody@example.com", { accessRoot: root });
    expect(result.ok).toBe(false);
    expect(result.error).toBe("forbidden");
  });

  it("is feature-disabled when authority is off", async () => {
    delete process.env.AUTHORITY_ENABLED;
    const result = await setNoteVisibility("09-finance/fees.md", ["exec"], ADMIN, { accessRoot: root });
    expect(result.ok).toBe(false);
    expect(result.error).toBe("feature disabled");
  });

  it("refuses path traversal outside the vault", async () => {
    const result = await setNoteVisibility("../access/roles.yaml", ["exec"], ADMIN, { accessRoot: root });
    expect(result.ok).toBe(false);
    expect(submitMock).not.toHaveBeenCalled();
  });
});
