import { beforeEach, describe, expect, it, vi } from "vitest";

const getSessionMock = vi.fn();
vi.mock("@/lib/agent/session", () => ({
  getSession: (...args: Parameters<typeof getSessionMock>) => getSessionMock(...args),
}));

const getDbMock = vi.fn(() => ({}));
vi.mock("@/lib/db/client", () => ({
  getDb: (...args: Parameters<typeof getDbMock>) => getDbMock(...args),
}));

const isConnectorOauthEnabledMock = vi.fn();
vi.mock("./config", () => ({
  isConnectorOauthEnabled: () => isConnectorOauthEnabledMock(),
}));

const listThreadConnectorsMock = vi.fn();
vi.mock("@/lib/db/thread-connectors", () => ({
  listThreadConnectors: (...args: Parameters<typeof listThreadConnectorsMock>) => listThreadConnectorsMock(...args),
}));

const loadConnectorRegistryMock = vi.fn();
vi.mock("./registry", () => ({
  loadConnectorRegistry: (...args: Parameters<typeof loadConnectorRegistryMock>) => loadConnectorRegistryMock(...args),
}));

const { resolveOauthBearerForRequest } = await import("./oauth-headers");

const CALLER = "alice@example.com";
const SESSION_ID = "11111111-1111-4111-8111-111111111111";

beforeEach(() => {
  getSessionMock.mockReset().mockReturnValue(undefined);
  getDbMock.mockClear();
  isConnectorOauthEnabledMock.mockReset().mockReturnValue(true);
  listThreadConnectorsMock.mockReset().mockReturnValue([]);
  loadConnectorRegistryMock.mockReset().mockReturnValue({ entries: [], errors: [] });
});

describe("resolveOauthBearerForRequest", () => {
  it("never touches the db when the oauth flag is off", async () => {
    isConnectorOauthEnabledMock.mockReturnValue(false);

    const result = await resolveOauthBearerForRequest(CALLER, SESSION_ID, ["linear"]);

    expect(result.size).toBe(0);
    expect(getDbMock).not.toHaveBeenCalled();
    expect(getSessionMock).not.toHaveBeenCalled();
  });

  it("never touches the db for a fresh (sessionless) request when the flag is off", async () => {
    isConnectorOauthEnabledMock.mockReturnValue(false);

    const result = await resolveOauthBearerForRequest(CALLER, undefined, ["linear"]);

    expect(result.size).toBe(0);
    expect(getDbMock).not.toHaveBeenCalled();
  });

  it("skips resolution and never touches the db when a warm, unended session already exists for the id", async () => {
    getSessionMock.mockReturnValue({ isEnded: false });

    const result = await resolveOauthBearerForRequest(CALLER, SESSION_ID, ["linear"]);

    expect(result.size).toBe(0);
    expect(getDbMock).not.toHaveBeenCalled();
    expect(listThreadConnectorsMock).not.toHaveBeenCalled();
  });

  it("resolves normally when the session for the id has already ended", async () => {
    getSessionMock.mockReturnValue({ isEnded: true });

    await resolveOauthBearerForRequest(CALLER, SESSION_ID, ["linear"]);

    expect(getDbMock).toHaveBeenCalled();
  });

  it("resolves normally when no warm session exists for the id", async () => {
    getSessionMock.mockReturnValue(undefined);

    await resolveOauthBearerForRequest(CALLER, SESSION_ID, ["linear"]);

    expect(getDbMock).toHaveBeenCalled();
    expect(listThreadConnectorsMock).toHaveBeenCalledWith({}, SESSION_ID);
  });

  it("resolves normally for a fresh request with no session id at all", async () => {
    await resolveOauthBearerForRequest(CALLER, undefined, ["linear"]);

    expect(getDbMock).toHaveBeenCalled();
    expect(getSessionMock).not.toHaveBeenCalled();
    expect(listThreadConnectorsMock).not.toHaveBeenCalled();
  });
});
