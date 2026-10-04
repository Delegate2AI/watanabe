import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const requireIdentityMock = vi.fn();
vi.mock("@/lib/auth/identity", () => ({
  requireIdentity: (...args: unknown[]) => requireIdentityMock(...args),
}));

const getDbMock = vi.fn(() => ({}));
vi.mock("@/lib/db/client", () => ({ getDb: () => getDbMock() }));

const isOwnedByMock = vi.fn();
vi.mock("@/lib/db/ownership", () => ({ isOwnedBy: (...args: unknown[]) => isOwnedByMock(...args) }));

const createFreshSessionMock = vi.fn();
const resumeOrGetSessionMock = vi.fn();
vi.mock("@/lib/agent/session", () => ({
  createFreshSession: (...args: unknown[]) => createFreshSessionMock(...args),
  resumeOrGetSession: (...args: unknown[]) => resumeOrGetSessionMock(...args),
}));

vi.mock("@/lib/agent/context-resolve", () => ({
  resolveMessageContext: vi.fn(),
  renderContextBlock: vi.fn(() => "<portal-context>...</portal-context>"),
}));

vi.mock("@/lib/attachments/store", () => ({ isAttachmentsEnabled: () => false }));
vi.mock("@/lib/attachments/read", () => ({ listAttachments: () => [] }));
vi.mock("@/lib/identity/resolve", () => ({ resolveClearanceForEmail: () => ["all-hands"] }));
vi.mock("@/lib/connectors/registry", () => ({ loadConnectorRegistry: () => ({ entries: [] }) }));
vi.mock("@/lib/db/thread-connectors", () => ({ setThreadConnector: vi.fn() }));
vi.mock("@/lib/connectors/oauth-headers", () => ({
  resolveOauthBearerForRequest: async () => new Map(),
}));

const freshModelChoiceForMock = vi.fn();
vi.mock("@/lib/agent/fresh-model-choice", () => ({
  freshModelChoiceFor: (...args: unknown[]) => freshModelChoiceForMock(...args),
}));

const setThreadModelChoiceMock = vi.fn();
vi.mock("@/lib/db/threads", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db/threads")>();
  return {
    ...actual,
    setThreadModelChoice: (...args: unknown[]) => setThreadModelChoiceMock(...args),
  };
});

const { POST } = await import("./route");

const IDENTITY = { email: "alice@example.com", name: "Alice" };
const SESSION_ID = "11111111-1111-4111-8111-111111111111";

const ORIGINAL_ENV = {
  model: process.env.AGENT_CHAT_MODEL,
  models: process.env.AGENT_CHAT_MODELS,
};

let sessionSubscriber: ((event: { type: string; sessionId?: string }) => void) | null = null;

function fakeSession() {
  return {
    sdkId: null as string | null,
    subscribe: vi.fn((fn: (event: { type: string; sessionId?: string }) => void) => {
      sessionSubscriber = fn;
      return () => {};
    }),
    send: vi.fn(),
  };
}

function post(body: unknown): Request {
  return new Request("http://localhost/api/agent", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  process.env.AGENT_CHAT_MODEL = "claude-opus-4-8";
  process.env.AGENT_CHAT_MODELS = "claude-fable-5-1,claude-sonnet-5";
  requireIdentityMock.mockReset().mockReturnValue({ identity: IDENTITY });
  isOwnedByMock.mockReset().mockReturnValue(true);
  createFreshSessionMock.mockReset();
  resumeOrGetSessionMock.mockReset();
  getDbMock.mockReset().mockReturnValue({});
  freshModelChoiceForMock.mockReset().mockImplementation((_db, _thread, requested) => requested);
  setThreadModelChoiceMock.mockReset();
  sessionSubscriber = null;
});

afterEach(() => {
  if (ORIGINAL_ENV.model === undefined) delete process.env.AGENT_CHAT_MODEL;
  else process.env.AGENT_CHAT_MODEL = ORIGINAL_ENV.model;
  if (ORIGINAL_ENV.models === undefined) delete process.env.AGENT_CHAT_MODELS;
  else process.env.AGENT_CHAT_MODELS = ORIGINAL_ENV.models;
});

describe("POST /api/agent, a fresh request with the store unreachable", () => {
  it("streams a default-model turn without ever opening the store", async () => {
    getDbMock.mockImplementation(() => {
      throw new Error("SQLITE_CANTOPEN: unable to open /data/portal.db");
    });
    createFreshSessionMock.mockReturnValue(fakeSession());

    const res = await POST(post({ message: "hi" }));

    expect(res.status).toBe(200);
    expect(getDbMock).not.toHaveBeenCalled();
    expect(freshModelChoiceForMock).not.toHaveBeenCalled();
    expect(createFreshSessionMock).toHaveBeenCalledWith(
      IDENTITY.email,
      IDENTITY.name,
      null,
      undefined,
      expect.anything(),
      null,
    );
  });

  it("falls back to the default when a choice was requested and the store is down", async () => {
    getDbMock.mockImplementation(() => {
      throw new Error("SQLITE_CANTOPEN: unable to open /data/portal.db");
    });
    createFreshSessionMock.mockReturnValue(fakeSession());

    const res = await POST(post({ message: "hi", model: "claude-fable-5-1" }));

    expect(res.status).toBe(200);
    expect(createFreshSessionMock).toHaveBeenCalledWith(
      IDENTITY.email,
      IDENTITY.name,
      null,
      undefined,
      expect.anything(),
      null,
    );
  });
});

describe("POST /api/agent, model choice on the body", () => {
  it("400s on a model that is not on the allowlist, before constructing a session", async () => {
    const res = await POST(post({ message: "hi", model: "gpt-4o" }));

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: { code: "invalid_request", detail: "body" } });
    expect(createFreshSessionMock).not.toHaveBeenCalled();
  });

  it("400s on an effort that is not a level", async () => {
    const res = await POST(post({ message: "hi", effort: "turbo" }));

    expect(res.status).toBe(400);
    expect(createFreshSessionMock).not.toHaveBeenCalled();
  });

  it("passes an allow-listed choice to createFreshSession as the sixth argument", async () => {
    createFreshSessionMock.mockReturnValue(fakeSession());

    const res = await POST(post({ message: "hi", model: "claude-fable-5-1", effort: "max" }));

    expect(res.status).toBe(200);
    expect(freshModelChoiceForMock).toHaveBeenCalledWith({}, undefined, {
      model: "claude-fable-5-1",
      effort: "max",
    });
    expect(createFreshSessionMock).toHaveBeenCalledWith(
      IDENTITY.email,
      IDENTITY.name,
      null,
      undefined,
      expect.anything(),
      { model: "claude-fable-5-1", effort: "max" },
    );
  });

  it("hands the choice to resumeOrGetSession inside the options object", async () => {
    resumeOrGetSessionMock.mockReturnValue(fakeSession());

    const res = await POST(
      post({ sessionId: SESSION_ID, message: "hi", model: "claude-sonnet-5" }),
    );

    expect(res.status).toBe(200);
    expect(freshModelChoiceForMock).toHaveBeenCalledWith({}, SESSION_ID, {
      model: "claude-sonnet-5",
      effort: undefined,
    });
    expect(resumeOrGetSessionMock).toHaveBeenCalledWith(
      SESSION_ID,
      IDENTITY.email,
      IDENTITY.name,
      null,
      expect.anything(),
      { modelChoice: { model: "claude-sonnet-5", effort: undefined }, adoptSessionId: SESSION_ID },
    );
  });

  it("passes null down when freshModelChoiceFor refuses the request", async () => {
    freshModelChoiceForMock.mockReturnValue(null);
    resumeOrGetSessionMock.mockReturnValue(fakeSession());

    await POST(post({ sessionId: SESSION_ID, message: "hi", model: "claude-sonnet-5" }));

    expect(resumeOrGetSessionMock).toHaveBeenCalledWith(
      SESSION_ID,
      IDENTITY.email,
      IDENTITY.name,
      null,
      expect.anything(),
      { modelChoice: null, adoptSessionId: SESSION_ID },
    );
  });
});

describe("POST /api/agent, persisting the choice on the session event", () => {
  it("writes the applied choice onto the new thread row for the authenticated owner", async () => {
    createFreshSessionMock.mockReturnValue(fakeSession());

    const res = await POST(post({ message: "hi", model: "claude-fable-5-1", effort: "max" }));
    expect(res.status).toBe(200);
    sessionSubscriber?.({ type: "session", sessionId: "sdk-new-1" });

    expect(setThreadModelChoiceMock).toHaveBeenCalledWith({}, "sdk-new-1", IDENTITY.email, {
      model: "claude-fable-5-1",
      effort: "max",
    });
  });

  it("writes only the fields the caller actually sent", async () => {
    createFreshSessionMock.mockReturnValue(fakeSession());

    const res = await POST(post({ message: "hi", effort: "low" }));
    expect(res.status).toBe(200);
    sessionSubscriber?.({ type: "session", sessionId: "sdk-new-2" });

    expect(setThreadModelChoiceMock).toHaveBeenCalledWith({}, "sdk-new-2", IDENTITY.email, {
      effort: "low",
    });
  });

  it("writes nothing when no choice was applied", async () => {
    freshModelChoiceForMock.mockReturnValue(null);
    createFreshSessionMock.mockReturnValue(fakeSession());

    const res = await POST(post({ message: "hi" }));
    expect(res.status).toBe(200);
    sessionSubscriber?.({ type: "session", sessionId: "sdk-new-3" });

    expect(setThreadModelChoiceMock).not.toHaveBeenCalled();
  });

  it("survives a store failure without breaking the turn", async () => {
    setThreadModelChoiceMock.mockImplementation(() => {
      throw new Error("db gone");
    });
    createFreshSessionMock.mockReturnValue(fakeSession());

    const res = await POST(post({ message: "hi", model: "claude-fable-5-1" }));
    expect(res.status).toBe(200);

    expect(() => sessionSubscriber?.({ type: "session", sessionId: "sdk-new-4" })).not.toThrow();
  });
});
