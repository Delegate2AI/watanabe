import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDb } from "@/lib/db/client";
import { registerClient } from "./clients";
import { checkAuthorizeParams, redirectWith } from "./authorize";

let db: import("better-sqlite3").Database;
let clientId: string;

const REDIRECT = "https://claude.ai/cb";

function params(overrides: Record<string, string | null> = {}): URLSearchParams {
  const base: Record<string, string> = {
    client_id: clientId,
    redirect_uri: REDIRECT,
    response_type: "code",
    code_challenge: "a-challenge",
    code_challenge_method: "S256",
    state: "xyz",
  };
  const merged = new URLSearchParams(base);
  for (const [key, value] of Object.entries(overrides)) {
    if (value === null) merged.delete(key);
    else merged.set(key, value);
  }
  return merged;
}

beforeEach(() => {
  db = openDb(":memory:");
  clientId = registerClient(db, {
    clientName: "Claude",
    redirectUris: [REDIRECT, "https://claude.ai/second"],
  }).clientId;
});

afterEach(() => db.close());

describe("checkAuthorizeParams, refusals that must not redirect", () => {
  // Sending an error to an address that has not been verified as the client's
  // own is how an authorization endpoint becomes an open redirect.
  it.each([
    ["no client_id", { client_id: null }],
    ["a client that never registered", { client_id: "made-up" }],
    ["no redirect_uri", { redirect_uri: null }],
    ["a redirect the client did not register", { redirect_uri: "https://evil.test/cb" }],
    ["a redirect that only looks like a registered one", { redirect_uri: "https://claude.ai/cb/extra" }],
    ["a registered redirect with a query appended", { redirect_uri: "https://claude.ai/cb?x=1" }],
  ])("displays rather than redirects for %s", (_label, overrides) => {
    const result = checkAuthorizeParams(db, params(overrides));

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.kind).toBe("display");
  });

  it("accepts any of the redirect URIs the client actually registered", () => {
    expect(checkAuthorizeParams(db, params({ redirect_uri: "https://claude.ai/second" })).ok).toBe(true);
  });
});

describe("checkAuthorizeParams, refusals the client may be told about", () => {
  it.each([
    ["a response type that is not code", { response_type: "token" }, "unsupported_response_type"],
    ["plain PKCE", { code_challenge_method: "plain" }, "invalid_request"],
    ["a missing challenge method", { code_challenge_method: null }, "invalid_request"],
    ["no code challenge at all", { code_challenge: null }, "invalid_request"],
    ["a scope this server does not grant", { scope: "admin" }, "invalid_scope"],
  ])("redirects %s back as %s", (_label, overrides, error) => {
    const result = checkAuthorizeParams(db, params(overrides));

    expect(result.ok === false && result.kind).toBe("redirect");
    expect(result.ok === false && result.kind === "redirect" && result.error).toBe(error);
    // state has to survive a refusal, or the client cannot match it to a request.
    expect(result.ok === false && result.kind === "redirect" && result.state).toBe("xyz");
  });

  it("accepts the one scope this server grants, and an absent one", () => {
    expect(checkAuthorizeParams(db, params({ scope: "mcp" })).ok).toBe(true);
    expect(checkAuthorizeParams(db, params({ scope: null })).ok).toBe(true);
  });
});

describe("checkAuthorizeParams, success", () => {
  it("carries the challenge and state through for the code to be bound to", () => {
    const result = checkAuthorizeParams(db, params());

    expect(result.ok && result.request).toEqual({
      clientId,
      redirectUri: REDIRECT,
      codeChallenge: "a-challenge",
      state: "xyz",
    });
    expect(result.ok && result.client.clientName).toBe("Claude");
  });
});

describe("redirectWith", () => {
  it("adds parameters without disturbing what the URI already carries", () => {
    expect(redirectWith("https://claude.ai/cb?keep=1", { code: "abc", state: "xyz" })).toBe(
      "https://claude.ai/cb?keep=1&code=abc&state=xyz",
    );
  });

  it("omits a null, so an absent state does not become the string null", () => {
    expect(redirectWith("https://claude.ai/cb", { code: "abc", state: null })).toBe(
      "https://claude.ai/cb?code=abc",
    );
  });
});
