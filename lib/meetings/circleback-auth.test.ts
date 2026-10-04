import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { circlebackCredentials, credentialsExpired, refreshCirclebackToken } from "./circleback-auth";

function credentialsFile(contents: unknown): string {
  const dir = mkdtempSync(path.join(tmpdir(), "cb-auth-"));
  const filePath = path.join(dir, ".credentials.json");
  writeFileSync(filePath, JSON.stringify(contents), "utf8");
  return filePath;
}

const STORED = {
  mcpOAuth: {
    "circleback|1a2b3c4d": {
      serverName: "circleback",
      serverUrl: "https://app.circleback.ai/api/mcp",
      accessToken: "access-old",
      refreshToken: "refresh-old",
      clientId: "client-1",
      expiresAt: 1_000,
      scope: "user",
      redirectUri: "http://localhost:1455/callback",
    },
  },
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function metadataResponse(): Response {
  return jsonResponse({ token_endpoint: "https://app.circleback.ai/api/oauth/access-token" });
}

describe("circlebackCredentials", () => {
  it("reads the refresh token, client id, and expiry alongside the access token", () => {
    const filePath = credentialsFile(STORED);
    expect(circlebackCredentials(filePath)).toEqual({
      serverUrl: "https://app.circleback.ai/api/mcp",
      accessToken: "access-old",
      refreshToken: "refresh-old",
      clientId: "client-1",
      expiresAt: 1_000,
      entryKey: "circleback|1a2b3c4d",
      filePath,
    });
  });

  it("returns null for a missing or malformed file", () => {
    expect(circlebackCredentials("/nonexistent/.credentials.json")).toBeNull();
    expect(circlebackCredentials(credentialsFile({ mcpOAuth: {} }))).toBeNull();
  });

  it("nulls the renewal fields when the store predates them", () => {
    const filePath = credentialsFile({
      mcpOAuth: { "circleback|x": { serverName: "circleback", serverUrl: "https://s/api/mcp", accessToken: "a" } },
    });
    expect(circlebackCredentials(filePath)).toMatchObject({ refreshToken: null, clientId: null, expiresAt: null });
  });
});

describe("credentialsExpired", () => {
  const base = { serverUrl: "s", accessToken: "a", refreshToken: "r", clientId: "c", entryKey: "k", filePath: "f" };

  it("treats a past expiry as expired and a future one as live", () => {
    expect(credentialsExpired({ ...base, expiresAt: 500 }, 1_000)).toBe(true);
    expect(credentialsExpired({ ...base, expiresAt: 5_000_000 }, 1_000)).toBe(false);
  });

  it("expires a token inside the skew window so it cannot lapse mid-call", () => {
    expect(credentialsExpired({ ...base, expiresAt: 1_030_000 }, 1_000_000)).toBe(true);
  });

  it("never claims an unknown expiry is expired", () => {
    expect(credentialsExpired({ ...base, expiresAt: null }, 1_000)).toBe(false);
  });
});

describe("refreshCirclebackToken", () => {
  it("exchanges the refresh token and writes the new token back to the store", async () => {
    const filePath = credentialsFile(STORED);
    const credentials = circlebackCredentials(filePath)!;
    const fetchFn = vi.fn()
      .mockResolvedValueOnce(metadataResponse())
      .mockResolvedValueOnce(jsonResponse({ access_token: "access-new", refresh_token: "refresh-new", expires_in: 86400 }));

    const refreshed = await refreshCirclebackToken(credentials, fetchFn);
    expect(refreshed?.accessToken).toBe("access-new");
    expect(refreshed?.refreshToken).toBe("refresh-new");

    const [endpoint, init] = fetchFn.mock.calls[1];
    expect(endpoint).toBe("https://app.circleback.ai/api/oauth/access-token");
    expect(Object.fromEntries(new URLSearchParams(init.body))).toEqual({
      grant_type: "refresh_token",
      refresh_token: "refresh-old",
      client_id: "client-1",
    });

    const entry = JSON.parse(readFileSync(filePath, "utf8")).mcpOAuth["circleback|1a2b3c4d"];
    expect(entry.accessToken).toBe("access-new");
    expect(entry.refreshToken).toBe("refresh-new");
    expect(entry.expiresAt).toBeGreaterThan(Date.now());
    expect(entry.scope).toBe("user");
  });

  it("keeps the existing refresh token when the server does not rotate it", async () => {
    const filePath = credentialsFile(STORED);
    const fetchFn = vi.fn()
      .mockResolvedValueOnce(metadataResponse())
      .mockResolvedValueOnce(jsonResponse({ access_token: "access-new", expires_in: 86400 }));

    const refreshed = await refreshCirclebackToken(circlebackCredentials(filePath)!, fetchFn);
    expect(refreshed?.refreshToken).toBe("refresh-old");
    expect(JSON.parse(readFileSync(filePath, "utf8")).mcpOAuth["circleback|1a2b3c4d"].refreshToken).toBe("refresh-old");
  });

  it("returns null without calling the token endpoint when no refresh token is stored", async () => {
    const filePath = credentialsFile({
      mcpOAuth: { "circleback|x": { serverName: "circleback", serverUrl: "https://s/api/mcp", accessToken: "a" } },
    });
    const fetchFn = vi.fn();
    await expect(refreshCirclebackToken(circlebackCredentials(filePath)!, fetchFn)).resolves.toBeNull();
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("returns null when the token endpoint rejects the refresh", async () => {
    const filePath = credentialsFile(STORED);
    const fetchFn = vi.fn()
      .mockResolvedValueOnce(metadataResponse())
      .mockResolvedValueOnce(jsonResponse({ error: "invalid_grant" }, 400));
    await expect(refreshCirclebackToken(circlebackCredentials(filePath)!, fetchFn)).resolves.toBeNull();
    expect(JSON.parse(readFileSync(filePath, "utf8")).mcpOAuth["circleback|1a2b3c4d"].accessToken).toBe("access-old");
  });

  it("returns null when discovery fails or the network throws", async () => {
    const filePath = credentialsFile(STORED);
    const failing = vi.fn().mockRejectedValue(new Error("offline"));
    await expect(refreshCirclebackToken(circlebackCredentials(filePath)!, failing)).resolves.toBeNull();
  });
});
