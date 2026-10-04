import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const requireIdentityMock = vi.fn();
vi.mock("@/lib/auth/identity", () => ({
  requireIdentity: (...args: unknown[]) => requireIdentityMock(...args),
}));

const isSkillsEnabledMock = vi.fn();
vi.mock("@/lib/skills/config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/skills/config")>();
  return { ...actual, isSkillsEnabled: () => isSkillsEnabledMock() };
});

const updateAuthoredSkillMock = vi.fn();
const deleteAuthoredSkillMock = vi.fn();
const authoredEditGateMock = vi.fn();
vi.mock("@/lib/skills/authored", () => ({
  updateAuthoredSkill: (...args: unknown[]) => updateAuthoredSkillMock(...args),
  deleteAuthoredSkill: (...args: unknown[]) => deleteAuthoredSkillMock(...args),
  authoredEditGate: (...args: unknown[]) => authoredEditGateMock(...args),
}));

const readAuthoredSkillMock = vi.fn();
vi.mock("@/lib/skills/authored-read", () => ({
  readAuthoredSkill: (...args: unknown[]) => readAuthoredSkillMock(...args),
}));

const { GET, PUT, DELETE, dynamic, runtime } = await import("./route");

const ALICE = { email: "alice@example.com", name: "Alice" };

const STORED = {
  slug: "release-notes",
  title: "Release Notes",
  description: "How to write them",
  groups: ["engineering"],
  rev: "abc123abc123",
  body: "Do the thing.",
};

function get(slug: string): Request {
  return new Request(`http://localhost/api/skills/authored/${slug}`);
}

function put(slug: string, body: unknown): Request {
  return new Request(`http://localhost/api/skills/authored/${slug}`, {
    method: "PUT",
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function del(slug: string): Request {
  return new Request(`http://localhost/api/skills/authored/${slug}`, { method: "DELETE" });
}

function context(slug: string) {
  return { params: Promise.resolve({ slug }) };
}

beforeEach(() => {
  requireIdentityMock.mockReset().mockResolvedValue({ identity: ALICE });
  isSkillsEnabledMock.mockReset().mockReturnValue(true);
  updateAuthoredSkillMock.mockReset().mockResolvedValue({ ok: true, slug: "release-notes" });
  deleteAuthoredSkillMock.mockReset().mockResolvedValue({ ok: true, slug: "release-notes" });
  readAuthoredSkillMock.mockReset().mockResolvedValue({ ok: true, skill: STORED });
  authoredEditGateMock.mockReset().mockReturnValue({ ok: true });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("GET /api/skills/authored/[slug]", () => {
  it("returns the stored body so its author can edit what they published", async () => {
    const response = await GET(get("release-notes"), context("release-notes"));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(STORED);
    expect(readAuthoredSkillMock).toHaveBeenCalledWith({
      actorEmail: "alice@example.com",
      slug: "release-notes",
    });
  });

  it("404s when the flag is off, without reading the skill", async () => {
    isSkillsEnabledMock.mockReturnValue(false);

    const response = await GET(get("release-notes"), context("release-notes"));

    expect(response.status).toBe(404);
    expect(readAuthoredSkillMock).not.toHaveBeenCalled();
  });

  it("401s without an identity", async () => {
    requireIdentityMock.mockResolvedValue({ response: new Response(null, { status: 401 }) });

    expect((await GET(get("release-notes"), context("release-notes"))).status).toBe(401);
    expect(readAuthoredSkillMock).not.toHaveBeenCalled();
  });

  it("403s a read from someone who could not edit it, with the same shape PUT uses", async () => {
    readAuthoredSkillMock.mockResolvedValue({ ok: false, error: "forbidden" });

    const response = await GET(get("release-notes"), context("release-notes"));

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: { code: "needs_role" } });
  });

  it("404s a slug that is not an authored skill", async () => {
    readAuthoredSkillMock.mockResolvedValue({ ok: false, error: "not an authored skill" });

    const response = await GET(get("no-such-skill"), context("no-such-skill"));

    expect(response.status).toBe(404);
  });
});

describe("PUT /api/skills/authored/[slug]", () => {
  it("uses the required route runtime conventions", () => {
    expect(dynamic).toBe("force-dynamic");
    expect(runtime).toBe("nodejs");
  });

  it("404s when the flag is off, before reading the body", async () => {
    isSkillsEnabledMock.mockReturnValue(false);

    const response = await PUT(put("release-notes", { body: "New body." }), context("release-notes"));

    expect(response.status).toBe(404);
    expect(updateAuthoredSkillMock).not.toHaveBeenCalled();
  });

  it("401s without an identity", async () => {
    requireIdentityMock.mockResolvedValue({ response: new Response(null, { status: 401 }) });

    expect((await PUT(put("release-notes", { body: "New body." }), context("release-notes"))).status).toBe(401);
    expect(updateAuthoredSkillMock).not.toHaveBeenCalled();
  });

  it("403s an update from a non-author", async () => {
    updateAuthoredSkillMock.mockResolvedValue({ ok: false, error: "forbidden" });

    const response = await PUT(put("release-notes", { body: "Hijacked." }), context("release-notes"));

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: { code: "needs_role" } });
  });

  it("400s a group outside the caller's grant", async () => {
    updateAuthoredSkillMock.mockResolvedValue({ ok: false, error: "invalid groups" });

    const response = await PUT(
      put("release-notes", { groups: ["marketing"] }),
      context("release-notes"),
    );

    expect(response.status).toBe(400);
  });

  it("400s a body field over its character cap", async () => {
    const response = await PUT(
      put("release-notes", { title: "x".repeat(65) }),
      context("release-notes"),
    );

    expect(response.status).toBe(400);
    expect(updateAuthoredSkillMock).not.toHaveBeenCalled();
  });

  it("413s a transport body past the capped-read limit", async () => {
    const response = await PUT(
      put("release-notes", { body: "x".repeat(300_000) }),
      context("release-notes"),
    );

    expect(response.status).toBe(413);
    expect(updateAuthoredSkillMock).not.toHaveBeenCalled();
  });

  it("403s a caller who may not edit the skill before the body is read, oversized or not", async () => {
    authoredEditGateMock.mockReturnValue({ ok: false, error: "forbidden" });

    const response = await PUT(
      put("release-notes", { body: "x".repeat(300_000) }),
      context("release-notes"),
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: { code: "needs_role" } });
    expect(updateAuthoredSkillMock).not.toHaveBeenCalled();
  });

  it("404s a slug that is not authored before the body is read", async () => {
    authoredEditGateMock.mockReturnValue({ ok: false, error: "not an authored skill" });

    const response = await PUT(put("pdf-tools", { body: "x" }), context("pdf-tools"));

    expect(response.status).toBe(404);
    expect(updateAuthoredSkillMock).not.toHaveBeenCalled();
  });

  it("updates and attributes the request to the caller identity, never a client-supplied one", async () => {
    const response = await PUT(
      put("release-notes", { body: "Do it better.", actorEmail: "hacker@evil.com" }),
      context("release-notes"),
    );

    expect(response.status).toBe(200);
    expect(updateAuthoredSkillMock).toHaveBeenCalledWith({
      actorEmail: "alice@example.com",
      slug: "release-notes",
      title: undefined,
      description: undefined,
      body: "Do it better.",
      groups: undefined,
    });
  });

  it("404s an update to a slug that is not an authored skill", async () => {
    updateAuthoredSkillMock.mockResolvedValue({ ok: false, error: "not an authored skill" });

    const response = await PUT(put("not-mine", { body: "x" }), context("not-mine"));

    expect(response.status).toBe(404);
  });
});

describe("DELETE /api/skills/authored/[slug]", () => {
  it("404s when the flag is off", async () => {
    isSkillsEnabledMock.mockReturnValue(false);

    const response = await DELETE(del("release-notes"), context("release-notes"));

    expect(response.status).toBe(404);
    expect(deleteAuthoredSkillMock).not.toHaveBeenCalled();
  });

  it("401s without an identity", async () => {
    requireIdentityMock.mockResolvedValue({ response: new Response(null, { status: 401 }) });

    expect((await DELETE(del("release-notes"), context("release-notes"))).status).toBe(401);
    expect(deleteAuthoredSkillMock).not.toHaveBeenCalled();
  });

  it("403s a delete from a non-author", async () => {
    deleteAuthoredSkillMock.mockResolvedValue({ ok: false, error: "forbidden" });

    const response = await DELETE(del("release-notes"), context("release-notes"));

    expect(response.status).toBe(403);
  });

  it("removes the skill for the author", async () => {
    const response = await DELETE(del("release-notes"), context("release-notes"));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ removed: true });
    expect(deleteAuthoredSkillMock).toHaveBeenCalledWith({
      actorEmail: "alice@example.com",
      slug: "release-notes",
    });
  });

  it("404s a delete of a slug that is not an authored skill", async () => {
    deleteAuthoredSkillMock.mockResolvedValue({ ok: false, error: "not an authored skill" });

    const response = await DELETE(del("no-such-skill"), context("no-such-skill"));

    expect(response.status).toBe(404);
  });
});
