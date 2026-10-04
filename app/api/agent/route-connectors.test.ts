import { describe, it, expect, vi, beforeEach } from "vitest";

const requireIdentityMock = vi.fn();
vi.mock("@/lib/auth/identity", () => ({
  requireIdentity: (...args: unknown[]) => requireIdentityMock(...args),
}));

const getDbMock = vi.fn(() => ({}));
vi.mock("@/lib/db/client", () => ({ getDb: () => getDbMock() }));

const isOwnedByMock = vi.fn();
vi.mock("@/lib/db/ownership", () => ({
  isOwnedBy: (...args: unknown[]) => isOwnedByMock(...args),
}));

const createFreshSessionMock = vi.fn();
const resumeOrGetSessionMock = vi.fn();
const isLiveSessionMock = vi.fn();
vi.mock("@/lib/agent/session", () => ({
  createFreshSession: (...args: unknown[]) => createFreshSessionMock(...args),
  resumeOrGetSession: (...args: unknown[]) => resumeOrGetSessionMock(...args),
  isLiveSession: (...args: unknown[]) => isLiveSessionMock(...args),
}));

const resolveMessageContextMock = vi.fn();
const renderContextBlockMock = vi.fn();
vi.mock("@/lib/agent/context-resolve", () => ({
  resolveMessageContext: (...args: unknown[]) => resolveMessageContextMock(...args),
  renderContextBlock: (...args: unknown[]) => renderContextBlockMock(...args),
}));

const isAttachmentsEnabledMock = vi.fn();
vi.mock("@/lib/attachments/store", () => ({
  isAttachmentsEnabled: (...args: unknown[]) => isAttachmentsEnabledMock(...args),
}));
const listAttachmentsMock = vi.fn();
vi.mock("@/lib/attachments/read", () => ({
  listAttachments: (...args: unknown[]) => listAttachmentsMock(...args),
}));

const resolveClearanceForEmailMock = vi.fn();
vi.mock("@/lib/identity/resolve", () => ({
  resolveClearanceForEmail: (...args: unknown[]) => resolveClearanceForEmailMock(...args),
}));
const isConnectorsEnabledMock = vi.fn();
vi.mock("@/lib/connectors/config", () => ({
  isConnectorsEnabled: () => isConnectorsEnabledMock(),
}));
const loadConnectorRegistryMock = vi.fn();
vi.mock("@/lib/connectors/registry", () => ({
  loadConnectorRegistry: (...args: unknown[]) => loadConnectorRegistryMock(...args),
}));
const setThreadConnectorMock = vi.fn();
vi.mock("@/lib/db/thread-connectors", () => ({
  setThreadConnector: (...args: unknown[]) => setThreadConnectorMock(...args),
}));
vi.mock("@/lib/connectors/oauth-headers", () => ({
  resolveOauthBearerForRequest: () => Promise.resolve(new Map()),
}));

const { POST } = await import("./route");

const IDENTITY = { email: "alice@example.com", name: "Alice" };

function post(body: unknown): Request {
  return new Request("http://localhost/api/agent", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const SESSION_ID = "11111111-1111-4111-8111-111111111111";

const CIRCLEBACK = {
  slug: "circleback",
  title: "Circleback",
  transport: "http",
  url: "https://mcp.circleback.ai/mcp",
  groups: ["all-hands"],
};

function emittingSession() {
  return {
    sdkId: null,
    subscribe: vi.fn((cb: (event: { type: string; sessionId: string }) => void) => {
      cb({ type: "session", sessionId: "sdk-session-1" });
      return () => {};
    }),
    send: vi.fn(),
  };
}

beforeEach(() => {
  requireIdentityMock.mockReset().mockReturnValue({ identity: IDENTITY });
  getDbMock.mockClear();
  isOwnedByMock.mockReset().mockReturnValue(true);
  createFreshSessionMock.mockReset();
  resumeOrGetSessionMock.mockReset();
  resolveMessageContextMock.mockReset();
  renderContextBlockMock.mockReset();
  isAttachmentsEnabledMock.mockReset().mockReturnValue(false);
  listAttachmentsMock.mockReset().mockReturnValue([]);
  resolveClearanceForEmailMock.mockReset().mockReturnValue(["all-hands"]);
  isConnectorsEnabledMock.mockReset().mockReturnValue(true);
  loadConnectorRegistryMock.mockReset().mockReturnValue({ entries: [] });
  setThreadConnectorMock.mockReset();
  isLiveSessionMock.mockReset().mockResolvedValue(true);
});

describe("POST /api/agent, connector deep link", () => {
  it("400s when connectors accompany a sessionId, before any session is touched", async () => {
    const res = await POST(post({ sessionId: SESSION_ID, message: "hi", connectors: ["circleback"] }));

    expect(res.status).toBe(400);
    expect(createFreshSessionMock).not.toHaveBeenCalled();
    expect(resumeOrGetSessionMock).not.toHaveBeenCalled();
  });

  it("accepts a cleared slug on the first turn of an adopted pre-minted id", async () => {
    loadConnectorRegistryMock.mockReturnValue({ entries: [CIRCLEBACK] });
    isLiveSessionMock.mockResolvedValue(false);
    const session = emittingSession();
    resumeOrGetSessionMock.mockResolvedValue(session);

    const res = await POST(post({ sessionId: SESSION_ID, message: "hi", connectors: ["circleback"] }));

    expect(res.status).toBe(200);
    expect(resumeOrGetSessionMock).toHaveBeenCalledWith(
      SESSION_ID,
      IDENTITY.email,
      IDENTITY.name,
      null,
      new Map(),
      expect.objectContaining({ adoptSessionId: SESSION_ID, pendingConnectorSlugs: ["circleback"] }),
    );
    expect(setThreadConnectorMock).toHaveBeenCalledWith(expect.anything(), "sdk-session-1", "circleback", true);
  });

  it("a fresh POST with a cleared slug persists a thread_connectors row keyed by the emitted sdk id", async () => {
    loadConnectorRegistryMock.mockReturnValue({ entries: [CIRCLEBACK] });
    const session = emittingSession();
    createFreshSessionMock.mockReturnValue(session);

    const res = await POST(post({ message: "hi", connectors: ["circleback"] }));

    expect(res.status).toBe(200);
    expect(createFreshSessionMock).toHaveBeenCalledWith(IDENTITY.email, IDENTITY.name, null, ["circleback"], new Map(), null);
    expect(setThreadConnectorMock).toHaveBeenCalledWith(expect.anything(), "sdk-session-1", "circleback", true);
    expect(session.send).toHaveBeenCalledWith("hi", undefined);
  });

  it("400s an unknown slug before any session is created", async () => {
    const res = await POST(post({ message: "hi", connectors: ["nope"] }));

    expect(res.status).toBe(400);
    expect(createFreshSessionMock).not.toHaveBeenCalled();
    expect(setThreadConnectorMock).not.toHaveBeenCalled();
  });

  it("400s a slug outside the caller's clearance before any session is created", async () => {
    loadConnectorRegistryMock.mockReturnValue({ entries: [{ ...CIRCLEBACK, groups: ["engineering"] }] });

    const res = await POST(post({ message: "hi", connectors: ["circleback"] }));

    expect(res.status).toBe(400);
    expect(createFreshSessionMock).not.toHaveBeenCalled();
  });

  it("400s more than 8 slugs at the schema", async () => {
    const res = await POST(
      post({ message: "hi", connectors: Array.from({ length: 9 }, (_, i) => `c${i}`) }),
    );

    expect(res.status).toBe(400);
    expect(createFreshSessionMock).not.toHaveBeenCalled();
  });

  it("a persistence failure never kills the stream", async () => {
    loadConnectorRegistryMock.mockReturnValue({ entries: [CIRCLEBACK] });
    setThreadConnectorMock.mockImplementation(() => {
      throw new Error("SQLITE_BUSY: database is locked");
    });
    const session = emittingSession();
    createFreshSessionMock.mockReturnValue(session);

    const res = await POST(post({ message: "go", connectors: ["circleback"] }));

    expect(res.status).toBe(200);
    expect(session.send).toHaveBeenCalledWith("go", undefined);
  });
});

describe("POST /api/agent, connectors flag off", () => {
  it("400s a fresh POST carrying connectors before any registry load or session creation", async () => {
    isConnectorsEnabledMock.mockReturnValue(false);
    loadConnectorRegistryMock.mockReturnValue({ entries: [CIRCLEBACK] });

    const res = await POST(post({ message: "hi", connectors: ["circleback"] }));

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: { code: "invalid_request", detail: "connectors" } });
    expect(loadConnectorRegistryMock).not.toHaveBeenCalled();
    expect(createFreshSessionMock).not.toHaveBeenCalled();
    expect(resumeOrGetSessionMock).not.toHaveBeenCalled();
    expect(setThreadConnectorMock).not.toHaveBeenCalled();
  });

  it("a fresh POST without connectors streams as before and never touches the connector opt-in path", async () => {
    isConnectorsEnabledMock.mockReturnValue(false);
    const session = emittingSession();
    createFreshSessionMock.mockReturnValue(session);

    const res = await POST(post({ message: "hi" }));

    expect(res.status).toBe(200);
    expect(createFreshSessionMock).toHaveBeenCalledWith(IDENTITY.email, IDENTITY.name, null, undefined, new Map(), null);
    expect(session.send).toHaveBeenCalledWith("hi", undefined);
    expect(loadConnectorRegistryMock).not.toHaveBeenCalled();
    expect(setThreadConnectorMock).not.toHaveBeenCalled();
  });
});
