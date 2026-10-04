import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { invalidateSkillRegistryCache } from "@/lib/skills/registry";
import { gateBashCommand } from "./bash-policy";
import { gateAgentTool } from "./permissions";

/**
 * Spec 34's skill-script carve-out, seen through the gate itself. The matcher's
 * own cases live in lib/skills/script-policy.test.ts; what matters here is
 * ordering: the carve-out runs before Tier 0 (whose INTERPRETER rule would
 * otherwise swallow every skill script) and before the scopeRoot deny, while
 * every other Tier 0 rule still fires, and flag-off leaves the gate byte-identical.
 */

const ENV_KEYS = [
  "LOCAL_REPO_PATH",
  "VAULT_SUBDIR",
  "WORKTREE_ROOT",
  "PORTAL_SKILLS_DIR",
  "SKILLS_ENABLED",
  "MEMORY_CHECKOUT_DIR",
] as const;
let savedEnv: Record<string, string | undefined>;

const THREAD_ID = "thread-1";
const REPO_ROOT = "/repo/kb";
const SCOPE_ROOT = "/repo/kb/docs";

let root: string;
let storeDir: string;
let script: string;

/** The slug set a session cleared for the fixture's one skill would resolve. */
const CLEARED: ReadonlySet<string> = new Set(["brand"]);

function gate(command: string, scopeRoot?: string, skillSlugs: ReadonlySet<string> = CLEARED) {
  return gateBashCommand({ command }, THREAD_ID, true, scopeRoot, skillSlugs);
}

function writeGitRegistry(memoryDir: string, slugs: string[]): void {
  const lines = ["skills:"];
  for (const slug of slugs) {
    lines.push(
      `  ${slug}:`,
      `    title: ${slug}`,
      "    source:",
      "      type: git",
      "      url: https://gitlab.example.com/acme/skills.git",
      "      ref: main",
      "      commit: 4f2a91c",
      "    groups: [all-hands]",
    );
  }
  mkdirSync(path.join(memoryDir, "access"), { recursive: true });
  writeFileSync(path.join(memoryDir, "access", "skills.yaml"), [...lines, ""].join("\n"));
  invalidateSkillRegistryCache();
}

beforeEach(() => {
  savedEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  process.env.LOCAL_REPO_PATH = REPO_ROOT;
  process.env.VAULT_SUBDIR = ".";
  process.env.WORKTREE_ROOT = "/data/worktrees";
  root = realpathSync(mkdtempSync(path.join(os.tmpdir(), "skill-gate-")));
  storeDir = path.join(root, "store");
  mkdirSync(path.join(storeDir, "brand"), { recursive: true });
  script = path.join(storeDir, "brand", "run.sh");
  writeFileSync(script, "#!/bin/sh\necho hi\n");
  process.env.PORTAL_SKILLS_DIR = storeDir;
  process.env.MEMORY_CHECKOUT_DIR = path.join(root, "memory");
  writeGitRegistry(path.join(root, "memory"), ["brand"]);
  process.env.SKILLS_ENABLED = "1";
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
  rmSync(root, { recursive: true, force: true });
  invalidateSkillRegistryCache();
});

describe("gateBashCommand: skill-script carve-out, flag on", () => {
  it("confirms an interpreter running a store script, which Tier 0 would otherwise hard-deny", () => {
    expect(gate(`bash ${script}`)).toBe("confirm");
    expect(gate(`python3 ${storeDir}/brand/run.sh arg`)).toBe("confirm");
  });

  it("confirms even when scopeRoot is set, where every other unmatched command denies", () => {
    expect(gate(`bash ${script}`, SCOPE_ROOT)).toBe("confirm");
    expect(gate(`ls ${SCOPE_ROOT}`, SCOPE_ROOT)).toBe("deny");
  });

  it("never allows outright: a skill script is always a human decision", () => {
    expect(gate(`bash ${script}`)).not.toBe("allow");
  });

  it("still hard-denies a sandbox-disabled call, whatever the path", () => {
    expect(
      gateBashCommand(
        { command: `bash ${script}`, dangerouslyDisableSandbox: true },
        THREAD_ID,
        true,
        undefined,
        CLEARED,
      ),
    ).toBe("deny");
  });

  it("still hard-denies a store-path command that trips another Tier 0 rule", () => {
    expect(gate(`bash ${script} .env`)).toBe("deny");
    expect(gate(`bash ${script} curl`)).toBe("deny");
    expect(gate(`bash ${script} rm -rf /`)).toBe("deny");
  });

  it("still hard-denies a second command chained onto a permitted script", () => {
    expect(gate(`bash ${script}; ls`)).toBe("deny");
    expect(gate(`bash ${script} && ls`)).toBe("deny");
    expect(gate(`bash ${script} | sh`)).toBe("deny");
    expect(gate(`bash ${script}\nls`)).toBe("deny");
  });

  it("still hard-denies an interpreter pointed anywhere but the store", () => {
    expect(gate(`bash ${root}/elsewhere.sh`)).toBe("deny");
    expect(gate(`python3 ${storeDir}/../escape.py`)).toBe("deny");
    expect(gate("bash -c echo")).toBe("deny");
  });

  it("leaves the rest of the policy untouched", () => {
    expect(gate(`git -C ${REPO_ROOT} log`)).toBe("allow");
    expect(gate(`ls ${REPO_ROOT}`)).toBe("confirm");
    expect(gate("")).toBe("deny");
  });
});

/**
 * The carve-out's two roots are shared across clearances: the store holds every
 * installed skill, and the materialized root holds one directory per clearance
 * key. Containment alone would therefore let a caller run a skill it was never
 * cleared for, skipping both physical materialization and the `Skill` gate. In
 * an authority-scoped session this is the only Bash path that reaches confirm
 * at all, so a stray confirm here is a path the user can simply approve.
 */
describe("gateBashCommand: the carve-out is scoped to the caller's own clearance", () => {
  let otherScript: string;

  beforeEach(() => {
    mkdirSync(path.join(storeDir, "payroll"), { recursive: true });
    otherScript = path.join(storeDir, "payroll", "run.sh");
    writeFileSync(otherScript, "#!/bin/sh\necho hi\n");
    writeGitRegistry(path.join(root, "memory"), ["brand", "payroll"]);
  });

  it("denies a script from a skill this caller's clearance did not materialize", () => {
    expect(gate(`bash ${otherScript}`)).toBe("deny");
    expect(gate(`python3 ${storeDir}/payroll/run.sh`)).toBe("deny");
    // Same command, same store, a caller cleared for it: the slug set refused it.
    expect(gate(`bash ${otherScript}`, undefined, new Set(["payroll"]))).toBe("confirm");
  });

  it("denies it under scopeRoot too, where it would otherwise be the one reachable confirm", () => {
    expect(gate(`bash ${otherScript}`, SCOPE_ROOT)).toBe("deny");
  });

  it("denies every skill script when the caller resolved no slugs at all", () => {
    expect(gate(`bash ${script}`, undefined, new Set())).toBe("deny");
    expect(gateBashCommand({ command: `bash ${script}` }, THREAD_ID, true)).toBe("deny");
  });

  it("is wired that way through gateAgentTool, which owns the session's slug set", () => {
    // The gate is where the session's set actually reaches the Bash policy, so
    // this is the assertion that a missing argument at the call site would break.
    const bash = (command: string, slugs?: ReadonlySet<string>) =>
      gateAgentTool("Bash", { command }, THREAD_ID, undefined, "owner@example.com", undefined, slugs);

    expect(bash(`bash ${otherScript}`, new Set(["brand"]))).toBe("deny");
    expect(bash(`bash ${otherScript}`, new Set(["payroll"]))).toBe("confirm");
    expect(bash(`bash ${otherScript}`)).toBe("deny");
  });
});

describe("gateBashCommand: skill-script carve-out, flag off", () => {
  beforeEach(() => {
    delete process.env.SKILLS_ENABLED;
  });

  it("denies a store script exactly as it did before the carve-out existed", () => {
    expect(gate(`bash ${script}`)).toBe("deny");
    expect(gate(`python3 ${storeDir}/brand/run.sh`)).toBe("deny");
  });

  it("denies a bare store script path under scopeRoot, as any unmatched command does", () => {
    expect(gate(script, SCOPE_ROOT)).toBe("deny");
  });

  it("keeps every other verdict identical", () => {
    expect(gate(`git -C ${REPO_ROOT} log`)).toBe("allow");
    expect(gate(`ls ${REPO_ROOT}`)).toBe("confirm");
  });
});
