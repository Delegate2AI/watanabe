import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Entry hygiene, and what `writeSkills` does with a candidate that fails it.
 *
 * The two refusals here are defense in depth for Task 9's routes, which will be
 * the first callers to hand this module a nested object built from a request.
 */

const canMock = vi.fn();
vi.mock("@/lib/authority/roles", () => ({
  can: (...args: unknown[]) => canMock(...args),
}));

const commitPrivateAccessMock = vi.fn();
vi.mock("@/lib/repo-write-private-access", () => ({
  commitPrivateAccess: (...args: unknown[]) => commitPrivateAccessMock(...args),
}));

import { MAX_ENTRY_DEPTH, sanitizeEntryInput } from "./store-input";
import { writeSkills } from "./store";
import type { SkillEntry, SkillSource } from "./types";

const DEMO: SkillEntry = {
  slug: "demo",
  title: "Demo",
  source: { type: "git", url: "https://git.example/s.git", ref: "main", commit: "abc123" },
  groups: ["eng"],
  compat: { scripts: [], tools: [] },
};

const SEEDED = [
  "skills:",
  "  demo:",
  "    title: Demo",
  "    source:",
  "      type: git",
  "      url: https://git.example/s.git",
  "      ref: main",
  "      commit: abc123",
  "    groups: [eng]",
  "    compat: {scripts: [], tools: []}",
  "",
].join("\n");

/**
 * An own `__proto__` DATA property, the shape a YAML or JSON parse produces.
 *
 * The injected object is EMPTY by default, and that matters: zod reads
 * inherited enumerable keys for its strict check, so an injected object
 * carrying its own keys gets caught anyway, by accident. Only an empty
 * injection isolates the guard being tested here, where the key would otherwise
 * be consumed by the assignment and silently vanish from the entry. Do not
 * "improve" these fixtures by giving the default a marker payload.
 */
function withProtoKey(injected = "{}"): Record<string, unknown> {
  const json = `{"type":"git","url":"https://g.example/s.git","ref":"main","commit":"abc","__proto__":${injected}}`;
  return JSON.parse(json) as Record<string, unknown>;
}

function nested(levels: number): Record<string, unknown> {
  const root: Record<string, unknown> = {};
  let cursor = root;
  for (let i = 0; i < levels; i += 1) {
    const child: Record<string, unknown> = {};
    cursor.next = child;
    cursor = child;
  }
  return root;
}

let root: string;
let filePath: string;

beforeEach(() => {
  root = mkdtempSync(path.join(os.tmpdir(), "skills-store-input-"));
  filePath = path.join(root, "skills.yaml");
  canMock.mockReset().mockReturnValue(true);
  commitPrivateAccessMock.mockReset().mockResolvedValue({ ok: true });
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe("sanitizeEntryInput", () => {
  it("drops an undefined key and keeps everything else", () => {
    const result = sanitizeEntryInput({ title: "Demo", subdir: undefined, groups: ["eng"] });

    expect(result).toEqual({ ok: true, value: { title: "Demo", groups: ["eng"] } });
  });

  it("keeps an undefined array element, so a list is never silently shortened", () => {
    const result = sanitizeEntryInput({ tools: ["a", undefined, "b"] });

    expect(result).toEqual({ ok: true, value: { tools: ["a", undefined, "b"] } });
  });

  it("returns a class instance by identity rather than rebuilding it", () => {
    const stamp = new Date(0);

    const result = sanitizeEntryInput({ at: stamp });

    expect(result.ok && (result.value as { at: Date }).at).toBe(stamp);
  });

  it("refuses an own __proto__ key rather than consuming it", () => {
    const result = sanitizeEntryInput(withProtoKey());

    expect(result).toEqual({ ok: false, reason: "proto-key" });
  });

  it("refuses a __proto__ key nested inside a source", () => {
    const result = sanitizeEntryInput({ title: "Demo", source: withProtoKey() });

    expect(result).toEqual({ ok: false, reason: "proto-key" });
  });

  it("leaves the global prototype alone either way", () => {
    sanitizeEntryInput(withProtoKey('{"polluted":true}'));

    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it("accepts nesting up to the cap", () => {
    expect(sanitizeEntryInput(nested(MAX_ENTRY_DEPTH - 1)).ok).toBe(true);
  });

  it("refuses nesting past the cap instead of exhausting the stack", () => {
    expect(sanitizeEntryInput(nested(10_000))).toEqual({ ok: false, reason: "too-deep" });
  });

  it("refuses a self-referential object instead of recursing forever", () => {
    const cyclic: Record<string, unknown> = { title: "Demo" };
    cyclic.self = cyclic;

    expect(sanitizeEntryInput(cyclic)).toEqual({ ok: false, reason: "too-deep" });
  });
});

describe("writeSkills on a candidate that fails hygiene", () => {
  it("refuses an entry whose source carries a nested __proto__ key", async () => {
    const source = withProtoKey() as unknown as SkillSource;

    const result = await writeSkills(
      { verb: "add", entry: { ...DEMO, source } },
      "admin@example.com",
      { filePath },
    );

    expect(result).toEqual({ ok: false, error: "invalid skill entry" });
    expect(commitPrivateAccessMock).not.toHaveBeenCalled();
  });

  it("refuses a setGroups whose committed entry carries a nested __proto__ key", async () => {
    writeFileSync(filePath, SEEDED.replace("      ref: main", "      ref: main\n      __proto__: {}"));

    const result = await writeSkills(
      { verb: "setGroups", slug: "demo", groups: ["eng", "ops"] },
      "admin@example.com",
      { filePath },
    );

    expect(result).toEqual({ ok: false, error: "invalid skill entry" });
    expect(commitPrivateAccessMock).not.toHaveBeenCalled();
  });

  it("returns a refusal rather than throwing on a cyclic source", async () => {
    const source: Record<string, unknown> = { type: "git" };
    source.self = source;

    const result = await writeSkills(
      { verb: "add", entry: { ...DEMO, source: source as unknown as SkillSource } },
      "admin@example.com",
      { filePath },
    );

    expect(result).toEqual({ ok: false, error: "invalid skill entry" });
  });

  it("returns a refusal rather than throwing on a pathologically deep compat", async () => {
    writeFileSync(filePath, SEEDED);

    const result = await writeSkills(
      {
        verb: "update",
        slug: "demo",
        source: DEMO.source,
        compat: nested(10_000) as unknown as SkillEntry["compat"],
      },
      "admin@example.com",
      { filePath },
    );

    expect(result).toEqual({ ok: false, error: "invalid skill entry" });
  });
});
