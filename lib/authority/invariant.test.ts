import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { IndexMap } from "@/lib/index/build";
import { buildIndex } from "@/lib/index/build";
import { gateAgentTool } from "@/lib/agent/permissions";
import { kbList, kbRead, kbSearch } from "@/lib/kb-mcp/tools";
import { readVaultFile } from "@/lib/vault";
import { vaultRootFor } from "@/lib/repo";
import { clearProjectionCacheForTests } from "./cache";
import { buildBacklinkGraph } from "./backlinks";

function resultText(result: Awaited<ReturnType<typeof kbRead>>): string {
  const block = result.content[0];
  if (!block || block.type !== "text") throw new Error("expected text result");
  return block.text;
}

describe("content visibility invariant", () => {
  let vault: string;
  let memory: string;
  let projections: string;
  const savedEnv = { ...process.env };

  beforeEach(() => {
    clearProjectionCacheForTests();
    vault = mkdtempSync(path.join(os.tmpdir(), "authority-invariant-vault-"));
    memory = mkdtempSync(path.join(os.tmpdir(), "authority-invariant-memory-"));
    projections = mkdtempSync(path.join(os.tmpdir(), "authority-invariant-projections-"));
    mkdirSync(path.join(memory, "access"), { recursive: true });
    writeFileSync(path.join(memory, "access", "groups.yaml"), "groups:\n  exec: [exec@example.com]\n");
    writeFileSync(
      path.join(vault, "public.md"),
      "---\ntitle: Public handbook\n---\nPublic body. See [Executive Nebula](exec.md).\n",
    );
    writeFileSync(
      path.join(vault, "exec.md"),
      "---\ntitle: Executive Nebula\nvisibility: exec\n---\nquasar-secret-body\n",
    );
    mkdirSync(path.join(vault, "exec-offsite"));
    writeFileSync(
      path.join(vault, "exec-offsite", "agenda.md"),
      "---\ntitle: Executive Offsite\nvisibility: exec\n---\nrestricted-agenda\n",
    );
    process.env.AUTHORITY_ENABLED = "1";
    process.env.LOCAL_REPO_PATH = vault;
    process.env.VAULT_SUBDIR = ".";
    process.env.AUTHORITY_PROJECTION_DIR = projections;
    process.env.MEMORY_CHECKOUT_DIR = memory;
    delete process.env.REPO_READ_TOKEN;
  });

  afterEach(() => {
    clearProjectionCacheForTests();
    process.env = { ...savedEnv };
    rmSync(vault, { recursive: true, force: true });
    rmSync(memory, { recursive: true, force: true });
    rmSync(projections, { recursive: true, force: true });
  });

  it("keeps an exec note absent from every all-hands read surface", async () => {
    const allHands = vaultRootFor(["all-hands"]);
    const exec = vaultRootFor(["all-hands", "exec"]);

    expect(() => readFileSync(path.join(allHands, "exec.md"), "utf8")).toThrow();
    expect(resultText(await kbRead({ path: "exec.md" }, allHands))).toContain("No such file");
    expect(resultText(await kbSearch({ query: "quasar-secret-body" }, allHands))).toContain("No matches");
    expect(resultText(await kbSearch({ query: "Executive Nebula" }, allHands))).toContain("No matches");
    expect(gateAgentTool("Grep", { path: path.join(vault, "exec.md") }, "thread", allHands)).toBe("deny");
    expect(readVaultFile("exec.md", allHands)).toBeNull();
    expect(existsSync(path.join(allHands, "exec-offsite"))).toBe(false);
    expect(resultText(await kbList({}, allHands))).not.toContain("exec-offsite");

    expect(resultText(await kbRead({ path: "exec.md" }, exec))).toContain("quasar-secret-body");
    expect(resultText(await kbSearch({ query: "quasar-secret-body" }, exec))).toContain("exec.md");
    expect(readVaultFile("exec.md", exec)).toContain("quasar-secret-body");

    const index = buildIndex(allHands) as IndexMap;
    const backlinks = JSON.stringify(buildBacklinkGraph(allHands));
    expect(JSON.stringify(index)).not.toContain("exec.md");
    expect(JSON.stringify(index)).not.toContain("Executive Nebula");
    expect(backlinks).not.toContain("exec.md");
  });
});
