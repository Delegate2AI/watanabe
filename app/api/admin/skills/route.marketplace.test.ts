import { mkdtempSync, rmSync } from "node:fs";
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
vi.mock("@/lib/skills/store", () => ({
  writeSkills: (...args: unknown[]) => writeSkillsMock(...args),
  removeInstalledSkill: vi.fn(),
}));

const configuredMarketplacesMock = vi.fn();
const fetchMarketplaceIndexMock = vi.fn();
const installFromMarketplaceMock = vi.fn();
vi.mock("@/lib/skills/marketplace", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/skills/marketplace")>();
  return {
    ...actual,
    configuredMarketplaces: () => configuredMarketplacesMock(),
    fetchMarketplaceIndex: (...args: unknown[]) => fetchMarketplaceIndexMock(...args),
    installFromMarketplace: (...args: unknown[]) => installFromMarketplaceMock(...args),
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

const { POST } = await import("./route");

const INDEX_URL = "https://index.example/skills.json";

const ITEM = {
  name: "PDF Tools",
  description: "Reads PDFs.",
  url: "https://git.example/pdf.git",
  ref: "v1.2",
  subdir: "skills/pdf",
};

const INSTALLED = {
  ok: true,
  slug: "pdf-tools",
  validation: {
    ok: true,
    name: "PDF Tools",
    slug: "pdf-tools",
    description: "Reads PDFs.",
    compat: { scripts: [], tools: [], urls: [], blockedScripts: [] },
  },
  source: {
    type: "marketplace",
    index: INDEX_URL,
    name: "PDF Tools",
    url: "https://git.example/pdf.git",
    subdir: "skills/pdf",
    commit: "abc123",
  },
};

const BODY = {
  action: "install-marketplace",
  index: INDEX_URL,
  name: "PDF Tools",
  url: "https://git.example/pdf.git",
  groups: ["eng"],
};

function post(body: unknown): Request {
  return new Request("http://localhost/api/admin/skills", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

let storeRoot: string;
const savedEnv = { ...process.env };

beforeEach(() => {
  storeRoot = mkdtempSync(path.join(os.tmpdir(), "skills-admin-market-"));
  process.env.PORTAL_SKILLS_DIR = storeRoot;
  requireIdentityMock.mockReset().mockResolvedValue({ identity: { email: "admin@example.com" } });
  canMock.mockReset().mockReturnValue(true);
  loadAccessMock.mockReset().mockReturnValue({ groups: { eng: [] } });
  isSkillsEnabledMock.mockReset().mockReturnValue(true);
  loadSkillRegistryMock.mockReset().mockReturnValue({ entries: [], errors: [] });
  writeSkillsMock.mockReset().mockResolvedValue({ ok: true });
  configuredMarketplacesMock.mockReset().mockReturnValue([INDEX_URL]);
  fetchMarketplaceIndexMock.mockReset().mockResolvedValue({ ok: true, items: [ITEM], errors: [] });
  installFromMarketplaceMock.mockReset().mockResolvedValue(INSTALLED);
  invalidateMaterializedSkillsMock.mockReset();
});

afterEach(() => {
  rmSync(storeRoot, { recursive: true, force: true });
  process.env = { ...savedEnv };
  vi.restoreAllMocks();
});

describe("install-marketplace provenance", () => {
  it("calls the marketplace installer with exactly one argument", async () => {
    await POST(post(BODY));

    expect(installFromMarketplaceMock).toHaveBeenCalledTimes(1);
    expect(installFromMarketplaceMock.mock.calls[0]).toHaveLength(1);
  });

  it("installs the index's own entry, ref and subdir included", async () => {
    const response = await POST(post(BODY));

    expect(installFromMarketplaceMock).toHaveBeenCalledWith({ ...ITEM, index: INDEX_URL });
    expect(response.status).toBe(200);
    expect(fetchMarketplaceIndexMock).toHaveBeenCalledWith(INDEX_URL);
  });

  it("refuses an index the operator has not configured, before fetching it", async () => {
    const response = await POST(post({ ...BODY, index: "https://evil.example/skills.json" }));

    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: { detail: string } }).error.detail).toBe("index");
    expect(fetchMarketplaceIndexMock).not.toHaveBeenCalled();
    expect(installFromMarketplaceMock).not.toHaveBeenCalled();
  });

  it("refuses a repository the configured index does not list", async () => {
    const response = await POST(post({ ...BODY, url: "https://evil.example/x.git" }));

    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: { detail: string } }).error.detail).toBe("item");
    expect(installFromMarketplaceMock).not.toHaveBeenCalled();
  });

  it("refuses a name the configured index does not list", async () => {
    const response = await POST(post({ ...BODY, name: "Totally Legit" }));

    expect(response.status).toBe(400);
    expect(installFromMarketplaceMock).not.toHaveBeenCalled();
  });

  it("reports an index it could not read rather than installing anyway", async () => {
    fetchMarketplaceIndexMock.mockResolvedValue({ ok: false, reason: "HTTP 503" });

    const response = await POST(post(BODY));

    expect(response.status).toBe(400);
    expect(((await response.json()) as { reason: string }).reason).toContain("503");
    expect(installFromMarketplaceMock).not.toHaveBeenCalled();
  });

  it("refuses a request that tries to supply its own ref or subdir", async () => {
    const response = await POST(post({ ...BODY, ref: "attacker-branch" }));

    expect(response.status).toBe(400);
    expect(fetchMarketplaceIndexMock).not.toHaveBeenCalled();
  });
});
