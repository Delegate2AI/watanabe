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
      compat: { scripts: [], tools: [], urls: [], blockedScripts: [] },
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
  storeRoot = mkdtempSync(path.join(os.tmpdir(), "skills-admin-manage-"));
  process.env.PORTAL_SKILLS_DIR = storeRoot;
  requireIdentityMock.mockReset().mockResolvedValue({ identity: { email: "admin@example.com" } });
  canMock.mockReset().mockReturnValue(true);
  loadAccessMock.mockReset().mockReturnValue({ groups: { eng: [], ops: [] } });
  isSkillsEnabledMock.mockReset().mockReturnValue(true);
  loadSkillRegistryMock.mockReset().mockReturnValue({ entries: [ENTRY], errors: [] });
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

describe("uninstall", () => {
  it("goes through removeInstalledSkill rather than a registry-only remove", async () => {
    const response = await POST(post({ action: "uninstall", slug: "pdf-tools" }));

    expect(removeInstalledSkillMock).toHaveBeenCalledWith("pdf-tools", "admin@example.com");
    expect(writeSkillsMock).not.toHaveBeenCalled();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, slug: "pdf-tools" });
  });

  it("warns when the store directory survived the removal", async () => {
    mkdirSync(path.join(storeRoot, "pdf-tools"), { recursive: true });

    const body = await (await POST(post({ action: "uninstall", slug: "pdf-tools" }))).json();

    expect(body).toEqual({ ok: true, slug: "pdf-tools", warning: "store_directory_remains" });
  });

  it("404s a slug the registry writer does not carry", async () => {
    removeInstalledSkillMock.mockResolvedValue({ ok: false, error: "unknown skill" });

    expect((await POST(post({ action: "uninstall", slug: "ghost" }))).status).toBe(404);
  });
});

describe("update", () => {
  it("re-fetches the pinned source and reports the commit move", async () => {
    const response = await POST(post({ action: "update", slug: "pdf-tools" }));

    expect(installFromGitMock).toHaveBeenCalledWith(
      { url: "https://git.example/skills.git", ref: "main" },
      { sourceType: "git" },
    );
    expect(await response.json()).toEqual({
      ok: true,
      slug: "pdf-tools",
      replaced: true,
      commit: "new222",
      previousCommit: "old111",
    });
    expect(invalidateMaterializedSkillsMock).toHaveBeenCalled();
  });

  it("404s a slug that is not in the registry", async () => {
    const response = await POST(post({ action: "update", slug: "ghost" }));

    expect(response.status).toBe(404);
    expect(installFromGitMock).not.toHaveBeenCalled();
  });

  it("refuses to update a zip-sourced skill, which has no remote to re-fetch", async () => {
    loadSkillRegistryMock.mockReturnValue({
      entries: [{ ...ENTRY, source: { type: "zip", filename: "pdf.zip" } }],
      errors: [],
    });

    const response = await POST(post({ action: "update", slug: "pdf-tools" }));

    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: { detail: string } }).error.detail).toBe("source");
    expect(installFromGitMock).not.toHaveBeenCalled();
  });

  it("refuses a re-fetch that renamed itself onto an unregistered slug, and clears the orphan", async () => {
    installFromGitMock.mockResolvedValue(installed("pdf-tools-2", "PDF Tools 2", "new222"));
    mkdirSync(path.join(storeRoot, "pdf-tools-2"), { recursive: true });

    const response = await POST(post({ action: "update", slug: "pdf-tools" }));
    const body = (await response.json()) as { error: { detail: string }; warning?: string };

    expect(response.status).toBe(400);
    expect(body.error.detail).toBe("slug");
    expect(body.warning).toBeUndefined();
    expect(writeSkillsMock).not.toHaveBeenCalled();
    expect(existsSync(path.join(storeRoot, "pdf-tools-2"))).toBe(false);
  });

  it("raises a distinct signal when the re-fetch renamed itself onto ANOTHER installed skill", async () => {
    loadSkillRegistryMock.mockReturnValue({
      entries: [ENTRY, { ...ENTRY, slug: "exec-briefing", groups: ["exec"] }],
      errors: [],
    });
    installFromGitMock.mockResolvedValue(installed("exec-briefing", "Exec Briefing", "new222"));
    mkdirSync(path.join(storeRoot, "exec-briefing"), { recursive: true });

    const response = await POST(post({ action: "update", slug: "pdf-tools" }));
    const body = (await response.json()) as { error: { detail: string }; warning: string; reason: string };

    expect(response.status).toBe(400);
    expect(body.warning).toBe("store_overwritten:exec-briefing");
    expect(body.reason).toContain("exec-briefing");
    expect(body.reason).toContain("reinstalled");
    expect(writeSkillsMock).not.toHaveBeenCalled();
    // Not rolled back: removing it would leave the victim's registry row
    // pointing at nothing, which is worse than the wrong content plus a warning.
    expect(existsSync(path.join(storeRoot, "exec-briefing"))).toBe(true);
  });

  it("tells the two rename cases apart, so the loud one cannot be read as the benign one", async () => {
    installFromGitMock.mockResolvedValue(installed("pdf-tools-2", "PDF Tools 2", "new222"));
    const benign = await (await POST(post({ action: "update", slug: "pdf-tools" }))).text();

    loadSkillRegistryMock.mockReturnValue({
      entries: [ENTRY, { ...ENTRY, slug: "pdf-tools-2" }],
      errors: [],
    });
    const loud = await (await POST(post({ action: "update", slug: "pdf-tools" }))).text();

    expect(loud).not.toBe(benign);
  });
});

describe("set-groups", () => {
  it("writes the clearance change and invalidates every materialization", async () => {
    const response = await POST(post({ action: "set-groups", slug: "pdf-tools", groups: ["ops"] }));

    expect(writeSkillsMock).toHaveBeenCalledWith(
      { verb: "setGroups", slug: "pdf-tools", groups: ["ops"] },
      "admin@example.com",
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, slug: "pdf-tools" });
    expect(invalidateMaterializedSkillsMock).toHaveBeenCalled();
  });

  it("rejects a group key access does not declare, without writing", async () => {
    const response = await POST(post({ action: "set-groups", slug: "pdf-tools", groups: ["ghosts"] }));

    expect(response.status).toBe(400);
    expect(writeSkillsMock).not.toHaveBeenCalled();
  });

  it.each([
    ["forbidden", 403],
    ["unknown skill", 404],
    ["invalid skill entry", 400],
    ["fatal: could not read from remote", 500],
  ])("translates the writer's %s refusal", async (error, status) => {
    writeSkillsMock.mockResolvedValue({ ok: false, error });

    const response = await POST(post({ action: "set-groups", slug: "pdf-tools", groups: ["ops"] }));

    expect(response.status).toBe(status);
  });

  it("answers an unexpected throw with a coded 500 rather than a stack", async () => {
    writeSkillsMock.mockRejectedValue(new Error("EACCES: open /srv/portal/.private/access"));

    const response = await POST(post({ action: "set-groups", slug: "pdf-tools", groups: ["ops"] }));

    expect(response.status).toBe(500);
    const body = await response.text();
    expect(JSON.parse(body)).toEqual({ error: { code: "internal" } });
    expect(body).not.toContain("/srv/portal");
  });

  it("never echoes a commit failure message into the body", async () => {
    writeSkillsMock.mockResolvedValue({ ok: false, error: "fatal: https://oauth2:glpat-xxx@gitlab.example" });

    const response = await POST(post({ action: "set-groups", slug: "pdf-tools", groups: ["ops"] }));

    expect(await response.text()).not.toContain("glpat-xxx");
  });
});
