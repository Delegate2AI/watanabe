import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_SKILL_DEPTH, scanSkillDir } from "./scan";

/**
 * One directory whose `readdirSync` fails, used to exercise the never-throws
 * contract without depending on filesystem permissions. The permission-bit
 * version of that test skipped itself whenever the process was root, which is
 * exactly the case in CI (the test job runs `node:22-slim` with no privilege
 * drop anywhere in the pipeline), so the contract went unchecked in the one
 * environment that gates merges. Everything else on `node:fs` is the real
 * thing, including the calls this file makes to build its own fixtures.
 */
const unreadable = vi.hoisted(() => ({ dir: null as string | null }));

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    readdirSync: ((dir: never, options: never) => {
      if (unreadable.dir !== null && String(dir) === unreadable.dir) {
        throw Object.assign(new Error(`EACCES: permission denied, scandir '${unreadable.dir}'`), {
          code: "EACCES",
        });
      }
      return actual.readdirSync(dir, options);
    }) as typeof actual.readdirSync,
  };
});

/**
 * The walk is the security half of validation: it is what keeps a hostile
 * folder from reading outside itself or from taking the process down. Those
 * behaviors are pinned here rather than only through validateSkillDir, which
 * cannot reach the deeper ones.
 */
const CAPS = { maxBytes: 1_000_000, maxFiles: 500 };

describe("scanSkillDir", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(path.join(os.tmpdir(), "skill-scan-"));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  function write(rel: string, content: string): void {
    const abs = path.join(root, rel);
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, content);
  }

  function expectFail(result: ReturnType<typeof scanSkillDir>): string {
    if (result.ok) throw new Error("expected the scan to fail");
    return result.reason;
  }

  it("returns sorted posix relative paths with sizes and the executable bit", () => {
    write("SKILL.md", "hello");
    write("scripts/run.sh", "echo hi\n");
    chmodSync(path.join(root, "scripts/run.sh"), 0o755);

    const result = scanSkillDir(root, CAPS);

    expect(result).toEqual({
      ok: true,
      // localeCompare order, so "scripts/..." sorts before "SKILL.md".
      files: [
        { rel: "scripts/run.sh", bytes: 8, executable: true },
        { rel: "SKILL.md", bytes: 5, executable: false },
      ],
    });
  });

  it("rejects a tree nested past the depth cap", () => {
    const deep = Array.from({ length: MAX_SKILL_DEPTH + 2 }, (_, i) => `d${i}`).join(path.sep);
    write(path.join(deep, "buried.md"), "x");

    expect(expectFail(scanSkillDir(root, CAPS))).toContain("nested too deeply");
  });

  it("accepts a tree that sits exactly on the depth cap", () => {
    const deep = Array.from({ length: MAX_SKILL_DEPTH }, (_, i) => `d${i}`).join(path.sep);
    write(path.join(deep, "buried.md"), "x");

    const result = scanSkillDir(root, CAPS);

    expect(result.ok).toBe(true);
  });

  it("rejects a symlink nested below the root, not only one at the root", () => {
    write("SKILL.md", "hello");
    write("references/notes.md", "x");
    symlinkSync("/etc/hosts", path.join(root, "references", "hosts"));

    expect(expectFail(scanSkillDir(root, CAPS))).toContain("symlink not allowed");
  });

  it("names the offending symlink by its relative path, never an outside target", () => {
    write("SKILL.md", "hello");
    symlinkSync("/etc/hosts", path.join(root, "references-hosts"));

    const reason = expectFail(scanSkillDir(root, CAPS));

    expect(reason).toContain("references-hosts");
    expect(reason).not.toContain("/etc/hosts");
  });

  it("rejects an entry that is neither a regular file nor a directory", async () => {
    write("SKILL.md", "hello");
    const socketPath = path.join(root, "listener.sock");
    const server = net.createServer();
    await new Promise<void>((resolve) => server.listen(socketPath, resolve));
    try {
      expect(expectFail(scanSkillDir(root, CAPS))).toContain("not a regular file");
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("reports an unreadable directory instead of throwing", () => {
    write("SKILL.md", "hello");
    write("locked/inner.md", "x");
    unreadable.dir = path.join(root, "locked");
    try {
      expect(expectFail(scanSkillDir(root, CAPS))).toContain("unreadable directory");
    } finally {
      unreadable.dir = null;
    }
  });

  it("counts directories against the file cap", () => {
    write("a/one.md", "x");
    write("b/two.md", "x");

    expect(expectFail(scanSkillDir(root, { ...CAPS, maxFiles: 3 }))).toContain("too many files");
  });

  it("stops as soon as the byte budget is exceeded", () => {
    write("a.bin", "x".repeat(400));
    write("b.bin", "x".repeat(400));

    expect(expectFail(scanSkillDir(root, { ...CAPS, maxBytes: 500 }))).toContain("too large");
  });

  it("returns an empty file list for an empty directory", () => {
    expect(scanSkillDir(root, CAPS)).toEqual({ ok: true, files: [] });
  });
});
