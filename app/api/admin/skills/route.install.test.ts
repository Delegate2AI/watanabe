import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const requireIdentityMock = vi.fn();
vi.mock("@/lib/auth/identity", () => ({
  requireIdentity: (...args: unknown[]) => requireIdentityMock(...args),
}));

const canMock = vi.fn();
vi.mock("@/lib/authority/roles", () => ({ can: (...args: unknown[]) => canMock(...args) }));

const loadAccessMock = vi.fn();
vi.mock("@/lib/authority/access", () => ({ loadAccess: () => loadAccessMock() }));

const isSkillsEnabledMock = vi.fn();
vi.mock("@/lib/skills/config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/skills/config")>();
  return { ...actual, isSkillsEnabled: () => isSkillsEnabledMock() };
});

const loadSkillRegistryMock = vi.fn();
vi.mock("@/lib/skills/registry", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/skills/registry")>();
  return { ...actual, loadSkillRegistry: (...args: unknown[]) => loadSkillRegistryMock(...args) };
});

const writeSkillsMock = vi.fn();
const removeInstalledSkillMock = vi.fn();
vi.mock("@/lib/skills/store", () => ({
  writeSkills: (...args: unknown[]) => writeSkillsMock(...args),
  removeInstalledSkill: (...args: unknown[]) => removeInstalledSkillMock(...args),
}));

const installFromGitMock = vi.fn();
vi.mock("@/lib/skills/install", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/skills/install")>();
  return { ...actual, installFromGit: (...args: unknown[]) => installFromGitMock(...args) };
});

const invalidateMaterializedSkillsMock = vi.fn();
vi.mock("@/lib/skills/materialize", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/skills/materialize")>();
  return {
    ...actual,
    invalidateMaterializedSkills: (...args: unknown[]) => invalidateMaterializedSkillsMock(...args),
  };
});

const { POST } = await import("./route");
const { MAX_SKILL_GROUPS } = await import("@/lib/skills/admin-record");

const ENTRY = {
  slug: "pdf-tools",
  title: "PDF Tools",
  source: { type: "git", url: "https://git.example/skills.git", ref: "main", commit: "old111" },
  groups: ["eng"],
  compat: { scripts: [], tools: [] },
};

function installed(slug: string, name: string, commit: string) {
  return {
    ok: true,
    slug,
    validation: {
      ok: true,
      name,
      slug,
      description: "does things",
      compat: { scripts: ["scripts/a.py"], tools: [], urls: [], blockedScripts: [] as string[] },
    },
    source: { type: "git", url: "https://git.example/skills.git", ref: "main", commit },
  };
}

function post(body: unknown): Request {
  return new Request("http://localhost/api/admin/skills", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

let storeRoot: string;
const savedEnv = { ...process.env };

beforeEach(() => {
  storeRoot = mkdtempSync(path.join(os.tmpdir(), "skills-admin-actions-"));
  process.env.PORTAL_SKILLS_DIR = storeRoot;
  requireIdentityMock.mockReset().mockResolvedValue({ identity: { email: "admin@example.com" } });
  canMock.mockReset().mockReturnValue(true);
  loadAccessMock.mockReset().mockReturnValue({ groups: { eng: [], ops: [] } });
  isSkillsEnabledMock.mockReset().mockReturnValue(true);
  loadSkillRegistryMock.mockReset().mockReturnValue({ entries: [], errors: [] });
  writeSkillsMock.mockReset().mockResolvedValue({ ok: true });
  removeInstalledSkillMock.mockReset().mockResolvedValue({ ok: true });
  installFromGitMock.mockReset().mockResolvedValue(installed("pdf-tools", "PDF Tools", "new222"));
  invalidateMaterializedSkillsMock.mockReset();
});

afterEach(() => {
  rmSync(storeRoot, { recursive: true, force: true });
  process.env = { ...savedEnv };
  vi.restoreAllMocks();
});

const GIT_BODY = {
  action: "install-git",
  url: "https://git.example/skills.git",
  ref: "main",
  subdir: "skills/pdf",
  groups: ["eng"],
};

describe("install-git", () => {
  it("installs through the git pipeline and records the entry", async () => {
    const response = await POST(post(GIT_BODY));

    expect(installFromGitMock).toHaveBeenCalledWith(
      {
        url: "https://git.example/skills.git",
        ref: "main",
        subdir: "skills/pdf",
      },
      { sourceType: "git" },
    );
    expect(writeSkillsMock).toHaveBeenCalledWith(
      {
        verb: "add",
        entry: {
          slug: "pdf-tools",
          title: "PDF Tools",
          source: { type: "git", url: "https://git.example/skills.git", ref: "main", commit: "new222" },
          groups: ["eng"],
          compat: { scripts: ["scripts/a.py"], tools: [] },
        },
      },
      "admin@example.com",
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      slug: "pdf-tools",
      replaced: false,
      commit: "new222",
    });
    expect(invalidateMaterializedSkillsMock).toHaveBeenCalled();
  });

  it("rejects a group key that access does not declare, without installing", async () => {
    const response = await POST(post({ ...GIT_BODY, groups: ["eng", "ghosts"] }));

    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: { detail: string } }).error.detail).toBe("groups");
    expect(installFromGitMock).not.toHaveBeenCalled();
  });

  it("reports an install refusal without leaking an absolute path", async () => {
    installFromGitMock.mockResolvedValue({
      ok: false,
      reason: "unreadable SKILL.md: ENOENT, open '/var/data/.skill-install-x9/SKILL.md'",
    });

    const response = await POST(post(GIT_BODY));
    const body = (await response.json()) as { error: { code: string }; reason: string };

    expect(response.status).toBe(400);
    expect(body.error.code).toBe("invalid_request");
    expect(body.reason).toContain("unreadable SKILL.md");
    expect(body.reason).not.toContain("/var/data");
    expect(writeSkillsMock).not.toHaveBeenCalled();
  });

  it("rolls the store directory back when the registry write fails", async () => {
    mkdirSync(path.join(storeRoot, "pdf-tools"), { recursive: true });
    writeSkillsMock.mockResolvedValue({ ok: false, error: "skill configuration failed validation" });

    const response = await POST(post(GIT_BODY));

    expect(response.status).toBe(400);
    expect(existsSync(path.join(storeRoot, "pdf-tools"))).toBe(false);
  });

  it("re-installs a registered slug through update, and keeps the store on a failed write", async () => {
    loadSkillRegistryMock.mockReturnValue({ entries: [ENTRY], errors: [] });
    mkdirSync(path.join(storeRoot, "pdf-tools"), { recursive: true });
    writeSkillsMock.mockResolvedValue({ ok: false, error: "skills file is unreadable" });

    const response = await POST(post(GIT_BODY));

    expect(writeSkillsMock).toHaveBeenCalledWith(
      {
        verb: "update",
        slug: "pdf-tools",
        title: "PDF Tools",
        source: { type: "git", url: "https://git.example/skills.git", ref: "main", commit: "new222" },
        compat: { scripts: ["scripts/a.py"], tools: [] },
      },
      "admin@example.com",
    );
    expect(response.status).toBe(500);
    expect(existsSync(path.join(storeRoot, "pdf-tools"))).toBe(true);
  });

  it("reports that a registered slug was replaced", async () => {
    loadSkillRegistryMock.mockReturnValue({ entries: [ENTRY], errors: [] });

    expect(await (await POST(post(GIT_BODY))).json()).toEqual({
      ok: true,
      slug: "pdf-tools",
      replaced: true,
      commit: "new222",
      previousCommit: "old111",
    });
  });

  it("surfaces scripts the bash policy can never run", async () => {
    const result = installed("pdf-tools", "PDF Tools", "new222");
    result.validation.compat.blockedScripts = ["scripts/curl.py"];
    installFromGitMock.mockResolvedValue(result);

    const body = (await (await POST(post(GIT_BODY))).json()) as { blockedScripts: string[] };

    expect(body.blockedScripts).toEqual(["scripts/curl.py"]);
  });
});

describe("clearance list bounds", () => {
  function entryGroups(): string[] {
    const [change] = writeSkillsMock.mock.calls[0] as [{ entry: { groups: string[] } }];
    return change.entry.groups;
  }

  it("de-duplicates and sorts what it records, so one key cannot be sent thousands of times", async () => {
    await POST(post({ ...GIT_BODY, groups: ["ops", "eng", "eng", "ops", "eng"] }));

    expect(entryGroups()).toEqual(["eng", "ops"]);
  });

  it("refuses a list past the shared cap, without installing", async () => {
    const groups = Array.from({ length: MAX_SKILL_GROUPS + 1 }, () => "eng");

    const response = await POST(post({ ...GIT_BODY, groups }));

    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: { detail: string } }).error.detail).toBe("groups");
    expect(installFromGitMock).not.toHaveBeenCalled();
  });

  it("refuses an over-long group key", async () => {
    const response = await POST(post({ ...GIT_BODY, groups: ["e".repeat(65)] }));

    expect(response.status).toBe(400);
    expect(installFromGitMock).not.toHaveBeenCalled();
  });

  it("accepts an empty list, which means nobody is cleared yet", async () => {
    const response = await POST(post({ ...GIT_BODY, groups: [] }));

    expect(response.status).toBe(200);
    expect(entryGroups()).toEqual([]);
  });
});
