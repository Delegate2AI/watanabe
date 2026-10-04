import { createHash, randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let db: import("better-sqlite3").Database;
vi.mock("@/lib/db/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db/client")>();
  return { ...actual, getDb: () => db };
});

const { POST } = await import("./route");
const { openDb } = await import("@/lib/db/client");
const { registerClient } = await import("@/lib/mcp-auth/clients");
const { issueCode } = await import("@/lib/mcp-auth/codes");
const { resolveToken } = await import("@/lib/mcp-auth/tokens");
const { resetRateLimits } = await import("@/lib/http/rate-limit");

const REDIRECT = "https://claude.ai/cb";
const VERIFIER = randomBytes(32).toString("base64url");
const CHALLENGE = createHash("sha256").update(VERIFIER).digest("base64url");

let clientId: string;

function post(body: Record<string, string>): Request {
  return new Request("http://t/api/oauth/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", "x-forwarded-for": "203.0.113.5" },
    body: new URLSearchParams(body).toString(),
  });
}

function codeFor(owner = "alice@example.com"): string {
  return issueCode(db, { clientId, ownerEmail: owner, redirectUri: REDIRECT, codeChallenge: CHALLENGE }).code;
}

function exchange(code: string): Request {
  return post({
    grant_type: "authorization_code",
    client_id: clientId,
    code,
    code_verifier: VERIFIER,
    redirect_uri: REDIRECT,
  });
}

beforeEach(() => {
  db = openDb(":memory:");
  resetRateLimits();
  process.env.MCP_ENABLED = "1";
  process.env.MCP_PUBLIC_ORIGIN = "https://wb.example.test";
  clientId = registerClient(db, { clientName: "Claude", redirectUris: [REDIRECT] }).clientId;
});

afterEach(() => {
  delete process.env.MCP_ENABLED;
  delete process.env.MCP_PUBLIC_ORIGIN;
  db.close();
});

describe("authorization_code grant", () => {
  it("exchanges a code for a working access token and a refresh token", async () => {
    const response = await POST(exchange(codeFor()));
    const body = await response.json() as Record<string, string | number>;

    expect(response.status).toBe(200);
    expect(body.token_type).toBe("Bearer");
    expect(body.scope).toBe("mcp");
    expect(body.expires_in).toBe(3600);
    expect(resolveToken(db, body.access_token as string)).toMatchObject({ ownerEmail: "alice@example.com" });
    expect(typeof body.refresh_token).toBe("string");
  });

  // A token response in a shared cache is a token handed to whoever asks next.
  it("forbids caching the response", async () => {
    const response = await POST(exchange(codeFor()));
    expect(response.headers.get("cache-control")).toContain("no-store");
  });

  it("refuses to spend one code twice", async () => {
    const code = codeFor();
    expect((await POST(exchange(code))).status).toBe(200);

    const replay = await POST(exchange(code));
    expect(replay.status).toBe(400);
    expect(await replay.json()).toMatchObject({ error: "invalid_grant" });
  });

  // Every way a grant can fail answers identically, so the response cannot be
  // used to tell an expired code from a spent one from a wrong verifier.
  it("gives the same answer to a wrong verifier, a wrong redirect and an invented code", async () => {
    const wrongVerifier = await POST(
      post({ grant_type: "authorization_code", client_id: clientId, code: codeFor(), code_verifier: "nope", redirect_uri: REDIRECT }),
    );
    const wrongRedirect = await POST(
      post({ grant_type: "authorization_code", client_id: clientId, code: codeFor(), code_verifier: VERIFIER, redirect_uri: "https://claude.ai/elsewhere" }),
    );
    const invented = await POST(exchange("never-existed"));

    const bodies = await Promise.all([wrongVerifier.json(), wrongRedirect.json(), invented.json()]);
    expect(bodies[0]).toEqual(bodies[1]);
    expect(bodies[1]).toEqual(bodies[2]);
    expect(wrongVerifier.status).toBe(400);
  });

  it("refuses a code issued to a different client", async () => {
    const other = registerClient(db, { clientName: "Other", redirectUris: [REDIRECT] }).clientId;
    const code = codeFor();

    const response = await POST(
      post({ grant_type: "authorization_code", client_id: other, code, code_verifier: VERIFIER, redirect_uri: REDIRECT }),
    );

    expect(await response.json()).toMatchObject({ error: "invalid_grant" });
  });

  it("refuses a client that never registered", async () => {
    const response = await POST(
      post({ grant_type: "authorization_code", client_id: "made-up", code: "x", code_verifier: "y", redirect_uri: REDIRECT }),
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: "invalid_client" });
  });
});

describe("refresh_token grant", () => {
  async function firstTokens(): Promise<{ access: string; refresh: string }> {
    const body = await (await POST(exchange(codeFor()))).json() as Record<string, string>;
    return { access: body.access_token, refresh: body.refresh_token };
  }

  it("mints a new access token and rotates the refresh token", async () => {
    const first = await firstTokens();

    const response = await POST(post({ grant_type: "refresh_token", client_id: clientId, refresh_token: first.refresh }));
    const body = await response.json() as Record<string, string>;

    expect(response.status).toBe(200);
    expect(body.access_token).not.toBe(first.access);
    expect(body.refresh_token).not.toBe(first.refresh);
    expect(resolveToken(db, body.access_token)).toMatchObject({ ownerEmail: "alice@example.com" });
  });

  it("refuses a refresh token that has already been rotated", async () => {
    const first = await firstTokens();
    await POST(post({ grant_type: "refresh_token", client_id: clientId, refresh_token: first.refresh }));

    const replay = await POST(post({ grant_type: "refresh_token", client_id: clientId, refresh_token: first.refresh }));
    expect(await replay.json()).toMatchObject({ error: "invalid_grant" });
  });

  // Replaying a superseded token means two parties hold it, and there is no way
  // to tell which is the thief, so the whole chain goes.
  it("kills the live token too when a superseded one is replayed", async () => {
    const first = await firstTokens();
    const second = await (await POST(post({ grant_type: "refresh_token", client_id: clientId, refresh_token: first.refresh }))).json() as Record<string, string>;

    await POST(post({ grant_type: "refresh_token", client_id: clientId, refresh_token: first.refresh }));

    const afterTheft = await POST(post({ grant_type: "refresh_token", client_id: clientId, refresh_token: second.refresh_token }));
    expect(await afterTheft.json()).toMatchObject({ error: "invalid_grant" });
  });
});

describe("the endpoint itself", () => {
  it("refuses a grant type it does not implement", async () => {
    const response = await POST(post({ grant_type: "client_credentials", client_id: clientId }));

    expect(await response.json()).toMatchObject({ error: "unsupported_grant_type" });
  });

  it("is not found with the feature off", async () => {
    delete process.env.MCP_ENABLED;
    expect((await POST(exchange(codeFor()))).status).toBe(404);
  });
});
