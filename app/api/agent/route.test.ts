import { describe, it, expect, vi, beforeEach } from "vitest";

// Every dependency is mocked, this is a unit test of the route's own
// branching (401/403/400/200 + the spec-11 context resolution step), not an
// integration test of identity, ownership, AgentSession, or the vault-backed
// resolver (each has its own test suite).

const requireIdentityMock = vi.fn();
vi.mock("@/lib/auth/identity", () => ({
  requireIdentity: (...args: unknown[]) => requireIdentityMock(...args),
}));

vi.mock("@/lib/db/client", () => ({ getDb: () => ({}) }));

const isOwnedByMock = vi.fn();
vi.mock("@/lib/db/ownership", () => ({
  isOwnedBy: (...args: unknown[]) => isOwnedByMock(...args),
}));

const createFreshSessionMock = vi.fn();
const resumeOrGetSessionMock = vi.fn();
vi.mock("@/lib/agent/session", () => ({
  createFreshSession: (...args: unknown[]) => createFreshSessionMock(...args),
  resumeOrGetSession: (...args: unknown[]) => resumeOrGetSessionMock(...args),
}));

const resolveMessageContextMock = vi.fn();
const renderContextBlockMock = vi.fn();
vi.mock("@/lib/agent/context-resolve", () => ({
  resolveMessageContext: (...args: unknown[]) => resolveMessageContextMock(...args),
  renderContextBlock: (...args: unknown[]) => renderContextBlockMock(...args),
}));

// Attachment agent-read (spec 24), mocked so this stays a unit test of the
// route's OWN gating: the reader/flag have their own suites.
const isAttachmentsEnabledMock = vi.fn();
vi.mock("@/lib/attachments/store", () => ({
  isAttachmentsEnabled: (...args: unknown[]) => isAttachmentsEnabledMock(...args),
}));
const ATTACHMENT = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "spec.md",
  path: "/data/attachments/k/t/11111111-1111-4111-8111-111111111111-spec.md",
  mimeType: "text/markdown",
  size: 4,
  text: "BODY",
};
const SOLO_ATTACHMENT = { ...ATTACHMENT, name: "only.txt", mimeType: "text/plain", text: "SOLO" };
const listAttachmentsMock = vi.fn();
vi.mock("@/lib/attachments/read", () => ({
  listAttachments: (...args: unknown[]) => listAttachmentsMock(...args),
}));

const resolveClearanceForEmailMock = vi.fn();
vi.mock("@/lib/identity/resolve", () => ({
  resolveClearanceForEmail: (...args: unknown[]) => resolveClearanceForEmailMock(...args),
}));
const loadConnectorRegistryMock = vi.fn();
vi.mock("@/lib/connectors/registry", () => ({
  loadConnectorRegistry: (...args: unknown[]) => loadConnectorRegistryMock(...args),
}));
const setThreadConnectorMock = vi.fn();
vi.mock("@/lib/db/thread-connectors", () => ({
  setThreadConnector: (...args: unknown[]) => setThreadConnectorMock(...args),
}));
const resolveOauthBearerForRequestMock = vi.fn();
vi.mock("@/lib/connectors/oauth-headers", () => ({
  resolveOauthBearerForRequest: (...args: unknown[]) => resolveOauthBearerForRequestMock(...args),
}));

const { POST } = await import("./route");

const IDENTITY = { email: "alice@example.com", name: "Alice" };

function fakeSession() {
  return { sdkId: "sdk-session-1", subscribe: vi.fn(() => () => {}), send: vi.fn() };
}

function post(body: unknown): Request {
  return new Request("http://localhost/api/agent", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const validChip = {
  type: "doc-selection" as const,
  path: "04-economy/tokenomics.md",
  headingTrail: ["Economy", "Tokenomics"],
  startLine: 7,
  endLine: 7,
  selectedText: "Points are the user-facing unit of value in Meridian.",
  docTitle: "Tokenomics",
};

beforeEach(() => {
  requireIdentityMock.mockReset().mockReturnValue({ identity: IDENTITY });
  isOwnedByMock.mockReset().mockReturnValue(true);
  createFreshSessionMock.mockReset();
  resumeOrGetSessionMock.mockReset();
  resolveMessageContextMock.mockReset();
  renderContextBlockMock.mockReset().mockReturnValue("<portal-context>...</portal-context>");
  // Default: attachments OFF, so every EXISTING test proves flag-off behavior.
  isAttachmentsEnabledMock.mockReset().mockReturnValue(false);
  listAttachmentsMock.mockReset().mockReturnValue([]);
  resolveClearanceForEmailMock.mockReset().mockReturnValue(["all-hands"]);
  loadConnectorRegistryMock.mockReset().mockReturnValue({ entries: [] });
  setThreadConnectorMock.mockReset();
  resolveOauthBearerForRequestMock.mockReset().mockResolvedValue(new Map());
});

const SESSION_ID = "11111111-1111-4111-8111-111111111111";

describe("POST /api/agent, context resolution", () => {
  it("resolves valid context and passes the rendered block through to session.send", async () => {
    resolveMessageContextMock.mockReturnValue({ ok: true, resolved: { path: "04-economy/tokenomics.md" } });
    const session = fakeSession();
    createFreshSessionMock.mockReturnValue(session);

    const res = await POST(post({ message: "What does this mean?", context: [validChip] }));

    expect(res.status).toBe(200);
    expect(resolveMessageContextMock).toHaveBeenCalledWith(validChip);
    expect(renderContextBlockMock).toHaveBeenCalledWith([{ path: "04-economy/tokenomics.md" }]);
    expect(session.send).toHaveBeenCalledWith("What does this mean?", "<portal-context>...</portal-context>");
  });

  it("sends undefined context block when no context is attached", async () => {
    const session = fakeSession();
    createFreshSessionMock.mockReturnValue(session);

    const res = await POST(post({ message: "hello" }));

    expect(res.status).toBe(200);
    expect(resolveMessageContextMock).not.toHaveBeenCalled();
    expect(session.send).toHaveBeenCalledWith("hello", undefined);
  });

  it("400s on more than MAX_CHIPS (5) chips, before ever resolving any of them", async () => {
    const sixChips = Array.from({ length: 6 }, () => validChip);
    const res = await POST(post({ message: "hi", context: sixChips }));

    expect(res.status).toBe(400);
    expect(resolveMessageContextMock).not.toHaveBeenCalled();
    expect(createFreshSessionMock).not.toHaveBeenCalled();
  });

  it("400s on a containment-violating chip, and never constructs a session", async () => {
    resolveMessageContextMock.mockReturnValue({ ok: false, error: { kind: "containment", path: "../secret.txt" } });

    const res = await POST(post({ message: "hi", context: [{ ...validChip, path: "../secret.txt" }] }));

    expect(res.status).toBe(400);
    // The rejected path is logged, never reflected: the body names the code and
    // the field, so a crafted path cannot travel back out through the response.
    const raw = await res.text();
    expect(JSON.parse(raw)).toEqual({ error: { code: "invalid_request", detail: "context" } });
    expect(raw).not.toContain("secret.txt");
    expect(createFreshSessionMock).not.toHaveBeenCalled();
    expect(resumeOrGetSessionMock).not.toHaveBeenCalled();
  });

  it("400s on the first containment-violating chip in a multi-chip request without resolving the rest", async () => {
    resolveMessageContextMock.mockReturnValueOnce({ ok: false, error: { kind: "containment", path: "../secret.txt" } });

    const res = await POST(
      post({ message: "hi", context: [{ ...validChip, path: "../secret.txt" }, validChip] }),
    );

    expect(res.status).toBe(400);
    expect(resolveMessageContextMock).toHaveBeenCalledTimes(1);
    expect(createFreshSessionMock).not.toHaveBeenCalled();
  });
});

describe("POST /api/agent, attachment agent-read (spec 24)", () => {
  it("FLAG OFF: never reads attachments and keeps the exact single-arg render call", async () => {
    resolveMessageContextMock.mockReturnValue({ ok: true, resolved: { path: "p.md" } });
    resumeOrGetSessionMock.mockReturnValue(fakeSession());

    const res = await POST(post({ sessionId: SESSION_ID, message: "hi", context: [validChip] }));

    expect(res.status).toBe(200);
    expect(listAttachmentsMock).not.toHaveBeenCalled();
    // Single-arg call, byte-identical to pre-attachment behavior.
    expect(renderContextBlockMock).toHaveBeenCalledWith([{ path: "p.md" }]);
  });

  it("FLAG ON: reads attachments for the AUTHENTICATED owner + owned thread, never a client field", async () => {
    isAttachmentsEnabledMock.mockReturnValue(true);
    listAttachmentsMock.mockReturnValue([ATTACHMENT]);
    resolveMessageContextMock.mockReturnValue({ ok: true, resolved: { path: "p.md" } });
    const session = fakeSession();
    resumeOrGetSessionMock.mockReturnValue(session);

    // The body carries no owner field; a bogus one here must be ignored.
    const res = await POST(post({ sessionId: SESSION_ID, message: "hi", context: [validChip], owner: "attacker@evil.com" }));

    expect(res.status).toBe(200);
    // Owner = authenticated identity.email; thread = the (ownership-checked) sessionId.
    expect(listAttachmentsMock).toHaveBeenCalledWith(IDENTITY.email, SESSION_ID);
    // Attachments flow through as the SECOND render arg, sharing the block.
    expect(renderContextBlockMock).toHaveBeenCalledWith([{ path: "p.md" }], [ATTACHMENT]);
    expect(session.send).toHaveBeenCalledWith("hi", "<portal-context>...</portal-context>");
  });

  it("FLAG ON, fresh session (no thread yet): no attachments are read", async () => {
    isAttachmentsEnabledMock.mockReturnValue(true);
    createFreshSessionMock.mockReturnValue(fakeSession());

    const res = await POST(post({ message: "hi" }));

    expect(res.status).toBe(200);
    // A brand-new session has no thread id and thus no possible attachments.
    expect(listAttachmentsMock).not.toHaveBeenCalled();
    expect(renderContextBlockMock).not.toHaveBeenCalled();
  });

  it("FLAG ON: attachments alone (no selection chips) still build a context block", async () => {
    isAttachmentsEnabledMock.mockReturnValue(true);
    listAttachmentsMock.mockReturnValue([SOLO_ATTACHMENT]);
    const session = fakeSession();
    resumeOrGetSessionMock.mockReturnValue(session);

    const res = await POST(post({ sessionId: SESSION_ID, message: "hi" }));

    expect(res.status).toBe(200);
    expect(renderContextBlockMock).toHaveBeenCalledWith([], [SOLO_ATTACHMENT]);
    expect(session.send).toHaveBeenCalledWith("hi", "<portal-context>...</portal-context>");
  });
});

describe("POST /api/agent, connector oauth bearer resolution", () => {
  it("resolves the bearer map for a fresh session and passes it through", async () => {
    const bearer = new Map([["linear", "tok-abc"]]);
    resolveOauthBearerForRequestMock.mockResolvedValue(bearer);
    createFreshSessionMock.mockReturnValue(fakeSession());

    const res = await POST(post({ message: "hi" }));

    expect(res.status).toBe(200);
    expect(resolveOauthBearerForRequestMock).toHaveBeenCalledWith(IDENTITY.email, undefined, undefined);
    expect(createFreshSessionMock).toHaveBeenCalledWith(IDENTITY.email, IDENTITY.name, null, undefined, bearer, null);
  });

  it("resolves the bearer map for a resumed session with the session id, and passes it through", async () => {
    const bearer = new Map([["linear", "tok-xyz"]]);
    resolveOauthBearerForRequestMock.mockResolvedValue(bearer);
    resumeOrGetSessionMock.mockReturnValue(fakeSession());

    const res = await POST(post({ sessionId: SESSION_ID, message: "hi" }));

    expect(res.status).toBe(200);
    expect(resolveOauthBearerForRequestMock).toHaveBeenCalledWith(IDENTITY.email, SESSION_ID, undefined);
    expect(resumeOrGetSessionMock).toHaveBeenCalledWith(SESSION_ID, IDENTITY.email, IDENTITY.name, null, bearer, {
      modelChoice: null,
      adoptSessionId: SESSION_ID,
    });
  });

  it("hands an owned session id to the session factory as the id to adopt", async () => {
    isOwnedByMock.mockReturnValue(true);
    resumeOrGetSessionMock.mockReturnValue(fakeSession());

    await POST(post({ sessionId: SESSION_ID, message: "hi" }));

    expect(resumeOrGetSessionMock).toHaveBeenCalledWith(
      SESSION_ID,
      IDENTITY.email,
      IDENTITY.name,
      null,
      expect.anything(),
      expect.objectContaining({ adoptSessionId: SESSION_ID }),
    );
  });
});
