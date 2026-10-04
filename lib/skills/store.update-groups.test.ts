import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const canMock = vi.fn();
vi.mock("@/lib/authority/roles", () => ({ can: (...args: unknown[]) => canMock(...args) }));

const commitPrivateAccessMock = vi.fn();
vi.mock("@/lib/repo-write-private-access", () => ({
  commitPrivateAccess: (...args: unknown[]) => commitPrivateAccessMock(...args),
}));

import { invalidateSkillRegistryCache } from "./registry";
import { writeSkills } from "./store";
import { getConfig } from "@/lib/config";

let root: string;
let filePath: string;

const SOURCE = { type: "authored" as const, author: "alice@example.com", rev: "ffffffffffff" };

type WrittenEntry = { title: string; groups: string[]; source: { rev: string } };

function written(): Record<string, WrittenEntry> {
  const [files] = commitPrivateAccessMock.mock.calls.at(-1) as [Record<string, string>];
  return (parseYaml(files["access/skills.yaml"]) as { skills: Record<string, WrittenEntry> }).skills;
}

beforeEach(() => {
  root = mkdtempSync(path.join(os.tmpdir(), "skills-update-groups-"));
  filePath = path.join(root, "skills.yaml");
  writeFileSync(
    filePath,
    [
      "skills:",
      "  demo:",
      "    title: Old Title",
      "    source:",
      "      type: authored",
      "      author: alice@example.com",
      "      rev: aaaaaaaaaaaa",
      "    groups: [eng, docs]",
      "    compat: {scripts: [], tools: []}",
      "",
    ].join("\n"),
  );
  invalidateSkillRegistryCache();
  canMock.mockReset().mockReturnValue(true);
  commitPrivateAccessMock.mockReset().mockResolvedValue({ ok: true });
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  invalidateSkillRegistryCache();
  vi.restoreAllMocks();
});

describe("writeSkills update groups", () => {
  it("moves source, title and groups in a single commit", async () => {
    const result = await writeSkills(
      {
        verb: "update",
        slug: "demo",
        title: "New Title",
        source: SOURCE,
        compat: { scripts: [], tools: [] },
        groups: ["eng"],
      },
      "admin@example.com",
      { filePath },
    );

    expect(result).toEqual({ ok: true });
    expect(commitPrivateAccessMock).toHaveBeenCalledTimes(1);
    expect(written().demo).toMatchObject({
      title: "New Title",
      groups: ["eng"],
      source: { rev: "ffffffffffff" },
    });
  });

  it("keeps the recorded groups when the update carries none", async () => {
    const result = await writeSkills(
      { verb: "update", slug: "demo", source: SOURCE, compat: { scripts: [], tools: [] } },
      "admin@example.com",
      { filePath },
    );

    expect(result).toEqual({ ok: true });
    expect(written().demo.groups).toEqual(["eng", "docs"]);
  });

  it("refuses groups the entry schema rejects, leaving the file uncommitted", async () => {
    const result = await writeSkills(
      {
        verb: "update",
        slug: "demo",
        source: SOURCE,
        compat: { scripts: [], tools: [] },
        groups: [""],
      },
      "admin@example.com",
      { filePath },
    );

    expect(result).toEqual({ ok: false, error: "invalid skill entry" });
    expect(commitPrivateAccessMock).not.toHaveBeenCalled();
  });
});

describe("writeSkills attribution", () => {
  it("commits as the named human while authorizing the passed actor", async () => {
    const result = await writeSkills(
      { verb: "update", slug: "demo", source: SOURCE, compat: { scripts: [], tools: [] } },
      getConfig().git.botEmail,
      { filePath, onBehalfOf: "Alice@Example.com " },
    );

    expect(result).toEqual({ ok: true });
    const [, options] = commitPrivateAccessMock.mock.calls.at(-1) as [
      unknown,
      { authorEmail: string; onBehalfOf?: { name: string; email: string } },
    ];
    expect(options.authorEmail).toBe(getConfig().git.botEmail);
    expect(options.onBehalfOf).toEqual({
      name: "alice@example.com",
      email: "alice@example.com",
    });
  });

  it("ignores an attribution that is not a plain address", async () => {
    await writeSkills(
      { verb: "update", slug: "demo", source: SOURCE, compat: { scripts: [], tools: [] } },
      "admin@example.com",
      { filePath, onBehalfOf: "Evil <evil@example.com>" },
    );

    const [, options] = commitPrivateAccessMock.mock.calls.at(-1) as [unknown, { onBehalfOf?: unknown }];
    expect(options.onBehalfOf).toBeUndefined();
  });
});
