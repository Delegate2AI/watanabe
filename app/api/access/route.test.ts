import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const requireIdentityMock = vi.fn();
const canMock = vi.fn();
const writeAccessMock = vi.fn();
const evictAllWarmSessionsMock = vi.fn();
vi.mock("@/lib/agent/session-evict-all", () => ({
  evictAllWarmSessions: (...args: unknown[]) => evictAllWarmSessionsMock(...args),
}));
vi.mock("@/lib/auth/identity", () => ({
  requireIdentity: (...args: unknown[]) => requireIdentityMock(...args),
}));
vi.mock("@/lib/authority/roles", () => ({
  can: (...args: unknown[]) => canMock(...args),
}));
vi.mock("@/lib/authority/access", () => ({
  writeAccess: (...args: unknown[]) => writeAccessMock(...args),
}));

import { POST, dynamic, runtime } from "./route";

describe("POST /api/access", () => {
  beforeEach(() => {
    requireIdentityMock.mockReset().mockResolvedValue({ identity: { email: "admin@example.com" } });
    canMock.mockReset().mockReturnValue(true);
    writeAccessMock.mockReset().mockResolvedValue({ ok: true, version: "version-1", warnings: [] });
    evictAllWarmSessionsMock.mockReset().mockReturnValue(0);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("uses the required route runtime conventions and dispatches a closed verb", async () => {
    const request = new Request("http://t/api/access", {
      method: "POST",
      body: JSON.stringify({ verb: "addToGroup", group: "exec", email: "user@example.com" }),
    });

    const response = await POST(request);

    expect(dynamic).toBe("force-dynamic");
    expect(runtime).toBe("nodejs");
    expect(response.status).toBe(200);
    expect(writeAccessMock).toHaveBeenCalledWith(
      { verb: "addToGroup", group: "exec", email: "user@example.com" },
      "admin@example.com",
    );
  });

  it.each(["viewer@example.com", "editor@example.com"])("denies %s before parsing or mutation", async (email) => {
    requireIdentityMock.mockResolvedValue({ identity: { email } });
    canMock.mockReturnValue(false);
    const request = new Request("http://t/api/access", { method: "POST", body: "not-json" });

    const response = await POST(request);

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: { code: "needs_role" } });
    expect(writeAccessMock).not.toHaveBeenCalled();
  });

  it("returns validation refusal without committing", async () => {
    writeAccessMock.mockResolvedValue({ ok: false, error: "at least one admin is required" });
    const request = new Request("http://t/api/access", {
      method: "POST",
      body: JSON.stringify({ verb: "setRole", email: "admin@example.com", role: "viewer" }),
    });

    const response = await POST(request);

    expect(response.status).toBe(400);
    // The writer's sentence is translated, not forwarded: the body names a code
    // and the field it is about, never the reason string.
    expect(await response.json()).toEqual({ error: { code: "invalid_request", detail: "change" } });
  });

  it("rejects unknown verbs before the service", async () => {
    const request = new Request("http://t/api/access", {
      method: "POST",
      body: JSON.stringify({ verb: "makeAdmin", email: "attacker@example.com" }),
    });

    const response = await POST(request);

    expect(response.status).toBe(400);
    expect(writeAccessMock).not.toHaveBeenCalled();
  });

  it("rejects a prototype-key group name before the service (no __proto__ reaches applyChange)", async () => {
    for (const group of ["__proto__", "constructor", "../escape"]) {
      writeAccessMock.mockClear();
      const request = new Request("http://t/api/access", {
        method: "POST",
        body: JSON.stringify({ verb: "addToGroup", group, email: "user@example.com" }),
      });
      const response = await POST(request);
      expect(response.status).toBe(400);
      expect(writeAccessMock).not.toHaveBeenCalled();
    }
  });

  it("dispatches a known setFlag change", async () => {
    const request = new Request("http://t/api/access", {
      method: "POST",
      body: JSON.stringify({ verb: "setFlag", name: "MEMORY_ENABLED", value: false }),
    });

    const response = await POST(request);

    expect(response.status).toBe(200);
    expect(writeAccessMock).toHaveBeenCalledWith(
      { verb: "setFlag", name: "MEMORY_ENABLED", value: false },
      "admin@example.com",
    );
  });

  it.each([
    ["setFlag", { verb: "setFlag", name: "CONNECTORS_ENABLED", value: true }],
    ["a group removal", { verb: "removeFromGroup", group: "exec", email: "user@example.com" }],
    ["a role change", { verb: "setRole", email: "user@example.com", role: "viewer" }],
  ])("evicts warm sessions after %s commits, so the next turn rebuilds", async (_label, change) => {
    const request = new Request("http://t/api/access", {
      method: "POST",
      body: JSON.stringify(change),
    });

    const response = await POST(request);

    expect(response.status).toBe(200);
    expect(evictAllWarmSessionsMock).toHaveBeenCalledTimes(1);
  });

  it("does not evict when the write was refused", async () => {
    writeAccessMock.mockResolvedValue({ ok: false, error: "at least one admin is required" });
    const request = new Request("http://t/api/access", {
      method: "POST",
      body: JSON.stringify({ verb: "setFlag", name: "CONNECTORS_ENABLED", value: true }),
    });

    const response = await POST(request);

    expect(response.status).toBe(400);
    // Nothing changed, so tearing down every live session would be pure cost.
    expect(evictAllWarmSessionsMock).not.toHaveBeenCalled();
  });

  it("does not evict for a caller who never reached the writer", async () => {
    canMock.mockReturnValue(false);
    const request = new Request("http://t/api/access", {
      method: "POST",
      body: JSON.stringify({ verb: "setFlag", name: "CONNECTORS_ENABLED", value: true }),
    });

    await POST(request);

    expect(evictAllWarmSessionsMock).not.toHaveBeenCalled();
  });

  it("rejects an unknown flag before the service", async () => {
    const request = new Request("http://t/api/access", {
      method: "POST",
      body: JSON.stringify({ verb: "setFlag", name: "UNKNOWN_ENABLED", value: true }),
    });

    const response = await POST(request);

    expect(response.status).toBe(400);
    expect(writeAccessMock).not.toHaveBeenCalled();
  });
});
