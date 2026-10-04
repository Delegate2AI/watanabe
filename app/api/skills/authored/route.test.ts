import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invalidateAliasIndexCache } from "@/lib/authority/aliases";
import { buildSkillManifest } from "@/lib/skills/authored-manifest";

const requireIdentityMock = vi.fn();
vi.mock("@/lib/auth/identity", () => ({
  requireIdentity: (...args: unknown[]) => requireIdentityMock(...args),
}));

const canMock = vi.fn();
vi.mock("@/lib/authority/roles", () => ({
  can: (...args: unknown[]) => canMock(...args),
}));

const isSkillsEnabledMock = vi.fn();
vi.mock("@/lib/skills/config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/skills/config")>();
  return { ...actual, isSkillsEnabled: () => isSkillsEnabledMock() };
});

const authorGroupsMock = vi.fn();
vi.mock("@/lib/skills/authors", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/skills/authors")>();
  return { ...actual, authorGroups: (...args: unknown[]) => authorGroupsMock(...args) };
});

const loadSkillRegistryMock = vi.fn();
vi.mock("@/lib/skills/registry", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/skills/registry")>();
  return { ...actual, loadSkillRegistry: (...args: unknown[]) => loadSkillRegistryMock(...args) };
});

const createAuthoredSkillMock = vi.fn();
vi.mock("@/lib/skills/authored", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/skills/authored")>();
  return { ...actual, createAuthoredSkill: (...args: unknown[]) => createAuthoredSkillMock(...args) };
});

const { GET, POST, dynamic, runtime } = await import("./route");

const ALICE = { email: "alice@example.com", name: "Alice" };

const ALICE_ENTRY = {
  slug: "release-notes",
  title: "Release Notes",
  source: { type: "authored", author: "alice@example.com", rev: "abc123" },
  groups: ["engineering"],
  compat: { scripts: [], tools: [] },
};

const BOB_ENTRY = {
  slug: "onboarding",
  title: "Onboarding",
  source: { type: "authored", author: "bob@example.com", rev: "def456" },
  groups: ["hr"],
  compat: { scripts: [], tools: [] },
};

const REVOKED_ENTRY = {
  slug: "incident-review",
  title: "Incident Review",
  source: { type: "authored", author: "alice@example.com", rev: "999999" },
  groups: ["security"],
  compat: { scripts: [], tools: [] },
};

const GIT_ENTRY = {
  slug: "pdf-tools",
  title: "PDF Tools",
  source: { type: "git", url: "https://git.example/skills.git", ref: "main", commit: "abc" },
  groups: ["engineering"],
  compat: { scripts: [], tools: [] },
};

let storeRoot: string;
const savedEnv = { ...process.env };

function seedManifest(slug: string, description: string): void {
  const dir = path.join(storeRoot, slug);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "SKILL.md"), buildSkillManifest("Title", description, "Body text."));
}

function get(): Request {
  return new Request("http://localhost/api/skills/authored");
}

function post(body: unknown): Request {
  return new Request("http://localhost/api/skills/authored", {
    method: "POST",
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

beforeEach(() => {
  storeRoot = mkdtempSync(path.join(os.tmpdir(), "skills-authored-route-"));
  process.env.PORTAL_SKILLS_DIR = storeRoot;
  requireIdentityMock.mockReset().mockResolvedValue({ identity: ALICE });
  canMock.mockReset().mockReturnValue(false);
  isSkillsEnabledMock.mockReset().mockReturnValue(true);
  authorGroupsMock.mockReset().mockReturnValue(["engineering"]);
  process.env.MEMORY_CHECKOUT_DIR = storeRoot;
  invalidateAliasIndexCache();
  loadSkillRegistryMock
    .mockReset()
    .mockReturnValue({ entries: [ALICE_ENTRY, BOB_ENTRY, REVOKED_ENTRY, GIT_ENTRY], errors: [] });
  createAuthoredSkillMock.mockReset().mockResolvedValue({ ok: true, slug: "release-notes" });
});

afterEach(() => {
  rmSync(storeRoot, { recursive: true, force: true });
  process.env = { ...savedEnv };
  vi.restoreAllMocks();
});

describe("GET /api/skills/authored", () => {
  it("uses the required route runtime conventions", () => {
    expect(dynamic).toBe("force-dynamic");
    expect(runtime).toBe("nodejs");
  });

  it("404s when the flag is off, before checking the grant or the registry", async () => {
    isSkillsEnabledMock.mockReturnValue(false);

    const response = await GET(get());

    expect(response.status).toBe(404);
    expect(loadSkillRegistryMock).not.toHaveBeenCalled();
  });

  it("401s without an identity", async () => {
    requireIdentityMock.mockResolvedValue({ response: new Response(null, { status: 401 }) });

    expect((await GET(get())).status).toBe(401);
    expect(loadSkillRegistryMock).not.toHaveBeenCalled();
  });

  it("403s a caller with no grant and no admin role", async () => {
    authorGroupsMock.mockReturnValue([]);

    const response = await GET(get());

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: { code: "needs_role" } });
    expect(loadSkillRegistryMock).not.toHaveBeenCalled();
  });

  it("lists only the caller's own authored skills for a non-admin author", async () => {
    seedManifest("release-notes", "How to write them");
    seedManifest("onboarding", "For new hires");

    const response = await GET(get());
    const body = await response.json();

    expect(body.skills).toEqual([
      {
        slug: "release-notes",
        title: "Release Notes",
        description: "How to write them",
        groups: ["engineering"],
        rev: "abc123",
      },
    ]);
    expect(body.grantGroups).toEqual(["engineering"]);
  });

  it("hides an owned skill the caller's current grant no longer covers", async () => {
    seedManifest("release-notes", "How to write them");
    seedManifest("incident-review", "After the fact");

    const response = await GET(get());
    const body = await response.json();

    expect(body.skills.map((skill: { slug: string }) => skill.slug)).toEqual(["release-notes"]);
  });

  it("lists every authored skill, across authors, for an admin", async () => {
    canMock.mockReturnValue(true);
    authorGroupsMock.mockReturnValue(["engineering", "hr"]);
    seedManifest("release-notes", "How to write them");
    seedManifest("onboarding", "For new hires");

    const response = await GET(get());
    const body = await response.json();

    expect(body.skills.map((skill: { slug: string }) => skill.slug).sort()).toEqual([
      "incident-review",
      "onboarding",
      "release-notes",
    ]);
  });
});

describe("POST /api/skills/authored", () => {
  it("404s when the flag is off, before reading the body", async () => {
    isSkillsEnabledMock.mockReturnValue(false);

    const response = await POST(post({ title: "T", description: "D", body: "B", groups: [] }));

    expect(response.status).toBe(404);
    expect(createAuthoredSkillMock).not.toHaveBeenCalled();
  });

  it("401s without an identity", async () => {
    requireIdentityMock.mockResolvedValue({ response: new Response(null, { status: 401 }) });

    expect((await POST(post({ title: "T", description: "D", body: "B", groups: [] }))).status).toBe(401);
    expect(createAuthoredSkillMock).not.toHaveBeenCalled();
  });

  it("creates and attributes the request to the caller identity, ignoring a client-supplied author", async () => {
    const response = await POST(
      post({
        title: "Release Notes",
        description: "How to write them",
        body: "Do the thing.",
        groups: ["engineering"],
        author: "hacker@evil.com",
        actorEmail: "hacker@evil.com",
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ slug: "release-notes" });
    expect(createAuthoredSkillMock).toHaveBeenCalledWith({
      actorEmail: "alice@example.com",
      title: "Release Notes",
      description: "How to write them",
      body: "Do the thing.",
      groups: ["engineering"],
    });
  });

  it("400s a group outside the caller's grant", async () => {
    createAuthoredSkillMock.mockResolvedValue({ ok: false, error: "invalid groups" });

    const response = await POST(
      post({ title: "T", description: "D", body: "B", groups: ["marketing"] }),
    );

    expect(response.status).toBe(400);
  });

  it("400s a body field over its character cap", async () => {
    const response = await POST(
      post({ title: "T", description: "D", body: "x".repeat(100_001), groups: [] }),
    );

    expect(response.status).toBe(400);
    expect(createAuthoredSkillMock).not.toHaveBeenCalled();
  });

  it("413s a transport body past the capped-read limit", async () => {
    const response = await POST(
      post({ title: "T", description: "D", body: "x".repeat(300_000), groups: [] }),
    );

    expect(response.status).toBe(413);
    expect(createAuthoredSkillMock).not.toHaveBeenCalled();
  });

  it("403s an ungranted caller before the body is read, oversized or not", async () => {
    authorGroupsMock.mockReturnValue([]);

    const response = await POST(
      post({ title: "T", description: "D", body: "x".repeat(300_000), groups: [] }),
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: { code: "needs_role" } });
    expect(createAuthoredSkillMock).not.toHaveBeenCalled();
  });

  it("400s a body that is not json", async () => {
    const response = await POST(post("not-json"));

    expect(response.status).toBe(400);
  });

  it("403s a forbidden create", async () => {
    createAuthoredSkillMock.mockResolvedValue({ ok: false, error: "forbidden" });

    const response = await POST(post({ title: "T", description: "D", body: "B", groups: [] }));

    expect(response.status).toBe(403);
  });
});
