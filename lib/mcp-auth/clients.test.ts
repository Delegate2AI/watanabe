import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDb } from "@/lib/db/client";
import { getClient, registerClient, touchClient } from "./clients";

let db: import("better-sqlite3").Database;

beforeEach(() => {
  db = openDb(":memory:");
});

afterEach(() => {
  db.close();
});

describe("registerClient", () => {
  it("issues an opaque client id and no secret at all", () => {
    const client = registerClient(db, {
      clientName: "Claude",
      redirectUris: ["https://claude.ai/api/mcp/auth_callback"],
    });

    expect(client.clientId).toMatch(/^[0-9a-f-]{36}$/);
    // The whole point of the design: there is no secret to distribute, so there
    // must be nowhere for one to appear.
    expect(Object.keys(client)).not.toContain("clientSecret");
    expect(JSON.stringify(client)).not.toMatch(/secret/i);
  });

  it("reads a registered client back with its redirect list intact", () => {
    const client = registerClient(db, {
      clientName: "Claude",
      redirectUris: ["https://claude.ai/api/mcp/auth_callback", "https://claude.ai/other"],
    });

    expect(getClient(db, client.clientId)).toMatchObject({
      clientName: "Claude",
      redirectUris: ["https://claude.ai/api/mcp/auth_callback", "https://claude.ai/other"],
    });
  });

  it("is null for a client id nobody registered", () => {
    expect(getClient(db, "no-such-client")).toBeNull();
  });

  it("stamps last use, so a registration that never authorizes anything is identifiable", () => {
    const client = registerClient(db, {
      clientName: "Claude",
      redirectUris: ["https://claude.ai/cb"],
    }, "2026-09-05T12:00:00Z");
    expect(getClient(db, client.clientId)?.lastUsedAt).toBeNull();

    touchClient(db, client.clientId, "2026-09-05T13:00:00Z");
    expect(getClient(db, client.clientId)?.lastUsedAt).toBe("2026-09-05T13:00:00Z");
  });
});

/**
 * Redirect URIs are the whole attack surface of an authorization endpoint. A
 * loose match here turns an open redirect into token theft, so these are
 * refusals, not warnings.
 */
describe("registerClient, redirect URI validation", () => {
  it.each([
    ["no redirect at all", []],
    ["a plain http origin", ["http://evil.test/cb"]],
    ["a non-absolute path", ["/callback"]],
    ["something that is not a URL", ["not a url"]],
    ["a javascript scheme", ["javascript:alert(1)"]],
    ["a data scheme", ["data:text/html,x"]],
    ["a wildcard somebody hoped would work", ["https://*.claude.ai/cb"]],
    ["a URI carrying a fragment", ["https://claude.ai/cb#frag"]],
  ])("refuses %s", (_label, redirectUris) => {
    expect(() => registerClient(db, { clientName: "Claude", redirectUris })).toThrow();
  });

  it("allows loopback over http, which is how local development connects", () => {
    const client = registerClient(db, {
      clientName: "Local",
      redirectUris: ["http://127.0.0.1:6274/callback", "http://localhost:6274/callback"],
    });

    expect(getClient(db, client.clientId)?.redirectUris).toHaveLength(2);
  });

  it("refuses an empty or oversized name rather than storing it", () => {
    expect(() => registerClient(db, { clientName: "   ", redirectUris: ["https://x.test/cb"] })).toThrow();
    expect(() =>
      registerClient(db, { clientName: "x".repeat(201), redirectUris: ["https://x.test/cb"] }),
    ).toThrow();
  });

  it("refuses more redirect URIs than any real client needs", () => {
    const many = Array.from({ length: 11 }, (_, i) => `https://x.test/cb${i}`);
    expect(() => registerClient(db, { clientName: "Greedy", redirectUris: many })).toThrow();
  });
});
