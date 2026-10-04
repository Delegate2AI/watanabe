import { beforeEach, describe, expect, it, vi } from "vitest";

let member = true;
vi.mock("@/lib/llm/config", () => ({ isLlmKeysEnabled: () => true }));
vi.mock("@/lib/auth/identity", () => ({ requireIdentity: async () => ({ identity: { email: "Ana@corp.io" } }) }));
vi.mock("@/lib/authority/aliases", () => ({ aliasIndex: () => ({}), canonicalEmail: (e: string) => e.toLowerCase() }));
vi.mock("@/lib/authority/groups", () => ({ loadGroups: () => ({}), isKnownMember: () => member }));
vi.mock("@/lib/db/client", () => ({ getDb: () => ({}) }));
const listMock = vi.fn<(...a: unknown[]) => unknown[]>(() => []);
vi.mock("@/lib/db/llm-requests", () => ({ listBudgetRequests: (...a: unknown[]) => listMock(...a) }));
const askMock = vi.fn();
vi.mock("@/lib/llm/requests", () => ({ requestMoreTokens: (...a: unknown[]) => askMock(...a) }));

const { GET, POST } = await import("./route");
const url = "http://localhost/api/settings/llm-requests";

beforeEach(() => {
  member = true;
  listMock.mockClear();
  askMock.mockReset();
});

describe("/api/settings/llm-requests", () => {
  it("404s for someone not on the roster", async () => {
    member = false;
    expect((await GET(new Request(url))).status).toBe(404);
  });

  it("lists only the caller's requests", async () => {
    await GET(new Request(url));
    expect(listMock).toHaveBeenCalledWith({}, { requesterEmail: "ana@corp.io" });
  });

  it("files a request as the caller and answers 201", async () => {
    askMock.mockReturnValue({ ok: true, value: { id: "r1" } });
    const res = await POST(new Request(url, { method: "POST", body: JSON.stringify({ groupSlug: "paid", tokens: 10, reason: "x" }) }));
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ request: { id: "r1" } });
    expect(askMock).toHaveBeenCalledWith(expect.anything(), { requesterEmail: "ana@corp.io", groupSlug: "paid", tokens: 10, reason: "x" });
  });

  it("passes validation failures through", async () => {
    askMock.mockReturnValue({ ok: false, code: "invalid_request", detail: "tokens" });
    expect((await POST(new Request(url, { method: "POST", body: "{}" }))).status).toBe(400);
  });
});
