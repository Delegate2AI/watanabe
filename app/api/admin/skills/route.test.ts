import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const requireIdentityMock = vi.fn();
vi.mock("@/lib/auth/identity", () => ({
  requireIdentity: (...args: unknown[]) => requireIdentityMock(...args),
}));

const canMock = vi.fn();
vi.mock("@/lib/authority/roles", () => ({
  can: (...args: unknown[]) => canMock(...args),
}));

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

const configuredMarketplacesMock = vi.fn();
const fetchMarketplaceIndexMock = vi.fn();
vi.mock("@/lib/skills/marketplace", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/skills/marketplace")>();
  return {
    ...actual,
    configuredMarketplaces: () => configuredMarketplacesMock(),
    fetchMarketplaceIndex: (...args: unknown[]) => fetchMarketplaceIndexMock(...args),
  };
});

const invalidateMaterializedSkillsMock = vi.fn();
vi.mock("@/lib/skills/materialize", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/skills/materialize")>();
  return {
    ...actual,
    invalidateMaterializedSkills: (...args: unknown[]) => invalidateMaterializedSkillsMock(...args),
  };
});

const { GET, POST, dynamic, runtime } = await import("./route");

const IDENTITY = { email: "admin@example.com", name: "Admin" };

const ENTRY = {
  slug: "pdf-tools",
  title: "PDF Tools",
  source: { type: "git", url: "https://git.example/skills.git", ref: "main", commit: "abc123" },
  groups: ["eng"],
  compat: { scripts: [], tools: [] },
};

const INSTALL_GIT = {
  action: "install-git",
  url: "https://git.example/skills.git",
  ref: "main",
  groups: ["eng"],
};

function get(): Request {
  return new Request("http://localhost/api/admin/skills");
}

function post(body: unknown): Request {
  return new Request("http://localhost/api/admin/skills", {
    method: "POST",
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

let storeRoot: string;
const savedEnv = { ...process.env };

beforeEach(() => {
  storeRoot = mkdtempSync(path.join(os.tmpdir(), "skills-admin-route-"));
  process.env.PORTAL_SKILLS_DIR = storeRoot;
  requireIdentityMock.mockReset().mockResolvedValue({ identity: IDENTITY });
  canMock.mockReset().mockReturnValue(true);
  loadAccessMock.mockReset().mockReturnValue({ groups: { eng: ["a@example.com"] } });
  isSkillsEnabledMock.mockReset().mockReturnValue(true);
  loadSkillRegistryMock.mockReset().mockReturnValue({ entries: [ENTRY], errors: [] });
  writeSkillsMock.mockReset().mockResolvedValue({ ok: true });
  removeInstalledSkillMock.mockReset().mockResolvedValue({ ok: true });
  installFromGitMock.mockReset();
  configuredMarketplacesMock.mockReset().mockReturnValue([]);
  fetchMarketplaceIndexMock.mockReset();
  invalidateMaterializedSkillsMock.mockReset();
});

afterEach(() => {
  rmSync(storeRoot, { recursive: true, force: true });
  process.env = { ...savedEnv };
  vi.restoreAllMocks();
});

describe("GET /api/admin/skills", () => {
  it("uses the required route runtime conventions", () => {
    expect(dynamic).toBe("force-dynamic");
    expect(runtime).toBe("nodejs");
  });

  it("401s without an identity, before touching the registry", async () => {
    requireIdentityMock.mockResolvedValue({ response: new Response(null, { status: 401 }) });

    expect((await GET(get())).status).toBe(401);
    expect(loadSkillRegistryMock).not.toHaveBeenCalled();
  });

  it("404s when the flag is off, without reading the registry or the marketplaces", async () => {
    isSkillsEnabledMock.mockReturnValue(false);

    const response = await GET(get());

    expect(response.status).toBe(404);
    expect(loadSkillRegistryMock).not.toHaveBeenCalled();
    expect(configuredMarketplacesMock).not.toHaveBeenCalled();
  });

  it("403s a caller without manageAccess", async () => {
    canMock.mockReturnValue(false);

    const response = await GET(get());

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: { code: "needs_role" } });
    expect(loadSkillRegistryMock).not.toHaveBeenCalled();
  });

  it("reports installed when the store holds the slug, and not when it does not", async () => {
    const absent = await (await GET(get())).json();
    expect(absent.entries).toEqual([{ ...ENTRY, status: "ok", installed: false }]);

    mkdirSync(path.join(storeRoot, "pdf-tools"), { recursive: true });
    const present = await (await GET(get())).json();
    expect(present.entries[0].installed).toBe(true);
  });

  it("lists a rejected registry entry as a disabled row", async () => {
    loadSkillRegistryMock.mockReturnValue({
      entries: [ENTRY],
      errors: [{ slug: "broken", reason: "groups: expected array" }],
    });

    const body = await (await GET(get())).json();

    expect(body.entries).toEqual([
      { slug: "broken", status: "disabled", reason: "groups: expected array", installed: false },
      { ...ENTRY, status: "ok", installed: false },
    ]);
  });

  it("returns each configured marketplace with its items", async () => {
    configuredMarketplacesMock.mockReturnValue(["https://index.example/skills.json"]);
    fetchMarketplaceIndexMock.mockResolvedValue({
      ok: true,
      items: [{ name: "PDF", description: "", url: "https://git.example/pdf.git" }],
      errors: [],
    });

    const body = await (await GET(get())).json();

    expect(body.marketplaces[0]).toEqual({
      url: "https://index.example/skills.json",
      label: "https://index.example/skills.json",
      items: [{ name: "PDF", description: "", url: "https://git.example/pdf.git" }],
      errors: [],
    });
    // The built-in index rides along behind it, resolved from a bundled
    // document rather than fetched, so it is asserted by identity rather than
    // by contents: what is IN it belongs to marketplace-builtin.test.ts.
    expect(body.marketplaces).toHaveLength(2);
    expect(body.marketplaces[1].url).toBe("builtin:anthropic-skills");
    expect(body.marketplaces[1].label).toBe("Anthropic skills (built in)");
    expect(body.marketplaces[1].items.length).toBeGreaterThan(0);
    expect(fetchMarketplaceIndexMock).toHaveBeenCalledTimes(1);
  });

  it("reports an unreachable marketplace without leaking a server path", async () => {
    configuredMarketplacesMock.mockReturnValue(["https://index.example/skills.json"]);
    fetchMarketplaceIndexMock.mockResolvedValue({
      ok: false,
      reason: "could not read /srv/portal/.data/skills/cache",
    });

    const body = await (await GET(get())).json();

    expect(body.marketplaces[0].url).toBe("https://index.example/skills.json");
    expect(body.marketplaces[0].error).not.toContain("/srv/portal");
  });
});

describe("POST /api/admin/skills gate and body", () => {
  it("401s without an identity, before installing or writing", async () => {
    requireIdentityMock.mockResolvedValue({ response: new Response(null, { status: 401 }) });

    expect((await POST(post(INSTALL_GIT))).status).toBe(401);
    expect(installFromGitMock).not.toHaveBeenCalled();
    expect(writeSkillsMock).not.toHaveBeenCalled();
  });

  it("404s when the flag is off", async () => {
    isSkillsEnabledMock.mockReturnValue(false);

    expect((await POST(post(INSTALL_GIT))).status).toBe(404);
    expect(installFromGitMock).not.toHaveBeenCalled();
  });

  it("403s a caller without manageAccess, before parsing the body", async () => {
    canMock.mockReturnValue(false);

    const response = await POST(post("not-json"));

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: { code: "needs_role" } });
    expect(installFromGitMock).not.toHaveBeenCalled();
    expect(loadSkillRegistryMock).not.toHaveBeenCalled();
  });

  it("answers a non-admin identically for an unknown slug and a registered one", async () => {
    canMock.mockReturnValue(false);

    const unknown = await POST(post({ action: "uninstall", slug: "no-such-skill" }));
    const known = await POST(post({ action: "uninstall", slug: "pdf-tools" }));

    expect(unknown.status).toBe(known.status);
    expect(await unknown.text()).toBe(await known.text());
    expect(removeInstalledSkillMock).not.toHaveBeenCalled();
  });

  it.each([
    ["a body that is not json", "not-json"],
    ["an unknown action", { action: "rename", slug: "pdf-tools" }],
    ["no action at all", { slug: "pdf-tools" }],
    ["install-git with no url", { action: "install-git", ref: "main", groups: [] }],
    ["install-git with no ref", { action: "install-git", url: "https://g.example/s.git", groups: [] }],
    ["install-git with an unknown field", { ...INSTALL_GIT, nope: 1 }],
    ["uninstall with an empty slug", { action: "uninstall", slug: "" }],
    ["set-groups with a non-string group", { action: "set-groups", slug: "pdf-tools", groups: [1] }],
  ])("rejects %s with 400 and never installs or writes", async (_label, body) => {
    const response = await POST(post(body));

    expect(response.status).toBe(400);
    expect(installFromGitMock).not.toHaveBeenCalled();
    expect(writeSkillsMock).not.toHaveBeenCalled();
  });

});
