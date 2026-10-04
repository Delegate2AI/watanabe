import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * How `POST /api/admin/skills` reads its body: the cap, and what happens when
 * the body never arrives whole. An App Router handler has no default body
 * limit, so both are the route's own problem.
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
vi.mock("@/lib/skills/store", () => ({
  writeSkills: (...args: unknown[]) => writeSkillsMock(...args),
  removeInstalledSkill: vi.fn(),
}));

const installFromGitMock = vi.fn();
vi.mock("@/lib/skills/install", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/skills/install")>();
  return { ...actual, installFromGit: (...args: unknown[]) => installFromGitMock(...args) };
});

const { POST } = await import("./route");
const { MAX_SKILL_ACTION_BODY_BYTES } = await import("@/lib/skills/config");

const INSTALL_GIT = {
  action: "install-git",
  url: "https://git.example/skills.git",
  ref: "main",
  groups: [],
};

const URL_UNDER_TEST = "http://localhost/api/admin/skills";

function post(body: string, headers?: Record<string, string>): Request {
  return new Request(URL_UNDER_TEST, { method: "POST", body, headers });
}

/** A body delivered in chunks, optionally failing part way, with no declared length. */
function streamPost(chunks: string[], failure?: Error): Request {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      if (failure === undefined) controller.close();
      else controller.error(failure);
    },
  });
  return new Request(URL_UNDER_TEST, {
    method: "POST",
    body: stream,
    duplex: "half",
  } as RequestInit & { duplex: "half" });
}

beforeEach(() => {
  requireIdentityMock.mockReset().mockResolvedValue({ identity: { email: "admin@example.com" } });
  canMock.mockReset().mockReturnValue(true);
  loadAccessMock.mockReset().mockReturnValue({ groups: {} });
  isSkillsEnabledMock.mockReset().mockReturnValue(true);
  loadSkillRegistryMock.mockReset().mockReturnValue({ entries: [], errors: [] });
  writeSkillsMock.mockReset().mockResolvedValue({ ok: true });
  installFromGitMock.mockReset().mockResolvedValue({ ok: false, reason: "no SKILL.md" });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("POST /api/admin/skills body reading", () => {
  it("413s a body over the action cap, without parsing it", async () => {
    const response = await POST(post(`{"padding":"${"x".repeat(MAX_SKILL_ACTION_BODY_BYTES)}"}`));

    expect(response.status).toBe(413);
    expect(installFromGitMock).not.toHaveBeenCalled();
  });

  it("413s a declared length over the action cap", async () => {
    const request = post(JSON.stringify(INSTALL_GIT), {
      "content-length": String(MAX_SKILL_ACTION_BODY_BYTES + 1),
    });

    expect((await POST(request)).status).toBe(413);
    expect(installFromGitMock).not.toHaveBeenCalled();
  });

  it("413s a chunked body that declares no length at all", async () => {
    const chunk = "y".repeat(8_000);
    const chunks = Array.from({ length: 16 }, () => chunk);

    const response = await POST(streamPost(chunks));

    expect(response.status).toBe(413);
    expect(installFromGitMock).not.toHaveBeenCalled();
  });

  it("accepts a body just under the cap, so the limit is not merely rejecting everything", async () => {
    const response = await POST(post(JSON.stringify({ ...INSTALL_GIT, subdir: "s".repeat(200) })));

    expect(response.status).not.toBe(413);
  });

  it("answers a body that fails mid-read with a coded 400, never a throw", async () => {
    const failure = new Error("client went away at /Users/secret/path");

    const response = await POST(streamPost(['{"action":"insta'], failure));

    expect(response.status).toBe(400);
    const text = await response.text();
    expect(JSON.parse(text)).toEqual({ error: { code: "invalid_request", detail: "body" } });
    expect(text).not.toContain("/Users/secret");
    expect(installFromGitMock).not.toHaveBeenCalled();
  });

  it("treats a body that fails on the very first read the same way", async () => {
    const response = await POST(streamPost([], new Error("aborted")));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: { code: "invalid_request", detail: "body" } });
  });
});
