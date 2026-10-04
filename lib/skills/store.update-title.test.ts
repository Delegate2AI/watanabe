import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The update verb's optional `title` (spec 34, task 9). A re-fetch is the only
 * moment a skill's own frontmatter `name` can have changed upstream, so it is
 * the only moment the registry title can be refreshed. Omitting the field must
 * still preserve the recorded title, since that is what every existing caller
 * relies on.
 */

const canMock = vi.fn();
vi.mock("@/lib/authority/roles", () => ({ can: (...args: unknown[]) => canMock(...args) }));

const commitPrivateAccessMock = vi.fn();
vi.mock("@/lib/repo-write-private-access", () => ({
  commitPrivateAccess: (...args: unknown[]) => commitPrivateAccessMock(...args),
}));

import { invalidateSkillRegistryCache } from "./registry";
import { writeSkills } from "./store";

let root: string;
let filePath: string;

const SOURCE = {
  type: "git" as const,
  url: "https://git.example/s.git",
  ref: "main",
  commit: "def456",
};

function written(): Record<string, { title: string }> {
  const [files] = commitPrivateAccessMock.mock.calls.at(-1) as [Record<string, string>];
  return (parseYaml(files["access/skills.yaml"]) as { skills: Record<string, { title: string }> }).skills;
}

beforeEach(() => {
  root = mkdtempSync(path.join(os.tmpdir(), "skills-update-title-"));
  filePath = path.join(root, "skills.yaml");
  writeFileSync(
    filePath,
    [
      "skills:",
      "  demo:",
      "    title: Old Title",
      "    source:",
      "      type: git",
      "      url: https://git.example/s.git",
      "      ref: main",
      "      commit: abc123",
      "    groups: [eng]",
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

describe("writeSkills update title", () => {
  it("keeps the recorded title when the update carries none", async () => {
    const result = await writeSkills(
      { verb: "update", slug: "demo", source: SOURCE, compat: { scripts: [], tools: [] } },
      "admin@example.com",
      { filePath },
    );

    expect(result).toEqual({ ok: true });
    expect(written().demo.title).toBe("Old Title");
  });

  it("rewrites the title when the re-fetch reports a new frontmatter name", async () => {
    const result = await writeSkills(
      { verb: "update", slug: "demo", title: "New Title", source: SOURCE, compat: { scripts: [], tools: [] } },
      "admin@example.com",
      { filePath },
    );

    expect(result).toEqual({ ok: true });
    expect(written().demo.title).toBe("New Title");
  });

  it("refuses a title the entry schema rejects, leaving the file uncommitted", async () => {
    const result = await writeSkills(
      { verb: "update", slug: "demo", title: "", source: SOURCE, compat: { scripts: [], tools: [] } },
      "admin@example.com",
      { filePath },
    );

    expect(result).toEqual({ ok: false, error: "invalid skill entry" });
    expect(commitPrivateAccessMock).not.toHaveBeenCalled();
  });
});
