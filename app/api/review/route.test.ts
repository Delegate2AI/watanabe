import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Proposal } from "@/lib/review/queue";

const requireIdentityMock = vi.fn();
vi.mock("@/lib/auth/identity", () => ({
  requireIdentity: (...args: unknown[]) => requireIdentityMock(...args),
}));

const canMock = vi.fn();
vi.mock("@/lib/authority/roles", () => ({
  can: (...args: unknown[]) => canMock(...args),
}));

const isKbReviewEnabledMock = vi.fn();
vi.mock("@/lib/review/config", () => ({
  isKbReviewEnabled: () => isKbReviewEnabledMock(),
}));

const loadProposalsMock = vi.fn();
vi.mock("@/lib/review/queue", () => ({
  loadProposals: (...args: unknown[]) => loadProposalsMock(...args),
}));

let db: import("better-sqlite3").Database;
vi.mock("@/lib/db/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db/client")>();
  return { ...actual, getDb: () => db };
});

const { GET } = await import("./route");
const { openDb } = await import("@/lib/db/client");

const ALICE = { email: "alice@example.com", name: "Alice Doe" };

function proposal(over: Partial<Proposal> = {}): Proposal {
  return {
    iid: 7,
    title: "Add note",
    proposer: ALICE.email,
    createdAt: "2026-08-18T10:00:00Z",
    webUrl: "https://gl/mr/7",
    sourceBranch: "kb/alice/add-7",
    paths: ["docs/a.md"],
    changes: [],
    origin: "chat",
    ...over,
  };
}

function get(): Request {
  return new Request("http://t/api/review");
}

beforeEach(() => {
  db = openDb(":memory:");
  requireIdentityMock.mockReset().mockResolvedValue({ identity: ALICE });
  canMock.mockReset().mockReturnValue(true);
  isKbReviewEnabledMock.mockReset().mockReturnValue(true);
  loadProposalsMock.mockReset().mockResolvedValue([]);
});

describe("GET /api/review", () => {
  it("404s when the flag is off", async () => {
    isKbReviewEnabledMock.mockReturnValue(false);
    const res = await GET(get());
    expect(res.status).toBe(404);
    expect(loadProposalsMock).not.toHaveBeenCalled();
  });

  it("hands back the identity refusal when there is no identity", async () => {
    requireIdentityMock.mockResolvedValue({ response: Response.json({ error: "x" }, { status: 401 }) });
    expect((await GET(get())).status).toBe(401);
    expect(loadProposalsMock).not.toHaveBeenCalled();
  });

  it("403s needs_role for someone without approve", async () => {
    canMock.mockReturnValue(false);
    const res = await GET(get());
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: { code: "needs_role" } });
    expect(canMock).toHaveBeenCalledWith(ALICE.email, "approve");
    expect(loadProposalsMock).not.toHaveBeenCalled();
  });

  it("502s review_unavailable when GitLab cannot be listed", async () => {
    loadProposalsMock.mockRejectedValue(new Error("unreachable"));
    const res = await GET(get());
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: { code: "review_unavailable" } });
  });

  it("returns only the proposals the requester is cleared for", async () => {
    loadProposalsMock.mockResolvedValue([proposal()]);
    const res = await GET(get());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ proposals: [proposal()] });
    expect(loadProposalsMock).toHaveBeenCalledWith(db, ALICE.email);
  });
});
