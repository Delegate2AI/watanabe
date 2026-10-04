import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { openDb } from "@/lib/db/client";
import { insertSharedDoc } from "@/lib/db/shared-docs";
import { upsertShare } from "@/lib/db/shared-doc-shares";
import { bindDocThread } from "@/lib/db/doc-threads";
import { recordThread } from "@/lib/db/threads";

// Spec 2026-08-27: POST /api/agent with a docId. The session factories are
// mocked (no CLI subprocess); what is under test is the flag/ACL gate, the
// resume-mismatch 400, and which binding reaches the factory.

const requireIdentityMock = vi.fn();
vi.mock("@/lib/auth/identity", () => ({
  requireIdentity: (...args: unknown[]) => requireIdentityMock(...args),
}));

let db: import("better-sqlite3").Database;
vi.mock("@/lib/db/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db/client")>();
  return { ...actual, getDb: () => db };
});

const fakeSession = () => ({
  sdkId: null,
  subscribe: () => () => {},
  send: vi.fn(),
});
const createFreshSessionMock = vi.fn(() => fakeSession());
const resumeOrGetSessionMock = vi.fn(async () => fakeSession());
vi.mock("@/lib/agent/session", () => ({
  createFreshSession: (...args: unknown[]) => createFreshSessionMock(...(args as [])),
  resumeOrGetSession: (...args: unknown[]) => resumeOrGetSessionMock(...(args as [])),
}));

const { POST } = await import("./route");

const BOB = { email: "bob@example.com", name: "Bob" };
const DOC = "11111111-1111-4111-8111-111111111111";
const OTHER_DOC = "22222222-2222-4222-8222-222222222222";
const THREAD = "33333333-3333-4333-8333-333333333333";

function post(body: Record<string, unknown>): Promise<Response> {
  return POST(
    new Request("http://portal/api/agent", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

beforeEach(() => {
  process.env.SHARED_DOCS_ENABLED = "1";
  process.env.DOC_ANNOTATIONS_ENABLED = "1";
  process.env.DOC_COPILOT_ENABLED = "1";
  db = openDb(":memory:");
  insertSharedDoc(db, { id: DOC, title: "Plan", ownerEmail: "alice@example.com", body: "b" });
  insertSharedDoc(db, { id: OTHER_DOC, title: "Other", ownerEmail: "alice@example.com", body: "b" });
  upsertShare(db, DOC, BOB.email, "comment");
  requireIdentityMock.mockReset().mockResolvedValue({ identity: BOB });
  createFreshSessionMock.mockClear();
  resumeOrGetSessionMock.mockClear();
});

afterEach(() => {
  delete process.env.SHARED_DOCS_ENABLED;
  delete process.env.DOC_ANNOTATIONS_ENABLED;
  delete process.env.DOC_COPILOT_ENABLED;
});

describe("POST /api/agent with a doc binding", () => {
  it("passes the resolved binding into a fresh session", async () => {
    const response = await post({ message: "hi", docId: DOC });
    expect(response.status).toBe(200);
    expect(createFreshSessionMock).toHaveBeenCalledWith(
      BOB.email,
      BOB.name,
      { docId: DOC, docTitle: "Plan", access: "comment" },
      undefined,
      new Map(),
      null,
    );
  });

  it("404s when the flag chain is off", async () => {
    delete process.env.DOC_COPILOT_ENABLED;
    const response = await post({ message: "hi", docId: DOC });
    expect(response.status).toBe(404);
    expect(createFreshSessionMock).not.toHaveBeenCalled();
  });

  it("404s below comment tier, indistinguishable from an unknown doc", async () => {
    requireIdentityMock.mockResolvedValue({ identity: { email: "stranger@example.com", name: "S" } });
    const denied = await post({ message: "hi", docId: DOC });
    requireIdentityMock.mockResolvedValue({ identity: BOB });
    const unknown = await post({ message: "hi", docId: "44444444-4444-4444-8444-444444444444" });
    expect(denied.status).toBe(404);
    expect(unknown.status).toBe(404);
  });

  it("400s a resume whose stored binding names a different doc", async () => {
    recordThread(db, THREAD, BOB.email, "Copilot: Other");
    bindDocThread(db, THREAD, OTHER_DOC, BOB.email);
    const response = await post({ message: "hi", sessionId: THREAD, docId: DOC });
    expect(response.status).toBe(400);
    expect(resumeOrGetSessionMock).not.toHaveBeenCalled();
  });

  it("re-derives the binding for a bound thread resumed without a docId", async () => {
    recordThread(db, THREAD, BOB.email, "Copilot: Plan");
    bindDocThread(db, THREAD, DOC, BOB.email);
    const response = await post({ message: "hi", sessionId: THREAD });
    expect(response.status).toBe(200);
    expect(resumeOrGetSessionMock).toHaveBeenCalledWith(
      THREAD,
      BOB.email,
      BOB.name,
      { docId: DOC, docTitle: "Plan", access: "comment" },
      new Map(),
      { modelChoice: null, adoptSessionId: THREAD },
    );
  });

  it("keeps an ordinary chat unchanged: no docId, no binding", async () => {
    const response = await post({ message: "hi" });
    expect(response.status).toBe(200);
    expect(createFreshSessionMock).toHaveBeenCalledWith(BOB.email, BOB.name, null, undefined, new Map(), null);
  });

  it("accepts a shared-doc chip only for the request's own bound doc", async () => {
    const chip = { type: "shared-doc-selection", docId: DOC, quote: "b", docTitle: "Plan" };
    const ok = await post({ message: "hi", docId: DOC, context: [chip] });
    expect(ok.status).toBe(200);
    const mismatched = await post({
      message: "hi",
      docId: DOC,
      context: [{ ...chip, docId: OTHER_DOC }],
    });
    expect(mismatched.status).toBe(400);
    const unbound = await post({ message: "hi", context: [chip] });
    expect(unbound.status).toBe(400);
  });
});
