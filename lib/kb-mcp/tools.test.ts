import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { kbList, kbRead, kbSearch } from "./tools";

// Fixture vault: a real temp directory on disk, pointed at via
// LOCAL_REPO_PATH + VAULT_SUBDIR="." (the same env-var contract lib/repo.ts's
// vaultRoot() uses everywhere else — see lib/repo.test.ts / permissions.test.ts
// for the same pattern). Exercises the tool HANDLERS directly, not through the
// SDK query loop, per the task's acceptance criteria.

const ENV_KEYS = ["LOCAL_REPO_PATH", "REPO_READ_TOKEN", "VAULT_SUBDIR"] as const;
let savedEnv: Record<string, string | undefined>;
let vaultDir: string;

function write(relPath: string, content: string): void {
  const abs = path.join(vaultDir, relPath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
}

beforeEach(() => {
  savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  vaultDir = fs.mkdtempSync(path.join(os.tmpdir(), "kb-mcp-vault-"));
  process.env.LOCAL_REPO_PATH = vaultDir;
  process.env.VAULT_SUBDIR = ".";
  delete process.env.REPO_READ_TOKEN;

  write("README.md", "# Meridian KB\nOrbit is the ecosystem.\n");
  write("00-overview/vision.md", "line one\nThe Orbit vision is bold.\nline three\n");
  write("04-economy/tokenomics.md", "Tokenomics v7.0 discussion.\nOrbit tokens explained.\n");
  write(".obsidian/workspace.json", '{"ignored": true}');
  write("assets/data/chart.json", '{"ignored": true}');
  write("assets/source/raw.csv", "ignored,data\n");
  write("node_modules/left-pad/index.js", "// ignored");
});

afterEach(() => {
  fs.rmSync(vaultDir, { recursive: true, force: true });
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

function text(result: Awaited<ReturnType<typeof kbList>>): string {
  const block = result.content[0];
  if (!block || block.type !== "text") throw new Error("expected a text content block");
  return block.text;
}

describe("kbList", () => {
  it("lists the vault root non-recursively, excluding ignored dirs", async () => {
    const result = await kbList({});
    expect(result.isError).toBeFalsy();
    const out = text(result);
    expect(out).toContain("README.md");
    expect(out).toContain("00-overview");
    expect(out).toContain("04-economy");
    expect(out).not.toContain(".obsidian");
    expect(out).not.toContain("node_modules");
    // non-recursive: nested file must not appear
    expect(out).not.toContain("vision.md");
  });

  it("lists a subdirectory by relative path", async () => {
    const result = await kbList({ path: "00-overview" });
    expect(result.isError).toBeFalsy();
    expect(text(result)).toContain("vision.md");
  });

  it("lists recursively when requested, still excluding ignored dirs", async () => {
    const result = await kbList({ recursive: true });
    expect(result.isError).toBeFalsy();
    const out = text(result);
    expect(out).toContain("vision.md");
    expect(out).toContain("tokenomics.md");
    expect(out).not.toContain("assets/data");
    expect(out).not.toContain("assets/source");
    expect(out).not.toContain(".obsidian");
    expect(out).not.toContain("node_modules");
  });

  it("rejects a path that resolves outside the vault", async () => {
    const result = await kbList({ path: "../../etc" });
    expect(result.isError).toBe(true);
    expect(text(result).toLowerCase()).toContain("outside");
  });

  it("rejects an absolute path outside the vault", async () => {
    const result = await kbList({ path: "/etc" });
    expect(result.isError).toBe(true);
  });

  it("errors clearly when the path does not exist", async () => {
    const result = await kbList({ path: "does-not-exist" });
    expect(result.isError).toBe(true);
  });

  it("errors when the path is a file, not a directory", async () => {
    const result = await kbList({ path: "README.md" });
    expect(result.isError).toBe(true);
    expect(text(result)).toContain("kb_read");
  });
});

describe("kbRead", () => {
  it("returns a known file's contents", async () => {
    const result = await kbRead({ path: "README.md" });
    expect(result.isError).toBeFalsy();
    expect(text(result)).toContain("Orbit is the ecosystem.");
  });

  it("reads a nested file by relative path", async () => {
    const result = await kbRead({ path: "04-economy/tokenomics.md" });
    expect(result.isError).toBeFalsy();
    expect(text(result)).toContain("Tokenomics v7.0");
  });

  it("uses an explicit session root instead of the process-wide vault", async () => {
    const projection = fs.mkdtempSync(path.join(os.tmpdir(), "kb-mcp-projection-"));
    fs.writeFileSync(path.join(projection, "visible.md"), "projection-only content");
    try {
      const visible = await kbRead({ path: "visible.md" }, projection);
      const hidden = await kbRead({ path: "README.md" }, projection);
      expect(text(visible)).toContain("projection-only content");
      expect(hidden.isError).toBe(true);
    } finally {
      fs.rmSync(projection, { recursive: true, force: true });
    }
  });

  it("rejects a path outside the vault", async () => {
    const result = await kbRead({ path: "../outside.md" });
    expect(result.isError).toBe(true);
    expect(text(result).toLowerCase()).toContain("outside");
  });

  it("rejects an absolute path outside the vault", async () => {
    const result = await kbRead({ path: "/etc/passwd" });
    expect(result.isError).toBe(true);
  });

  it("rejects a direct read of an ignored path (.obsidian), even though it's inside the vault", async () => {
    const result = await kbRead({ path: ".obsidian/workspace.json" });
    expect(result.isError).toBe(true);
    expect(text(result).toLowerCase()).toContain("ignored");
  });

  it("rejects a direct read under other ignored prefixes (assets/data)", async () => {
    const result = await kbRead({ path: "assets/data/chart.json" });
    expect(result.isError).toBe(true);
  });

  it("rejects an empty path", async () => {
    const result = await kbRead({ path: "" });
    expect(result.isError).toBe(true);
  });

  it("errors clearly for a missing file", async () => {
    const result = await kbRead({ path: "nope.md" });
    expect(result.isError).toBe(true);
  });

  it("errors when the path is a directory", async () => {
    const result = await kbRead({ path: "00-overview" });
    expect(result.isError).toBe(true);
  });

  it("rejects a known binary extension without reading it", async () => {
    write("image.png", "\x89PNG-not-really-but-has-the-extension");
    const result = await kbRead({ path: "image.png" });
    expect(result.isError).toBe(true);
    expect(text(result).toLowerCase()).toContain("binary");
  });

  it("rejects a file containing a NUL byte even with an unknown extension", async () => {
    const abs = path.join(vaultDir, "mystery.bin");
    fs.writeFileSync(abs, Buffer.from([0x00, 0x01, 0x02, 0x03]));
    const result = await kbRead({ path: "mystery.bin" });
    expect(result.isError).toBe(true);
  });

  it("rejects a file over the 1MB cap", async () => {
    write("huge.md", "x".repeat(1_048_577));
    const result = await kbRead({ path: "huge.md" });
    expect(result.isError).toBe(true);
    expect(text(result)).toContain("1048576");
  });
});

describe("kbSearch", () => {
  it("finds a known string across the vault, with file + line snippets", async () => {
    const result = await kbSearch({ query: "Orbit" });
    expect(result.isError).toBeFalsy();
    const out = text(result);
    expect(out).toContain("README.md");
    expect(out).toContain("vision.md");
    expect(out).toContain("tokenomics.md");
  });

  it("is case-insensitive", async () => {
    const result = await kbSearch({ query: "orbit vision" });
    expect(result.isError).toBeFalsy();
    expect(text(result)).toContain("vision.md");
  });

  it("scopes the search to a subdirectory", async () => {
    const result = await kbSearch({ query: "Orbit", path: "00-overview" });
    expect(result.isError).toBeFalsy();
    const out = text(result);
    expect(out).toContain("vision.md");
    expect(out).not.toContain("README.md");
    expect(out).not.toContain("tokenomics.md");
  });

  it("never searches ignored directories", async () => {
    write(".obsidian/secret.md", "Orbit-should-not-be-found-here");
    const result = await kbSearch({ query: "should-not-be-found" });
    expect(result.isError).toBeFalsy();
    expect(text(result).toLowerCase()).toContain("no matches");
  });

  it("returns a clear no-matches message", async () => {
    const result = await kbSearch({ query: "definitely-not-present-xyz" });
    expect(result.isError).toBeFalsy();
    expect(text(result).toLowerCase()).toContain("no matches");
  });

  it("rejects an out-of-vault scope", async () => {
    const result = await kbSearch({ query: "root", path: "/etc" });
    expect(result.isError).toBe(true);
    expect(text(result).toLowerCase()).toContain("outside");
  });

  it("rejects an empty query", async () => {
    const result = await kbSearch({ query: "" });
    expect(result.isError).toBe(true);
  });
});
