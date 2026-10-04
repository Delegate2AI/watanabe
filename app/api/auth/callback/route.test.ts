import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { SignJWT, generateKeyPair, exportJWK } from "jose";
import type { OidcConfig } from "@/lib/config/schema";
import { log } from "@/lib/log";

const getConfigMock = vi.fn();
vi.mock("@/lib/config", () => ({ getConfig: () => getConfigMock() }));

const SESSION_SECRET = "s".repeat(32);
const CLIENT_SECRET = "shh";

const oidc: OidcConfig = {
  provider: "google",
  clientId: "abc",
  baseUrl: "https://portal.example.com",
  allowedDomains: ["example.com"],
  allowedEmails: [],
  scopes: ["openid", "email", "profile"],
  emailClaim: "email",
  nameClaim: "name",
  cookieName: "portal_session",
  sessionTtlHours: 168,
};

const ISSUER = "https://accounts.google.com";
const CLIENT_ID = oidc.clientId;

const DOC = {
  issuer: ISSUER,
  authorization_endpoint: `${ISSUER}/o/oauth2/v2/auth`,
  token_endpoint: "https://oauth2.googleapis.com/token",
  jwks_uri: "https://www.googleapis.com/oauth2/v3/certs",
};

// oidc.baseUrl above is https, so every cookie the login route would have set
// carries the __Host- prefix (see lib/auth/session.ts#withHostPrefix), and a
// real browser only ever sends these prefixed names back on the callback.
const TRANSIENT_NAMES = [
  "__Host-portal_oidc_state",
  "__Host-portal_oidc_nonce",
  "__Host-portal_oidc_verifier",
  "__Host-portal_oidc_return",
];

let privateKey: CryptoKey;
let publicJwk: Record<string, unknown>;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

async function idToken(claims: Record<string, unknown>) {
  return new SignJWT(claims)
    .setProtectedHeader({ alg: "RS256", kid: "k1" })
    .setIssuer(ISSUER)
    .setAudience(CLIENT_ID)
    .setSubject("user-123")
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(privateKey);
}

/** Discovery, JWKS, and token endpoint, all answered from one mock. */
function stubNetwork(token: string) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url.includes("openid-configuration")) return json(DOC);
      if (url.includes("oauth2/v3/certs")) return json({ keys: [publicJwk] });
      if (url.includes("token")) return json({ id_token: token });
      throw new Error(`unexpected fetch: ${url}`);
    }),
  );
}

/** Every cleared transient cookie overwrites the exact cookie the login route set: same Path, Max-Age=0. */
function expectTransientsCleared(cookies: string[]) {
  for (const name of TRANSIENT_NAMES) {
    expect(cookies).toContain(`${name}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`);
  }
}

let GET: (request: Request) => Promise<Response>;

beforeEach(async () => {
  vi.resetModules();
  vi.restoreAllMocks();
  vi.spyOn(log, "warn").mockImplementation(() => {});
  vi.stubEnv("PORTAL_SESSION_SECRET", SESSION_SECRET);
  vi.stubEnv("PORTAL_OIDC_CLIENT_SECRET", CLIENT_SECRET);
  getConfigMock.mockReturnValue({ auth: { mode: "oidc", oidc } });

  const { resetDiscoveryCacheForTests } = await import("@/lib/auth/oidc/discovery");
  resetDiscoveryCacheForTests();
  const { resetRateLimits } = await import("@/lib/http/rate-limit");
  resetRateLimits();

  const pair = await generateKeyPair("RS256");
  privateKey = pair.privateKey;
  const jwk = await exportJWK(pair.publicKey);
  jwk.kid = "k1";
  jwk.alg = "RS256";
  jwk.use = "sig";
  publicJwk = jwk as Record<string, unknown>;

  ({ GET } = await import("./route"));
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("GET /api/auth/callback", () => {
  it("404s in every other auth mode, before anything else happens", async () => {
    getConfigMock.mockReturnValue({ auth: { mode: "proxy-header", proxyHeader: {} } });
    const response = await GET(new Request("https://portal.example.com/api/auth/callback?code=abc&state=st"));
    expect(response.status).toBe(404);
  });

  it("redirects to /login?error=state_mismatch when the state does not match its cookie", async () => {
    const cookie = "__Host-portal_oidc_state=st; __Host-portal_oidc_nonce=no; __Host-portal_oidc_verifier=ver";
    const response = await GET(
      new Request("https://portal.example.com/api/auth/callback?code=abc&state=other", { headers: { cookie } }),
    );
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("https://portal.example.com/login?error=state_mismatch");
  });

  it("redirects to /login?error=missing_params when the transient cookies are entirely missing", async () => {
    const response = await GET(new Request("https://portal.example.com/api/auth/callback?code=abc&state=st"));
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("https://portal.example.com/login?error=missing_params");
  });

  it("redirects to /login?error=missing_params when neither code nor error is present", async () => {
    const cookie = "__Host-portal_oidc_state=st; __Host-portal_oidc_nonce=no; __Host-portal_oidc_verifier=ver";
    const response = await GET(
      new Request("https://portal.example.com/api/auth/callback?state=st", { headers: { cookie } }),
    );
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("https://portal.example.com/login?error=missing_params");
  });

  it("redirects to /login?error=not_allowed when the provider reports an error with a matching state", async () => {
    const cookie = "__Host-portal_oidc_state=st; __Host-portal_oidc_nonce=no; __Host-portal_oidc_verifier=ver";
    const response = await GET(
      new Request("https://portal.example.com/api/auth/callback?error=access_denied&state=st", { headers: { cookie } }),
    );
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("https://portal.example.com/login?error=not_allowed");
  });

  it("redirects to /login?error=state_mismatch, and leaves cookies untouched, for a cross-site error callback with no or wrong state", async () => {
    // This is the disruption this fix closes: an attacker who can cause a
    // victim's browser to navigate to this URL, but who has no way to read
    // the random state value in the victim's own httpOnly cookie, must not be
    // able to cancel that victim's pending sign-in.
    const cookie = "__Host-portal_oidc_state=st; __Host-portal_oidc_nonce=no; __Host-portal_oidc_verifier=ver";

    const noState = await GET(
      new Request("https://portal.example.com/api/auth/callback?error=access_denied", { headers: { cookie } }),
    );
    expect(noState.status).toBe(302);
    expect(noState.headers.get("location")).toBe("https://portal.example.com/login?error=state_mismatch");
    expect(noState.headers.getSetCookie()).toEqual([]);

    const wrongState = await GET(
      new Request("https://portal.example.com/api/auth/callback?error=access_denied&state=nope", {
        headers: { cookie },
      }),
    );
    expect(wrongState.status).toBe(302);
    expect(wrongState.headers.get("location")).toBe("https://portal.example.com/login?error=state_mismatch");
    expect(wrongState.headers.getSetCookie()).toEqual([]);

    const noCookieAtAll = await GET(
      new Request("https://portal.example.com/api/auth/callback?error=access_denied&state=st"),
    );
    expect(noCookieAtAll.status).toBe(302);
    expect(noCookieAtAll.headers.get("location")).toBe("https://portal.example.com/login?error=state_mismatch");
    expect(noCookieAtAll.headers.getSetCookie()).toEqual([]);
  });

  it("on the happy path, redirects to the origin plus the return path with a session cookie", async () => {
    const token = await idToken({ email: "ada@example.com", email_verified: true, name: "Ada", nonce: "no", hd: "example.com" });
    stubNetwork(token);
    const cookie = [
      "__Host-portal_oidc_state=st",
      "__Host-portal_oidc_nonce=no",
      "__Host-portal_oidc_verifier=ver",
      `__Host-portal_oidc_return=${encodeURIComponent("/projects/7")}`,
    ].join("; ");
    const response = await GET(
      new Request("https://portal.example.com/api/auth/callback?code=the-code&state=st", { headers: { cookie } }),
    );
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("https://portal.example.com/projects/7");

    const cookies = response.headers.getSetCookie();
    const session = cookies.find((c) => c.startsWith("__Host-portal_session="));
    expect(session).toBeDefined();
    expect(session).toContain("HttpOnly");
    expect(session).toContain("SameSite=Lax");
  });

  it("clears all four transient cookies on every failure path and on success", async () => {
    // Failure: a state that does not match its cookie.
    const mismatchCookie =
      "__Host-portal_oidc_state=st; __Host-portal_oidc_nonce=no; __Host-portal_oidc_verifier=ver";
    const mismatch = await GET(
      new Request("https://portal.example.com/api/auth/callback?code=abc&state=other", {
        headers: { cookie: mismatchCookie },
      }),
    );
    expectTransientsCleared(mismatch.headers.getSetCookie());

    // Failure: the provider itself refused, with a state that matches its
    // cookie (an error response is only honored, and only then clears
    // cookies, once state proves it belongs to this pending attempt).
    const deniedCookie =
      "__Host-portal_oidc_state=st; __Host-portal_oidc_nonce=no; __Host-portal_oidc_verifier=ver";
    const denied = await GET(
      new Request("https://portal.example.com/api/auth/callback?error=access_denied&state=st", {
        headers: { cookie: deniedCookie },
      }),
    );
    expectTransientsCleared(denied.headers.getSetCookie());

    // Success.
    const token = await idToken({ email: "ada@example.com", email_verified: true, nonce: "no", hd: "example.com" });
    stubNetwork(token);
    const successCookie =
      "__Host-portal_oidc_state=st; __Host-portal_oidc_nonce=no; __Host-portal_oidc_verifier=ver";
    const success = await GET(
      new Request("https://portal.example.com/api/auth/callback?code=the-code&state=st", {
        headers: { cookie: successCookie },
      }),
    );
    expect(success.status).toBe(302);
    expectTransientsCleared(success.headers.getSetCookie());
  });

  it("rate-limits a caller that hits the callback thirty-one times in a minute", async () => {
    const headers = {
      "x-forwarded-for": "9.9.9.9",
      cookie: "__Host-portal_oidc_state=st; __Host-portal_oidc_nonce=no; __Host-portal_oidc_verifier=ver",
    };
    for (let i = 0; i < 30; i += 1) {
      // state mismatch on every call: cheap to construct, and the rate limit
      // must trip before completeLogin is even reached.
      const response = await GET(
        new Request("https://portal.example.com/api/auth/callback?code=abc&state=other", { headers }),
      );
      expect(response.status).toBe(302);
    }
    const blocked = await GET(
      new Request("https://portal.example.com/api/auth/callback?code=abc&state=other", { headers }),
    );
    expect(blocked.status).toBe(429);
    // The 429 exit is not exempt from the cleanup every other exit does.
    expectTransientsCleared(blocked.headers.getSetCookie());
  });

  it("re-validates the return path pulled from its cookie, refusing an open redirect", async () => {
    const token = await idToken({ email: "ada@example.com", email_verified: true, nonce: "no", hd: "example.com" });
    stubNetwork(token);
    const cookie = [
      "__Host-portal_oidc_state=st",
      "__Host-portal_oidc_nonce=no",
      "__Host-portal_oidc_verifier=ver",
      `__Host-portal_oidc_return=${encodeURIComponent("//evil.example")}`,
    ].join("; ");
    const response = await GET(
      new Request("https://portal.example.com/api/auth/callback?code=the-code&state=st", { headers: { cookie } }),
    );
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("https://portal.example.com/");
  });

  it("does not prefix cookies under a loopback http baseUrl", async () => {
    getConfigMock.mockReturnValue({
      auth: { mode: "oidc", oidc: { ...oidc, baseUrl: "http://localhost:3100" } },
    });
    const cookie = "portal_oidc_state=st; portal_oidc_nonce=no; portal_oidc_verifier=ver";
    const response = await GET(
      new Request("http://localhost:3100/api/auth/callback?code=abc&state=other", { headers: { cookie } }),
    );
    expect(response.status).toBe(302);
    const cookies = response.headers.getSetCookie();
    expect(cookies.every((c) => !c.startsWith("__Host-"))).toBe(true);
    expect(cookies).toContain("portal_oidc_state=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax");
  });
});
