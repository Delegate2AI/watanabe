import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The response half of the contract with the `/admin/skills` client.
 *
 * The client reads `slug`, `replaced`, `commit`, `previousCommit`, `warning`,
 * `blockedScripts`, and `reason` off these replies, and its own tests answer
 * from a mocked fetch, so a field renamed or dropped here would not fail
 * anything on either side: the surface would simply stop showing a banner, which
 * is quieter than a 400 and harder to notice. These assertions pin the key set
 * of every reply so a rename fails here instead.
 *
 * Deliberately keys and types only. Values are covered by the behaviour tests,
 * and pinning them here would make this file fail for reasons that are not
 * contract breaks.
 */

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

vi.mock("@/lib/skills/materialize", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/skills/materialize")>();
  return { ...actual, invalidateMaterializedSkills: () => {} };
});

const { POST } = await import("./route");

const ENTRY = {
  slug: "pdf-tools",
  title: "PDF Tools",
  source: { type: "git", url: "https://git.example/skills.git", ref: "main", commit: "old111" },
  groups: ["eng"],
  compat: { scripts: [], tools: [] },
};

function installed(blockedScripts: string[] = []) {
  return {
    ok: true,
    slug: "pdf-tools",
    validation: {
      ok: true,
      name: "PDF Tools",
      slug: "pdf-tools",
      description: "does things",
      compat: { scripts: [], tools: [], urls: [], blockedScripts },
    },
    source: { type: "git", url: "https://git.example/skills.git", ref: "main", commit: "new222" },
  };
}

const GIT_BODY = {
  action: "install-git",
  url: "https://git.example/skills.git",
  ref: "main",
  groups: ["eng"],
};

async function send(body: unknown): Promise<Record<string, unknown>> {
  const response = await POST(
    new Request("http://localhost/api/admin/skills", { method: "POST", body: JSON.stringify(body) }),
  );
  return (await response.json()) as Record<string, unknown>;
}

function keys(body: Record<string, unknown>): string[] {
  return Object.keys(body).sort();
}

let storeRoot: string;
const savedEnv = { ...process.env };

beforeEach(() => {
  storeRoot = mkdtempSync(path.join(os.tmpdir(), "skills-admin-contract-"));
  process.env.PORTAL_SKILLS_DIR = storeRoot;
  requireIdentityMock.mockReset().mockResolvedValue({ identity: { email: "admin@example.com" } });
  canMock.mockReset().mockReturnValue(true);
  loadAccessMock.mockReset().mockReturnValue({ groups: { eng: [], ops: [] } });
  isSkillsEnabledMock.mockReset().mockReturnValue(true);
  loadSkillRegistryMock.mockReset().mockReturnValue({ entries: [], errors: [] });
  writeSkillsMock.mockReset().mockResolvedValue({ ok: true });
  removeInstalledSkillMock.mockReset().mockResolvedValue({ ok: true });
  installFromGitMock.mockReset().mockResolvedValue(installed());
});

afterEach(() => {
  rmSync(storeRoot, { recursive: true, force: true });
  process.env = { ...savedEnv };
  vi.restoreAllMocks();
});

describe("success payload keys", () => {
  it("a first install reports ok, slug, replaced, and commit", async () => {
    const body = await send(GIT_BODY);

    expect(keys(body)).toEqual(["commit", "ok", "replaced", "slug"]);
    expect(body.ok).toBe(true);
    expect(typeof body.slug).toBe("string");
    expect(typeof body.replaced).toBe("boolean");
    expect(typeof body.commit).toBe("string");
  });

  it("a re-install adds previousCommit and nothing else", async () => {
    loadSkillRegistryMock.mockReturnValue({ entries: [ENTRY], errors: [] });

    const body = await send(GIT_BODY);

    expect(keys(body)).toEqual(["commit", "ok", "previousCommit", "replaced", "slug"]);
    expect(typeof body.previousCommit).toBe("string");
  });

  it("an install carrying unrunnable scripts adds blockedScripts as an array of strings", async () => {
    installFromGitMock.mockResolvedValue(installed(["scripts/curl.py"]));

    const body = await send(GIT_BODY);

    expect(keys(body)).toEqual(["blockedScripts", "commit", "ok", "replaced", "slug"]);
    expect(Array.isArray(body.blockedScripts)).toBe(true);
    expect(typeof (body.blockedScripts as string[])[0]).toBe("string");
  });

  it("an update reports the same keys as a re-install", async () => {
    loadSkillRegistryMock.mockReturnValue({ entries: [ENTRY], errors: [] });

    const body = await send({ action: "update", slug: "pdf-tools" });

    expect(keys(body)).toEqual(["commit", "ok", "previousCommit", "replaced", "slug"]);
  });

  it("an uninstall reports ok and slug, and adds warning only when the store survived", async () => {
    expect(keys(await send({ action: "uninstall", slug: "pdf-tools" }))).toEqual(["ok", "slug"]);

    mkdirSync(path.join(storeRoot, "pdf-tools"), { recursive: true });
    const warned = await send({ action: "uninstall", slug: "pdf-tools" });

    expect(keys(warned)).toEqual(["ok", "slug", "warning"]);
    expect(typeof warned.warning).toBe("string");
  });

  it("a set-groups reports ok and slug", async () => {
    const body = await send({ action: "set-groups", slug: "pdf-tools", groups: ["ops"] });

    expect(keys(body)).toEqual(["ok", "slug"]);
  });
});

describe("failure payload keys", () => {
  it("a coded refusal carries the error object alone", async () => {
    const body = await send({ action: "set-groups", slug: "pdf-tools", groups: ["ghosts"] });

    expect(keys(body)).toEqual(["error"]);
    expect(keys(body.error as Record<string, unknown>)).toEqual(["code", "detail"]);
  });

  it("an install refusal adds a reason string", async () => {
    installFromGitMock.mockResolvedValue({ ok: false, reason: "no SKILL.md at the root" });

    const body = await send(GIT_BODY);

    expect(keys(body)).toEqual(["error", "reason"]);
    expect(typeof body.reason).toBe("string");
  });

  it("an update that overwrote another skill adds both reason and warning", async () => {
    loadSkillRegistryMock.mockReturnValue({
      entries: [ENTRY, { ...ENTRY, slug: "exec-briefing" }],
      errors: [],
    });
    installFromGitMock.mockResolvedValue({
      ...installed(),
      slug: "exec-briefing",
      validation: { ...installed().validation, slug: "exec-briefing" },
    });

    const body = await send({ action: "update", slug: "pdf-tools" });

    expect(keys(body)).toEqual(["error", "reason", "warning"]);
    expect(typeof body.warning).toBe("string");
  });
});
