import { describe, expect, it, vi, beforeEach } from "vitest";

const isKbDeleteEnabledMock = vi.fn(() => true);
vi.mock("@/lib/review/config", () => ({ isKbDeleteEnabled: () => isKbDeleteEnabledMock() }));

const isAdminMock = vi.fn(() => true);
vi.mock("@/lib/authority/groups", () => ({
  isAdmin: (...a: unknown[]) => isAdminMock(...(a as [])),
  loadGroups: () => ({ admins: ["boss@example.com"] }),
}));

const canMock = vi.fn(() => true);
vi.mock("@/lib/authority/roles", () => ({ can: (...a: unknown[]) => canMock(...(a as [])) }));

vi.mock("@/lib/auth/identity", () => ({
  requireIdentity: async () => ({ identity: { email: "boss@example.com", name: "Boss Person" } }),
}));

const proposeNoteDeletionMock = vi.fn();
vi.mock("@/lib/kb-write/delete-note", () => ({
  proposeNoteDeletion: (...a: unknown[]) => proposeNoteDeletionMock(...a),
}));

import { POST } from "./route";

function post(body: unknown): Request {
  return new Request("http://x/api/kb/delete", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function code(res: Response): Promise<string | undefined> {
  const body = (await res.json()) as { error?: { code?: string } };
  return body.error?.code;
}

beforeEach(() => {
  isKbDeleteEnabledMock.mockReset().mockReturnValue(true);
  isAdminMock.mockReset().mockReturnValue(true);
  canMock.mockReset().mockReturnValue(true);
  proposeNoteDeletionMock
    .mockReset()
    .mockResolvedValue({ ok: true, branch: "kb/boss/delete-comp-1", mrUrl: "https://gl/mr/9" });
});

describe("POST /api/kb/delete", () => {
  it("404s when the flag is off, before it looks at identity", async () => {
    isKbDeleteEnabledMock.mockReturnValue(false);
    const res = await POST(post({ path: "exec/comp.md" }));
    expect(res.status).toBe(404);
    expect(proposeNoteDeletionMock).not.toHaveBeenCalled();
  });

  it("403s needs_role for a non-admin, even one who can approve", async () => {
    isAdminMock.mockReturnValue(false);
    canMock.mockReturnValue(true);
    const res = await POST(post({ path: "exec/comp.md" }));
    expect(res.status).toBe(403);
    expect(await code(res)).toBe("needs_role");
    expect(proposeNoteDeletionMock).not.toHaveBeenCalled();
  });

  it("400s an invalid body", async () => {
    const res = await POST(post({ note: "exec/comp.md" }));
    expect(res.status).toBe(400);
    expect(await code(res)).toBe("invalid_request");
  });

  it("404s a path the admin cannot resolve", async () => {
    proposeNoteDeletionMock.mockResolvedValue({ ok: false, reason: "not_found" });
    const res = await POST(post({ path: "exec/missing.md" }));
    expect(res.status).toBe(404);
    expect(await code(res)).toBe("not_found");
  });

  it("404s a path outside the vault identically, so it is no existence oracle", async () => {
    proposeNoteDeletionMock.mockResolvedValue({ ok: false, reason: "forbidden" });
    const res = await POST(post({ path: "../access/roles.yaml" }));
    expect(res.status).toBe(404);
    expect(await code(res)).toBe("not_found");
  });

  it("503s write_unavailable with no write credential", async () => {
    proposeNoteDeletionMock.mockResolvedValue({ ok: false, reason: "write_unavailable" });
    expect((await POST(post({ path: "exec/comp.md" }))).status).toBe(503);
  });

  it("409s a conflict", async () => {
    proposeNoteDeletionMock.mockResolvedValue({ ok: false, reason: "conflict" });
    expect((await POST(post({ path: "exec/comp.md" }))).status).toBe(409);
  });

  it("500s an unexpected failure", async () => {
    proposeNoteDeletionMock.mockResolvedValue({ ok: false, reason: "failed" });
    expect((await POST(post({ path: "exec/comp.md" }))).status).toBe(500);
  });

  it("proposes the deletion as the requesting admin and returns the merge request", async () => {
    const res = await POST(post({ path: "exec/comp.md" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ branch: "kb/boss/delete-comp-1", mrUrl: "https://gl/mr/9" });
    expect(proposeNoteDeletionMock).toHaveBeenCalledWith({
      relPath: "exec/comp.md",
      actorEmail: "boss@example.com",
      actorName: "Boss Person",
    });
  });
});
