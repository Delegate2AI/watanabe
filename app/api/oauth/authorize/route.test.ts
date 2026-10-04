import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const requireIdentityMock = vi.fn();
vi.mock("@/lib/auth/identity", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth/identity")>();
  return { ...actual, requireIdentity: (...args: unknown[]) => requireIdentityMock(...args) };
});

let db: import("better-sqlite3").Database;
vi.mock("@/lib/db/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db/client")>();
  return { ...actual, getDb: () => db };
});

vi.mock("@/lib/authority/groups", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/authority/groups")>();
  return { ...actual, loadGroups: () => ({ staff: ["alice@example.com"] }) };
});

const { POST } = await import("./route");
const { openDb } = await import("@/lib/db/client");
const { registerClient } = await import("@/lib/mcp-auth/clients");
const { consumeCode } = await import("@/lib/mcp-auth/codes");

const ORIGIN = "https://wb.example.test";
const REDIRECT = "https://claude.ai/cb";
const VERIFIER = "verifier";
let clientId: string;

function submit(overrides: Record<string, string | null> = {}, origin: string | null = ORIGIN): Request {
  const base: Record<string, string> = {
    client_id: clientId,
    redirect_uri: REDIRECT,
    response_type: "code",
    code_challenge: createHash("sha256").update(VERIFIER).digest("base64url"),
    code_challenge_method: "S256",
    state: "xyz",
    decision: "approve",
  };
  const form = new URLSearchParams(base);
  for (const [key, value] of Object.entries(overrides)) {
    if (value === null) form.delete(key);
    else form.set(key, value);
  }
  const headers: Record<string, string> = { "content-type": "application/x-www-form-urlencoded" };
  if (origin !== null) headers.origin = origin;
  return new Request(`${ORIGIN}/api/oauth/authorize`, { method: "POST", headers, body: form.toString() });
}

beforeEach(() => {
  db = openDb(":memory:");
  process.env.MCP_ENABLED = "1";
  process.env.MCP_PUBLIC_ORIGIN = ORIGIN;
  requireIdentityMock.mockReset().mockResolvedValue({ identity: { email: "alice@example.com" } });
  clientId = registerClient(db, { clientName: "Claude", redirectUris: [REDIRECT] }).clientId;
});

afterEach(() => {
  delete process.env.MCP_ENABLED;
  delete process.env.MCP_PUBLIC_ORIGIN;
  db.close();
});

describe("approving", () => {
  it("redirects back with a code bound to the challenge, carrying state", async () => {
    const response = await POST(submit());
    const location = new URL(response.headers.get("location") ?? "");

    expect(response.status).toBe(303);
    expect(location.origin + location.pathname).toBe(REDIRECT);
    expect(location.searchParams.get("state")).toBe("xyz");

    const code = location.searchParams.get("code") ?? "";
    expect(consumeCode(db, code, { clientId, redirectUri: REDIRECT, codeVerifier: VERIFIER })).toMatchObject({
      ownerEmail: "alice@example.com",
    });
  });

  it("binds the code to the person who approved, not to anything the form said", async () => {
    requireIdentityMock.mockResolvedValue({ identity: { email: "alice@example.com" } });

    const response = await POST(submit({ owner_email: "someone-else@example.com" }));
    const code = new URL(response.headers.get("location") ?? "").searchParams.get("code") ?? "";

    expect(consumeCode(db, code, { clientId, redirectUri: REDIRECT, codeVerifier: VERIFIER })).toMatchObject({
      ownerEmail: "alice@example.com",
    });
  });
});

describe("denying", () => {
  it("returns access_denied to the client rather than a code", async () => {
    const response = await POST(submit({ decision: "deny" }));
    const location = new URL(response.headers.get("location") ?? "");

    expect(location.searchParams.get("error")).toBe("access_denied");
    expect(location.searchParams.get("state")).toBe("xyz");
    expect(location.searchParams.get("code")).toBeNull();
  });

  it("treats anything that is not an explicit approval as a denial", async () => {
    const response = await POST(submit({ decision: null }));

    expect(new URL(response.headers.get("location") ?? "").searchParams.get("error")).toBe("access_denied");
  });
});

/**
 * This is a cookie-authenticated state change, so without an origin check a page
 * anywhere could auto-submit a form and silently mint a code for whoever
 * happened to be signed in.
 */
describe("cross-site protection", () => {
  it("refuses a submission from another origin", async () => {
    const response = await POST(submit({}, "https://evil.test"));

    expect(response.status).toBe(403);
    expect(db.prepare(`SELECT COUNT(*) AS n FROM oauth_codes`).get()).toEqual({ n: 0 });
  });

  it("refuses a submission carrying no Origin at all, rather than assuming same site", async () => {
    const response = await POST(submit({}, null));

    expect(response.status).toBe(403);
  });
});

describe("who may approve", () => {
  it("refuses a verified identity that is on no roster", async () => {
    requireIdentityMock.mockResolvedValue({ identity: { email: "stranger@example.com" } });

    const response = await POST(submit());

    expect(response.status).toBe(403);
    expect(db.prepare(`SELECT COUNT(*) AS n FROM oauth_codes`).get()).toEqual({ n: 0 });
  });

  it("returns the identity 401 untouched when there is no session", async () => {
    requireIdentityMock.mockResolvedValue({ response: new Response(null, { status: 401 }) });

    expect((await POST(submit())).status).toBe(401);
  });
});

describe("bad requests", () => {
  it("shows rather than redirects when the redirect URI is not the client's", async () => {
    const response = await POST(submit({ redirect_uri: "https://evil.test/cb" }));

    expect(response.status).toBe(400);
    expect(response.headers.get("location")).toBeNull();
  });

  it("sends a protocol error back to a verified redirect URI", async () => {
    const response = await POST(submit({ code_challenge_method: "plain" }));

    expect(response.status).toBe(303);
    expect(new URL(response.headers.get("location") ?? "").searchParams.get("error")).toBe("invalid_request");
  });

  it("is not found with the feature off", async () => {
    delete process.env.MCP_ENABLED;
    expect((await POST(submit())).status).toBe(404);
  });
});
