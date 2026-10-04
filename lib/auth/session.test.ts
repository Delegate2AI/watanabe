import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { OidcConfig } from "@/lib/config/schema";
import {
  isSecureBaseUrl,
  sessionCookieOptions,
  transientCookieOptions,
  mintSession,
  verifySession,
  sessionSetCookie,
  sessionClearCookie,
  withHostPrefix,
} from "./session";
import { readCookie, serializeCookie } from "@/lib/http/cookies";
import { log } from "@/lib/log";

const SECRET = "a".repeat(32);

const config: OidcConfig = {
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

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(log, "warn").mockImplementation(() => {});
  vi.stubEnv("PORTAL_SESSION_SECRET", SECRET);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("isSecureBaseUrl", () => {
  it("is true for https and false for http", () => {
    expect(isSecureBaseUrl("https://portal.example.com")).toBe(true);
    expect(isSecureBaseUrl("http://localhost:3100")).toBe(false);
  });

  it("fails closed on a URL it cannot parse", () => {
    expect(isSecureBaseUrl("not a url")).toBe(true);
  });
});

describe("cookie options", () => {
  it("the session cookie is httpOnly, lax, and rooted", () => {
    expect(sessionCookieOptions(config)).toEqual({
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      maxAge: 168 * 3600,
    });
  });

  it("drops Secure when the portal is served over http", () => {
    expect(sessionCookieOptions({ ...config, baseUrl: "http://localhost:3100" }).secure).toBe(false);
  });

  it("transient cookies live ten minutes", () => {
    expect(transientCookieOptions(config).maxAge).toBe(600);
  });
});

describe("withHostPrefix", () => {
  it("prefixes the name with __Host- under an https baseUrl", () => {
    expect(withHostPrefix("https://portal.example.com", "portal_session")).toBe("__Host-portal_session");
  });

  it("leaves the name bare under http://localhost", () => {
    expect(withHostPrefix("http://localhost:3100", "portal_session")).toBe("portal_session");
  });

  it("leaves the name bare for any loopback http host", () => {
    expect(withHostPrefix("http://127.0.0.1:3100", "portal_session")).toBe("portal_session");
  });

  it("round-trips through set and read under https", () => {
    const name = withHostPrefix("https://portal.example.com", "portal_session");
    const header = serializeCookie(name, "tok", sessionCookieOptions(config));
    expect(header.startsWith("__Host-portal_session=")).toBe(true);
    expect(readCookie(header, name)).toBe("tok");
  });

  it("round-trips through set and read under http://localhost", () => {
    const localConfig = { ...config, baseUrl: "http://localhost:3100" };
    const name = withHostPrefix(localConfig.baseUrl, "portal_session");
    const header = serializeCookie(name, "tok", sessionCookieOptions(localConfig));
    expect(header.startsWith("portal_session=")).toBe(true);
    expect(header.startsWith("__Host-")).toBe(false);
    expect(readCookie(header, name)).toBe("tok");
  });

  // The __Host- requirements (Secure, Path=/, no Domain) have to already hold
  // whenever the prefix is applied, or a real browser drops the cookie
  // outright. This checks that against the actual options this module
  // builds, rather than assuming it.
  it("only prefixes when the resulting cookie options already satisfy __Host-'s requirements", () => {
    const options = sessionCookieOptions(config);
    expect(withHostPrefix(config.baseUrl, "portal_session").startsWith("__Host-")).toBe(true);
    expect(options.secure).toBe(true);
    expect(options.path).toBe("/");
    expect("domain" in options).toBe(false);
  });
});

describe("mint and verify", () => {
  it("round-trips an identity", async () => {
    const token = await mintSession({ email: "ada@example.com", name: "Ada" }, config);
    expect(token).not.toBeNull();
    expect(await verifySession(token as string)).toEqual({ email: "ada@example.com", name: "Ada" });
  });

  it("round-trips an identity with no name", async () => {
    const token = await mintSession({ email: "ada@example.com" }, config);
    expect(await verifySession(token as string)).toEqual({ email: "ada@example.com" });
  });

  it("refuses to mint without a usable secret", async () => {
    vi.stubEnv("PORTAL_SESSION_SECRET", "short");
    expect(await mintSession({ email: "ada@example.com" }, config)).toBeNull();
  });

  it("rejects a token signed with a different secret", async () => {
    const token = await mintSession({ email: "ada@example.com" }, config);
    vi.stubEnv("PORTAL_SESSION_SECRET", "b".repeat(32));
    expect(await verifySession(token as string)).toBeNull();
  });

  it("rejects a tampered token", async () => {
    const token = (await mintSession({ email: "ada@example.com" }, config)) as string;
    const [head, , sig] = token.split(".");
    const forgedBody = Buffer.from(JSON.stringify({ email: "root@example.com" })).toString("base64url");
    expect(await verifySession(`${head}.${forgedBody}.${sig}`)).toBeNull();
  });

  it("rejects an expired token", async () => {
    const token = (await mintSession({ email: "ada@example.com" }, { ...config, sessionTtlHours: 1 })) as string;
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 2 * 3600 * 1000);
    expect(await verifySession(token)).toBeNull();
    vi.useRealTimers();
  });

  it("rejects garbage and empty input without throwing", async () => {
    await expect(verifySession("")).resolves.toBeNull();
    await expect(verifySession("not.a.jwt")).resolves.toBeNull();
  });
});

describe("set-cookie strings", () => {
  it("sets the configured cookie name, __Host--prefixed under this https config", async () => {
    const token = (await mintSession({ email: "ada@example.com" }, config)) as string;
    const header = sessionSetCookie(token, config);
    expect(header.startsWith("__Host-portal_session=")).toBe(true);
    expect(header).toContain("HttpOnly");
    expect(header).toContain("Secure");
    expect(header).toContain("SameSite=Lax");
  });

  it("clears with Max-Age=0", () => {
    expect(sessionClearCookie(config)).toBe(
      "__Host-portal_session=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax",
    );
  });

  it("does not prefix the name under http://localhost", async () => {
    const localConfig = { ...config, baseUrl: "http://localhost:3100" };
    const token = (await mintSession({ email: "ada@example.com" }, localConfig)) as string;
    expect(sessionSetCookie(token, localConfig).startsWith("portal_session=")).toBe(true);
    expect(sessionClearCookie(localConfig).startsWith("portal_session=")).toBe(true);
  });
});
