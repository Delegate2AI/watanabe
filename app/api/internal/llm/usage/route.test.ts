import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let enabled = true;
vi.mock("@/lib/llm/config", async (orig) => ({
  ...(await orig<typeof import("@/lib/llm/config")>()),
  isLlmKeysEnabled: () => enabled,
}));
const applyMock = vi.fn<(...args: unknown[]) => "applied" | "duplicate">(() => "applied");
vi.mock("@/lib/db/llm-usage", () => ({ applyUsageBatch: (...a: unknown[]) => applyMock(...a) }));
const touchMock = vi.fn();
vi.mock("@/lib/db/llm-keys", () => ({ touchLlmKeys: (...a: unknown[]) => touchMock(...a) }));
vi.mock("@/lib/db/client", () => ({ getDb: () => ({}) }));

const { POST } = await import("./route");

const delta = {
  ownerEmail: "ana@corp.io", groupSlug: "paid", model: "m", periodStart: "2026-10-01", day: "2026-10-03",
  inputTokens: 1, outputTokens: 2, cacheReadTokens: 0, requests: 1,
};

function post(body: unknown, secret?: string): Request {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (secret) headers["x-llm-gate-secret"] = secret;
  return new Request("http://localhost/api/internal/llm/usage", { method: "POST", headers, body: JSON.stringify(body) });
}

beforeEach(() => {
  enabled = true;
  applyMock.mockClear().mockReturnValue("applied");
  touchMock.mockClear();
  process.env.LLM_GATE_SECRET = "s3cret";
});
afterEach(() => {
  delete process.env.LLM_GATE_SECRET;
});

describe("POST /api/internal/llm/usage", () => {
  it("404s with the flag off, before checking the secret", async () => {
    enabled = false;
    expect((await POST(post({ batchId: "b", deltas: [] }))).status).toBe(404);
  });

  it("501s when no secret is configured, so it fails closed", async () => {
    delete process.env.LLM_GATE_SECRET;
    expect((await POST(post({ batchId: "b", deltas: [] }, "s3cret"))).status).toBe(501);
  });

  it("401s on a missing or wrong secret", async () => {
    expect((await POST(post({ batchId: "b", deltas: [] }))).status).toBe(401);
    expect((await POST(post({ batchId: "b", deltas: [] }, "nope"))).status).toBe(401);
    expect(applyMock).not.toHaveBeenCalled();
  });

  it("400s on a malformed batch", async () => {
    expect((await POST(post({ batchId: "", deltas: [] }, "s3cret"))).status).toBe(400);
    expect((await POST(post({ batchId: "b", deltas: [{ ...delta, inputTokens: -1 }] }, "s3cret"))).status).toBe(400);
  });

  it("applies the batch and the key touches", async () => {
    const touched = [{ id: "k1", at: "2026-10-03T10:00:00Z" }];
    const res = await POST(post({ batchId: "b1", deltas: [delta], touched }, "s3cret"));
    expect(await res.json()).toEqual({ ok: true, duplicate: false });
    expect(applyMock).toHaveBeenCalledWith({}, "b1", [delta]);
    expect(touchMock).toHaveBeenCalledWith({}, [{ id: "k1", at: "2026-10-03T10:00:00.000Z" }]);
  });

  it("acknowledges a repeated batch and still applies its touches, which are idempotent", async () => {
    applyMock.mockReturnValue("duplicate");
    const touched = [{ id: "k1", at: "2026-10-03T10:00:00.000Z" }];
    const res = await POST(post({ batchId: "b1", deltas: [delta], touched }, "s3cret"));
    expect(await res.json()).toEqual({ ok: true, duplicate: true });
    expect(touchMock).toHaveBeenCalledWith({}, touched);
  });

  it("400s a touch whose time is not an ISO timestamp, since it would win every text comparison", async () => {
    const res = await POST(post({ batchId: "b1", deltas: [delta], touched: [{ id: "k1", at: "zzz" }] }, "s3cret"));
    expect(res.status).toBe(400);
    expect(applyMock).not.toHaveBeenCalled();
  });
});
