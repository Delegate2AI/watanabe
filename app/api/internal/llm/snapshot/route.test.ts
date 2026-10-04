import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let enabled = true;
vi.mock("@/lib/llm/config", async (orig) => ({
  ...(await orig<typeof import("@/lib/llm/config")>()),
  isLlmKeysEnabled: () => enabled,
}));
const buildMock = vi.fn<(...args: unknown[]) => unknown>(() => ({ generatedAt: "t", keys: [], groups: [], budgets: [] }));
vi.mock("@/lib/llm/snapshot", () => ({ buildSnapshot: (...a: unknown[]) => buildMock(...a) }));
vi.mock("@/lib/authority/groups", () => ({ loadGroups: () => ({ eng: ["ana@corp.io"] }) }));
vi.mock("@/lib/db/client", () => ({ getDb: () => ({}) }));

const { GET } = await import("./route");

function get(secret?: string): Request {
  return new Request("http://localhost/api/internal/llm/snapshot", {
    headers: secret ? { "x-llm-gate-secret": secret } : {},
  });
}

beforeEach(() => {
  enabled = true;
  buildMock.mockClear();
  process.env.LLM_GATE_SECRET = "s3cret";
});
afterEach(() => {
  delete process.env.LLM_GATE_SECRET;
});

describe("GET /api/internal/llm/snapshot", () => {
  it("404s with the flag off", async () => {
    enabled = false;
    expect((await GET(get("s3cret"))).status).toBe(404);
  });

  it("401s without the secret", async () => {
    expect((await GET(get())).status).toBe(401);
    expect(buildMock).not.toHaveBeenCalled();
  });

  it("returns the snapshot built from the groups file", async () => {
    const res = await GET(get("s3cret"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ generatedAt: "t", keys: [], groups: [], budgets: [] });
    expect(buildMock).toHaveBeenCalledWith({}, { eng: ["ana@corp.io"] });
  });

  it("answers 500 rather than throwing when the build fails", async () => {
    buildMock.mockImplementationOnce(() => {
      throw new Error("db locked");
    });
    expect((await GET(get("s3cret"))).status).toBe(500);
  });
});
