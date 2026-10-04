import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createBudgetWalker, directoryOverBudget, fetchGitSkill } from "./install-git";

/**
 * The clone byte budget. `--depth=1` bounds history and not size, and the
 * validator's caps only apply after the clone has already landed on the same
 * volume as portal.db, so the fetch needs its own ceiling.
 */

let tmpRoot: string;
let remote: string;
let remoteUrl: string;

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

function write(rel: string, content: string): void {
  const abs = path.join(remote, rel);
  mkdirSync(path.dirname(abs), { recursive: true });
  writeFileSync(abs, content);
}

function staging(name: string): string {
  const dir = path.join(tmpRoot, name);
  mkdirSync(dir, { recursive: true });
  return dir;
}

beforeEach(() => {
  tmpRoot = mkdtempSync(path.join(os.tmpdir(), "skill-budget-"));
  remote = path.join(tmpRoot, "remote");
  mkdirSync(remote, { recursive: true });
  git(remote, "init", "-b", "main");
  git(remote, "config", "user.email", "fixture@example.com");
  git(remote, "config", "user.name", "Fixture");
  write("SKILL.md", ["---", "name: Budget Skill", "description: Small.", "---", "", "Body.", ""].join("\n"));
  git(remote, "add", "-A");
  git(remote, "commit", "-m", "initial");
  remoteUrl = `file://${remote}`;
});

afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

describe("fetchGitSkill clone budget", () => {
  it("refuses a clone that writes more than the budget into staging", async () => {
    write("bulk.bin", "x".repeat(2_000_000));
    git(remote, "add", "-A");
    git(remote, "commit", "-m", "bulky");

    const result = await fetchGitSkill(
      { url: remoteUrl, ref: "main", maxCloneBytes: 50_000, watchIntervalMs: 10 },
      staging("over"),
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("exceeded its budget");
  });

  it("lets a normal clone through untouched", async () => {
    const result = await fetchGitSkill({ url: remoteUrl, ref: "main" }, staging("under"));

    expect(result.ok).toBe(true);
  });
});

describe("directoryOverBudget", () => {
  const budget = (maxBytes: number, maxEntries = 1_000_000) => ({ maxBytes, maxEntries });

  it("reports over budget only once the byte budget is actually exceeded", () => {
    const dir = path.join(tmpRoot, "measured");
    mkdirSync(path.join(dir, "nested"), { recursive: true });
    writeFileSync(path.join(dir, "nested", "a.bin"), "x".repeat(500));

    expect(directoryOverBudget(dir, budget(1000))).toBe(false);
    expect(directoryOverBudget(dir, budget(400))).toBe(true);
  });

  it("counts directories against the entry budget, which bytes alone cannot see", () => {
    // Empty directories cost a real block on disk each while contributing zero
    // bytes, so a byte-only budget measured a million of them as free.
    const dir = path.join(tmpRoot, "dirbomb");
    for (let i = 0; i < 200; i += 1) mkdirSync(path.join(dir, `d${i}`), { recursive: true });

    expect(directoryOverBudget(dir, budget(1, 1_000_000))).toBe(false);
    expect(directoryOverBudget(dir, budget(1_000_000, 100))).toBe(true);
  });

  it("does not follow a symlink out of the measured tree", () => {
    const dir = path.join(tmpRoot, "linked");
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(remote, "big.bin"), "x".repeat(100_000));
    symlinkSync(remote, path.join(dir, "everything"));

    expect(directoryOverBudget(dir, budget(10_000))).toBe(false);
  });

  it("returns false for a directory that does not exist", () => {
    expect(directoryOverBudget(path.join(tmpRoot, "gone"), budget(1))).toBe(false);
  });
});

describe("createBudgetWalker", () => {
  function tree(name: string, dirs: number, perDir: number): string {
    const dir = path.join(tmpRoot, name);
    for (let i = 0; i < dirs; i += 1) {
      const sub = path.join(dir, `d${i}`);
      mkdirSync(sub, { recursive: true });
      for (let j = 0; j < perDir; j += 1) writeFileSync(path.join(sub, `f${j}.bin`), "x".repeat(64));
    }
    return dir;
  }

  it("examines at most entriesPerTick entries per step, so a tick is bounded work", () => {
    // A full walk per tick blocked the event loop in proportion to repository
    // size, which is attacker controlled. A step is now constant work no matter
    // how large the tree is, and it resumes where it left off.
    const dir = tree("wide", 40, 25);
    const step = createBudgetWalker(dir, { maxBytes: 1e9, maxEntries: 1e9 }, 50);

    const first = step();
    expect(first.examined).toBe(50);
    expect(first.done).toBe(false);
    expect(first.over).toBe(false);

    const second = step();
    expect(second.examined).toBe(50);
    expect(second.done).toBe(false);
  });

  it("finishes a pass across steps and then starts a fresh one", () => {
    const dir = tree("small", 2, 3);
    const step = createBudgetWalker(dir, { maxBytes: 1e9, maxEntries: 1e9 }, 4);

    let steps = 0;
    let total = 0;
    let result = step();
    while (!result.done && steps < 50) {
      total += result.examined;
      steps += 1;
      result = step();
    }
    total += result.examined;

    expect(result.done).toBe(true);
    expect(steps).toBeGreaterThan(0);
    // 2 directories plus 6 files.
    expect(total).toBe(8);
    // The next step opens a new pass rather than staying done.
    expect(step().examined).toBe(4);
  });

  it("trips the budget on the cumulative walk, not only at the end of a pass", () => {
    const dir = tree("heavy", 10, 10);
    const step = createBudgetWalker(dir, { maxBytes: 200, maxEntries: 1e9 }, 5);

    let over = false;
    for (let i = 0; i < 50 && !over; i += 1) over = step().over;

    expect(over).toBe(true);
  });
});
