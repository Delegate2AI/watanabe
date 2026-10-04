import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { DirectCirclebackTransport, circlebackCredentials } from "./circleback-direct";

function credentialsFile(contents: unknown): string {
  const dir = mkdtempSync(path.join(tmpdir(), "cb-creds-"));
  const filePath = path.join(dir, ".credentials.json");
  writeFileSync(filePath, JSON.stringify(contents), "utf8");
  return filePath;
}

const CREDS = {
  mcpOAuth: {
    "circleback|1a2b3c4d": {
      serverName: "circleback",
      serverUrl: "https://app.circleback.ai/api/mcp",
      accessToken: "token-123",
      refreshToken: "refresh-123",
      clientId: "client-1",
      // Far future: these cases exercise the call path, not renewal.
      expiresAt: 4_000_000_000_000,
    },
  },
};

function jsonResponse(body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json", ...headers },
  });
}

describe("circlebackCredentials", () => {
  // Re-exported for callers; the field-level cases live in circleback-auth.test.ts.
  it("stays reachable from this module", () => {
    expect(circlebackCredentials(credentialsFile(CREDS))).toMatchObject({ accessToken: "token-123" });
  });
});

describe("DirectCirclebackTransport", () => {
  it("initializes once, then calls the tool and parses the text content as JSON", async () => {
    const fetchFn = vi.fn()
      .mockResolvedValueOnce(jsonResponse(
        { jsonrpc: "2.0", id: 1, result: { protocolVersion: "2025-06-18" } },
        { "mcp-session-id": "sess-1" },
      ))
      .mockResolvedValueOnce(new Response(null, { status: 202 }))
      .mockResolvedValueOnce(jsonResponse({
        jsonrpc: "2.0",
        id: 2,
        result: { content: [{ type: "text", text: '[{"id":"m1","name":"Atlas sync"}]' }] },
      }));
    const transport = new DirectCirclebackTransport({
      fetchFn,
      credentialsPath: credentialsFile(CREDS),
    });

    const result = await transport.call("SearchMeetings", { intent: "x", pageIndex: 0 });
    expect(result).toEqual([{ id: "m1", name: "Atlas sync" }]);

    const [, initInit] = fetchFn.mock.calls[0];
    expect(initInit.headers.authorization).toBe("Bearer token-123");
    const [, callInit] = fetchFn.mock.calls[2];
    expect(callInit.headers["mcp-session-id"]).toBe("sess-1");
    const body = JSON.parse(callInit.body);
    expect(body.method).toBe("tools/call");
    expect(body.params).toEqual({ name: "SearchMeetings", arguments: { intent: "x", pageIndex: 0 } });
  });

  it("parses an SSE-framed tool response", async () => {
    const sse = [
      "event: message",
      `data: {"jsonrpc":"2.0","id":2,"result":{"content":[{"type":"text","text":"[{\\"id\\":\\"m2\\"}]"}]}}`,
      "",
    ].join("\n");
    const fetchFn = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ jsonrpc: "2.0", id: 1, result: {} }))
      .mockResolvedValueOnce(new Response(null, { status: 202 }))
      .mockResolvedValueOnce(new Response(sse, { status: 200, headers: { "content-type": "text/event-stream" } }));
    const transport = new DirectCirclebackTransport({ fetchFn, credentialsPath: credentialsFile(CREDS) });
    await expect(transport.call("ReadMeetings", { meetingIds: ["m2"] })).resolves.toEqual([{ id: "m2" }]);
  });

  it("throws the server's message on a tool error result", async () => {
    const fetchFn = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ jsonrpc: "2.0", id: 1, result: {} }))
      .mockResolvedValueOnce(new Response(null, { status: 202 }))
      .mockResolvedValueOnce(jsonResponse({
        jsonrpc: "2.0",
        id: 2,
        result: { content: [{ type: "text", text: "unauthorized" }], isError: true },
      }));
    const transport = new DirectCirclebackTransport({ fetchFn, credentialsPath: credentialsFile(CREDS) });
    await expect(transport.call("SearchMeetings", {})).rejects.toThrow(/unauthorized/);
  });

  it("throws when no credentials are available", async () => {
    const transport = new DirectCirclebackTransport({ fetchFn: vi.fn(), credentialsPath: "/nonexistent" });
    await expect(transport.call("SearchMeetings", {})).rejects.toThrow(/credentials/i);
  });

  it("renews the token and retries once when the server answers 401", async () => {
    const fetchFn = vi.fn()
      // initialize with the stale token
      .mockResolvedValueOnce(new Response("unauthorized", { status: 401 }))
      // discovery, then the refresh grant
      .mockResolvedValueOnce(jsonResponse({ token_endpoint: "https://app.circleback.ai/api/oauth/access-token" }))
      .mockResolvedValueOnce(jsonResponse({ access_token: "token-fresh", expires_in: 86400 }))
      // handshake and call, now with the fresh token
      .mockResolvedValueOnce(jsonResponse({ jsonrpc: "2.0", id: 2, result: {} }, { "mcp-session-id": "sess-2" }))
      .mockResolvedValueOnce(new Response(null, { status: 202 }))
      .mockResolvedValueOnce(jsonResponse({
        jsonrpc: "2.0",
        id: 3,
        result: { content: [{ type: "text", text: '[{"id":"m3"}]' }] },
      }));
    const transport = new DirectCirclebackTransport({ fetchFn, credentialsPath: credentialsFile(CREDS) });

    await expect(transport.call("SearchMeetings", {})).resolves.toEqual([{ id: "m3" }]);
    const [, retryInit] = fetchFn.mock.calls[3];
    expect(retryInit.headers.authorization).toBe("Bearer token-fresh");
    // The stale session must not be carried across the renewal.
    expect(retryInit.headers["mcp-session-id"]).toBeUndefined();
  });

  it("surfaces the 401 when the refresh grant is rejected", async () => {
    const fetchFn = vi.fn()
      .mockResolvedValueOnce(new Response("unauthorized", { status: 401 }))
      .mockResolvedValueOnce(jsonResponse({ token_endpoint: "https://app.circleback.ai/api/oauth/access-token" }))
      .mockResolvedValueOnce(jsonResponse({ error: "invalid_grant" }, 400));
    const transport = new DirectCirclebackTransport({ fetchFn, credentialsPath: credentialsFile(CREDS) });

    await expect(transport.call("SearchMeetings", {})).rejects.toThrow(/HTTP 401/);
  });

  it("renews before the first call when the stored token has already expired", async () => {
    const expired = {
      mcpOAuth: { "circleback|1a2b3c4d": { ...CREDS.mcpOAuth["circleback|1a2b3c4d"], expiresAt: 1_000 } },
    };
    const fetchFn = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ token_endpoint: "https://app.circleback.ai/api/oauth/access-token" }))
      .mockResolvedValueOnce(jsonResponse({ access_token: "token-fresh", expires_in: 86400 }))
      .mockResolvedValueOnce(jsonResponse({ jsonrpc: "2.0", id: 1, result: {} }))
      .mockResolvedValueOnce(new Response(null, { status: 202 }))
      .mockResolvedValueOnce(jsonResponse({
        jsonrpc: "2.0",
        id: 2,
        result: { content: [{ type: "text", text: "[]" }] },
      }));
    const transport = new DirectCirclebackTransport({ fetchFn, credentialsPath: credentialsFile(expired) });

    await expect(transport.call("SearchMeetings", {})).resolves.toEqual([]);
    const [, initInit] = fetchFn.mock.calls[2];
    expect(initInit.headers.authorization).toBe("Bearer token-fresh");
  });
});
