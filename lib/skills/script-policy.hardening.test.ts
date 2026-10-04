import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DESTRUCTIVE,
  INTERPRETER,
  MUTATING_GIT,
  NETWORK_EGRESS,
  PRIVILEGE_OR_PROCESS,
  SECRET_ACCESS,
  SHELL_METACHARACTERS,
  tripsNonInterpreterTierZero,
} from "@/lib/agent/bash-patterns";
import { isSkillScriptInvocation } from "./script-policy";

/**
 * Review-round hardening of the carve-out: this app's own machinery
 * directories, a sanity floor on the configured root, bounds set by what the
 * confirm modal can actually show, and a case-insensitive Tier 0 re-check.
 * The base matcher cases live in script-policy.test.ts.
 */

let root: string;
let storeDir: string;
let matDir: string;
let script: string;
let registryPath: string;

const CLEARED: ReadonlySet<string> = new Set(["brand"]);

function gitRegistry(slug: string): string {
  return [
    "skills:",
    `  ${slug}:`,
    `    title: ${slug}`,
    "    source:",
    "      type: git",
    "      url: https://gitlab.example.com/acme/skills.git",
    "      ref: main",
    "      commit: 4f2a91c",
    "    groups: [all-hands]",
    "",
  ].join("\n");
}

function permits(command: string): boolean {
  return isSkillScriptInvocation(command, CLEARED, storeDir, matDir, registryPath);
}

beforeEach(() => {
  root = realpathSync(mkdtempSync(path.join(os.tmpdir(), "skill-hard-")));
  storeDir = path.join(root, "store");
  matDir = path.join(root, "store-materialized");
  registryPath = path.join(root, "skills.yaml");
  mkdirSync(path.join(storeDir, "brand"), { recursive: true });
  script = path.join(storeDir, "brand", "run.sh");
  writeFileSync(script, "#!/bin/sh\necho hi\n");
  writeFileSync(registryPath, gitRegistry("brand"));
  process.env.SKILLS_ENABLED = "1";
});

afterEach(() => {
  delete process.env.SKILLS_ENABLED;
  rmSync(root, { recursive: true, force: true });
});

describe("isSkillScriptInvocation: this app's own machinery is not a skill", () => {
  it("refuses an installer aside, which a swallowed cleanup can leave on disk unlisted", () => {
    const aside = path.join(storeDir, ".replacing-brand-2f8c1b7a");
    mkdirSync(aside, { recursive: true });
    writeFileSync(path.join(aside, "run.sh"), "#!/bin/sh\n");

    expect(permits(`bash ${aside}/run.sh`)).toBe(false);
  });

  it("refuses a materializer staging tree", () => {
    const staging = path.join(matDir, ".skills-materialize-abc123", "skills", "brand");
    mkdirSync(staging, { recursive: true });
    writeFileSync(path.join(staging, "run.sh"), "#!/bin/sh\n");

    expect(permits(`bash ${staging}/run.sh`)).toBe(false);
  });

  it("still permits a dot directory inside a skill, which is the skill's own content", () => {
    mkdirSync(path.join(storeDir, "brand", ".internal"), { recursive: true });
    writeFileSync(path.join(storeDir, "brand", ".internal", "run.sh"), "#!/bin/sh\n");

    expect(permits(`bash ${storeDir}/brand/.internal/run.sh`)).toBe(true);
  });
});

describe("isSkillScriptInvocation: sanity floor on the configured root", () => {
  it("refuses a filesystem root as the store, whatever it would otherwise contain", () => {
    expect(isSkillScriptInvocation(`bash ${script}`, CLEARED, "/", "/")).toBe(false);
  });

  it("refuses a root only one segment deep, which the real script sits well inside", () => {
    const shallow = path.sep + root.split(path.sep).filter(Boolean)[0];

    expect(isSkillScriptInvocation(`bash ${script}`, CLEARED, shallow, shallow)).toBe(false);
    // Same script, same command, a plausible root: the floor is what refused it.
    expect(permits(`bash ${script}`)).toBe(true);
  });
});

describe("isSkillScriptInvocation: bounds a confirm modal can actually show", () => {
  it("permits a handful of short arguments and refuses a wall of them", () => {
    expect(permits(`bash ${script}${" a".repeat(10)}`)).toBe(true);
    expect(permits(`bash ${script}${" a".repeat(11)}`)).toBe(false);
  });

  it("refuses a command longer than the modal can show without scrolling", () => {
    expect(permits(`bash ${script} ${"a".repeat(520)}`)).toBe(false);
  });
});

describe("isSkillScriptInvocation: the Tier 0 re-check is case-insensitive", () => {
  it("refuses an upper-case script name that a case-sensitive check would pass", () => {
    writeFileSync(path.join(storeDir, "brand", "CURL.py"), "print(1)\n");

    expect(permits(`python3 ${storeDir}/brand/CURL.py`)).toBe(false);
  });

  it("refuses an upper-case Tier 0 word in an argument", () => {
    expect(permits(`bash ${script} SUDO`)).toBe(false);
    expect(permits(`bash ${script} RM -rf /`)).toBe(false);
    expect(permits(`bash ${script} GIT PUSH origin main`)).toBe(false);
  });
});

describe("tripsNonInterpreterTierZero", () => {
  it("excludes INTERPRETER, which is the one rule the carve-out relaxes", () => {
    expect(tripsNonInterpreterTierZero("python3 /srv/skills/brand/gen.py")).toBe(false);
    expect(tripsNonInterpreterTierZero("bash /srv/skills/brand/run.sh")).toBe(false);
  });

  it("covers the other six rules, in any case", () => {
    expect(tripsNonInterpreterTierZero("run.sh; ls")).toBe(true);
    expect(tripsNonInterpreterTierZero("scripts/env-setup.sh")).toBe(true);
    expect(tripsNonInterpreterTierZero("scripts/PING.sh")).toBe(true);
    expect(tripsNonInterpreterTierZero("scripts/cp-assets.py")).toBe(true);
    expect(tripsNonInterpreterTierZero("git COMMIT")).toBe(true);
    expect(tripsNonInterpreterTierZero("scripts/Kill.sh")).toBe(true);
  });

  it("leaves the Tier 0 patterns themselves free of the g flag the derivation relies on", () => {
    const patterns = [
      SHELL_METACHARACTERS,
      SECRET_ACCESS,
      NETWORK_EGRESS,
      DESTRUCTIVE,
      MUTATING_GIT,
      PRIVILEGE_OR_PROCESS,
      INTERPRETER,
    ];
    for (const pattern of patterns) expect(pattern.flags).not.toContain("g");
    // Only SECRET_ACCESS carries `i` of its own, so the rest are derived copies
    // and Tier 0 keeps the exact behaviour it was proven to have.
    expect(SECRET_ACCESS.flags).toBe("i");
    expect(NETWORK_EGRESS.flags).toBe("");
  });
});
