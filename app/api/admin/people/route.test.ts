import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const requireIdentityMock = vi.fn();
const canMock = vi.fn();
const upsertPersonMock = vi.fn<() => Promise<void>>();
const loadGroupsMock = vi.fn(() => ({ exec: ["member@example.com"] }) as Record<string, string[]>);
/** Stands in for the file the write path commits and the route re-reads. */
const directory: Record<string, { name: string; source: string }> = {};

vi.mock("@/lib/auth/identity", () => ({
  requireIdentity: (...args: unknown[]) => requireIdentityMock(...args),
}));
vi.mock("@/lib/authority/roles", () => ({
  can: (...args: unknown[]) => canMock(...args),
}));
vi.mock("@/lib/people/store", () => ({
  upsertPerson: (...args: unknown[]) => upsertPersonMock(...(args as [])),
  loadPeople: () => directory,
}));
vi.mock("@/lib/authority/groups", () => ({
  loadGroups: (...args: unknown[]) => loadGroupsMock(...(args as [])),
  isKnownMember: (email: string, groups: Record<string, string[]>) =>
    Object.values(groups).some((members) => members.includes(email.trim().toLowerCase())),
}));

import { PATCH, dynamic, runtime } from "./route";

function patch(body: unknown): Request {
  return new Request("http://t/api/admin/people", { method: "PATCH", body: JSON.stringify(body) });
}

const savedEnv = { ...process.env };

beforeEach(() => {
  requireIdentityMock.mockReset().mockResolvedValue({ identity: { email: "admin@example.com" } });
  canMock.mockReset().mockReturnValue(true);
  for (const key of Object.keys(directory)) delete directory[key];
  upsertPersonMock.mockReset().mockImplementation(async (...args: unknown[]) => {
    const [email, record] = args as [string, { name: string; source: string }];
    directory[email] = record;
  });
  process.env.PEOPLE_ENABLED = "1";
});

afterEach(() => {
  process.env = { ...savedEnv };
  vi.restoreAllMocks();
});

describe("PATCH /api/admin/people", () => {
  it("uses the required route runtime conventions and writes a manual record", async () => {
    const response = await PATCH(patch({ email: "Member@example.com", name: "  Member One  " }));

    expect(dynamic).toBe("force-dynamic");
    expect(runtime).toBe("nodejs");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ email: "member@example.com", name: "Member One" });
    expect(upsertPersonMock).toHaveBeenCalledWith(
      "member@example.com",
      { name: "Member One", source: "manual" },
      { actorEmail: "admin@example.com" },
    );
  });

  it("denies a non-admin before parsing or writing", async () => {
    canMock.mockReturnValue(false);

    const response = await PATCH(new Request("http://t/api/admin/people", {
      method: "PATCH",
      body: "not-json",
    }));

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: { code: "needs_role" } });
    expect(upsertPersonMock).not.toHaveBeenCalled();
  });

  it("is not routable when the flag is off", async () => {
    delete process.env.PEOPLE_ENABLED;

    const response = await PATCH(patch({ email: "member@example.com", name: "Member One" }));

    expect(response.status).toBe(404);
    expect(upsertPersonMock).not.toHaveBeenCalled();
  });

  it.each([
    ["a missing name", { email: "member@example.com" }],
    ["a blank name", { email: "member@example.com", name: "   " }],
    ["a bad email", { email: "nope", name: "Member One" }],
    ["an extra field", { email: "member@example.com", name: "Member One", source: "idp" }],
  ])("rejects %s with 400", async (_label, body) => {
    const response = await PATCH(patch(body));

    expect(response.status).toBe(400);
    expect(upsertPersonMock).not.toHaveBeenCalled();
  });

  it("rejects a body that is not json", async () => {
    const response = await PATCH(new Request("http://t/api/admin/people", {
      method: "PATCH",
      body: "not-json",
    }));

    expect(response.status).toBe(400);
  });

  it("returns 404 for an email in no group", async () => {
    const response = await PATCH(patch({ email: "stranger@example.com", name: "Stranger" }));

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: { code: "not_found" } });
    expect(upsertPersonMock).not.toHaveBeenCalled();
  });

  it("returns 401 when there is no identity", async () => {
    requireIdentityMock.mockResolvedValue({ response: new Response(null, { status: 401 }) });

    expect((await PATCH(patch({ email: "member@example.com", name: "Member One" }))).status).toBe(401);
  });

  it("reports a write the directory swallowed rather than claiming success", async () => {
    upsertPersonMock.mockResolvedValue(undefined);

    const response = await PATCH(patch({ email: "member@example.com", name: "Member One" }));

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: { code: "internal" } });
  });
});
