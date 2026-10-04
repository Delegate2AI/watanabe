import { describe, it, expect } from "vitest";
import { PortalConfigSchema, DEFAULT_CONFIG } from "./schema";

const parse = (v: unknown) => PortalConfigSchema.parse(v);
const fail = (v: unknown) => PortalConfigSchema.safeParse(v);

describe("PortalConfigSchema — defaults", () => {
  it("an empty document yields the built-in defaults", () => {
    const c = parse({});
    expect(c.app.name).toBe(DEFAULT_CONFIG.app.name);
    expect(c.auth.mode).toBe("proxy-header");
    expect(c.repo.vaultSubdir).toBe("docs");
  });

  it("defaults to proxy-header, i.e. today's behavior, not to no-auth", () => {
    expect(parse({}).auth.mode).toBe("proxy-header");
  });

  it("ships four neutral starter cards by default", () => {
    expect(parse({}).app.starters.map((s) => s.id)).toEqual([
      "whats-in-the-kb",
      "recent-changes",
      "draft-a-document",
      "find-a-decision",
    ]);
  });
});

describe("PortalConfigSchema: neutral defaults", () => {
  it("names the product Watanabe with no operator content", () => {
    const c = parse({});
    expect(c.app.name).toBe("Watanabe");
    expect(c.app.tagline).toBe("Your team's knowledge workspace");
    expect(c.app.navLabel).toBe("Knowledge base");
    expect(c.app.kbDescription).toBe("the team knowledge base");
    expect(c.app.composerPlaceholder).toBe("Ask anything about your knowledge base...");
  });

  it("has no house rules, neutral bot identities and a localhost-only embed", () => {
    const c = parse({});
    expect(c.agent.houseRules).toEqual([]);
    expect(c.git.botEmail).toBe("portal-bot@watanabe.local");
    expect(c.git.memoryEmail).toBe("portal-memory@watanabe.local");
    expect(c.embed.frameAncestors).toBe("'self' http://localhost:*");
  });

  it("rejects an unknown key under agent, git and embed", () => {
    expect(fail({ agent: { houseRule: [] } }).success).toBe(false);
    expect(fail({ git: { bot: "x" } }).success).toBe(false);
    expect(fail({ embed: { frame: "x" } }).success).toBe(false);
  });
});

describe("PortalConfigSchema — auth.jwt", () => {
  const rs256 = {
    mode: "jwt",
    jwt: {
      algorithm: "RS256",
      jwksUrl: "https://idp.example.com/.well-known/jwks.json",
      issuer: "https://idp.example.com",
      audience: "portal",
    },
  };
  const hs256 = {
    mode: "jwt",
    jwt: { algorithm: "HS256", secret: "s3cret", issuer: "https://idp.example.com", audience: "portal" },
  };

  it("accepts RS256 with a jwksUrl", () => {
    expect(parse({ auth: rs256 }).auth.mode).toBe("jwt");
  });

  it("accepts HS256 with a secret", () => {
    expect(parse({ auth: hs256 }).auth.mode).toBe("jwt");
  });

  it("rejects RS256 without a jwksUrl", () => {
    const r = fail({ auth: { ...rs256, jwt: { ...rs256.jwt, jwksUrl: undefined } } });
    expect(r.success).toBe(false);
  });

  // The dangerous combination: a secret sitting next to RS256 looks configured
  // but is never used, so a key rotation silently does nothing.
  it("rejects RS256 that also carries a secret", () => {
    const r = fail({ auth: { ...rs256, jwt: { ...rs256.jwt, secret: "oops" } } });
    expect(r.success).toBe(false);
  });

  it("rejects HS256 without a secret", () => {
    const r = fail({ auth: { mode: "jwt", jwt: { algorithm: "HS256", issuer: "i", audience: "a" } } });
    expect(r.success).toBe(false);
  });

  it("rejects HS256 that also carries a jwksUrl", () => {
    const r = fail({ auth: { ...hs256, jwt: { ...hs256.jwt, jwksUrl: "https://x/jwks" } } });
    expect(r.success).toBe(false);
  });

  it("defaults source to cookie and emailClaim to email", () => {
    const c = parse({ auth: rs256 });
    if (c.auth.mode !== "jwt") throw new Error("expected jwt");
    expect(c.auth.jwt.source).toBe("cookie");
    expect(c.auth.jwt.emailClaim).toBe("email");
  });

  it("rejects a non-url jwksUrl", () => {
    expect(fail({ auth: { ...rs256, jwt: { ...rs256.jwt, jwksUrl: "not-a-url" } } }).success).toBe(false);
  });
});

describe("PortalConfigSchema — auth.none", () => {
  it("requires an email", () => {
    expect(fail({ auth: { mode: "none", none: {} } }).success).toBe(false);
  });

  it("rejects a malformed email", () => {
    expect(fail({ auth: { mode: "none", none: { email: "nope" } } }).success).toBe(false);
  });

  it("accepts a valid email", () => {
    const c = parse({ auth: { mode: "none", none: { email: "dev@example.com" } } });
    expect(c.auth.mode).toBe("none");
  });
});

describe("PortalConfigSchema — starters", () => {
  it("rejects an unknown icon name rather than falling back", () => {
    const r = fail({
      app: { starters: [{ id: "a", label: "l", sub: "s", icon: "NotAnIcon", prompt: "p" }] },
    });
    expect(r.success).toBe(false);
  });

  it("accepts an allowlisted icon name", () => {
    const c = parse({
      app: { starters: [{ id: "a", label: "l", sub: "s", icon: "Gauge", prompt: "p" }] },
    });
    expect(c.app.starters[0].icon).toBe("Gauge");
  });

  it("allows an empty starters list (a portal with no empty-state cards)", () => {
    expect(parse({ app: { starters: [] } }).app.starters).toEqual([]);
  });
});

describe("PortalConfigSchema app.feedbackUrl", () => {
  it("has no default, so an unconfigured portal shows no feedback link", () => {
    expect(parse({}).app.feedbackUrl).toBeUndefined();
  });

  it("accepts a mailto address and an https form URL", () => {
    expect(parse({ app: { feedbackUrl: "mailto:team@example.com" } }).app.feedbackUrl).toBe(
      "mailto:team@example.com",
    );
    expect(parse({ app: { feedbackUrl: "https://forms.example.com/portal" } }).app.feedbackUrl).toBe(
      "https://forms.example.com/portal",
    );
  });

  it("rejects a bare address, which would render as a relative link going nowhere", () => {
    expect(fail({ app: { feedbackUrl: "team@example.com" } }).success).toBe(false);
    expect(fail({ app: { feedbackUrl: "" } }).success).toBe(false);
  });
});

describe("PortalConfigSchema skills.marketplaces", () => {
  it("is absent by default, so no marketplace is configured", () => {
    expect(parse({}).skills).toBeUndefined();
    expect(DEFAULT_CONFIG.skills).toBeUndefined();
  });

  it("defaults marketplaces to an empty list when the block is present but empty", () => {
    expect(parse({ skills: {} }).skills?.marketplaces).toEqual([]);
  });

  it("accepts a list of index URLs", () => {
    const c = parse({ skills: { marketplaces: ["https://skills.example.com/index.json"] } });
    expect(c.skills?.marketplaces).toEqual(["https://skills.example.com/index.json"]);
  });

  it("rejects an entry that is not an http(s) URL, so a bad scheme fails at boot", () => {
    expect(fail({ skills: { marketplaces: ["not-a-url"] } }).success).toBe(false);
    // A plain z.url() accepts all three of these, and they would then survive
    // boot and fail much later as a runtime error inside an admin screen.
    expect(fail({ skills: { marketplaces: ["file:///etc/passwd"] } }).success).toBe(false);
    expect(fail({ skills: { marketplaces: ["javascript:alert(1)"] } }).success).toBe(false);
    expect(fail({ skills: { marketplaces: ["data:text/plain,hi"] } }).success).toBe(false);
  });

  it("rejects an unknown key inside the skills block", () => {
    expect(fail({ skills: { marketplace: [] } }).success).toBe(false);
  });
});

describe("PortalConfigSchema — unknown keys", () => {
  // A typo like `auth.mod: none` must not silently leave mode at its default.
  it("rejects unknown keys instead of ignoring them", () => {
    expect(fail({ auth: { mode: "none", none: { email: "d@e.com" }, mod: "x" } }).success).toBe(false);
    expect(fail({ nonsense: true }).success).toBe(false);
  });
});

describe("auth.mode: oidc", () => {
  const minimal = {
    mode: "oidc",
    oidc: { clientId: "abc.apps.googleusercontent.com", baseUrl: "https://portal.example.com" },
  };

  it("defaults provider to google and fills the rest", () => {
    const c = parse({ auth: minimal });
    if (c.auth.mode !== "oidc") throw new Error("expected oidc");
    expect(c.auth.oidc.provider).toBe("google");
    expect(c.auth.oidc.scopes).toEqual(["openid", "email", "profile"]);
    expect(c.auth.oidc.cookieName).toBe("portal_session");
    expect(c.auth.oidc.sessionTtlHours).toBe(168);
    expect(c.auth.oidc.allowedDomains).toEqual([]);
  });

  it("requires clientId and baseUrl", () => {
    expect(() => parse({ auth: { mode: "oidc", oidc: {} } })).toThrow();
  });

  it("rejects a baseUrl that is not http(s)", () => {
    const auth = { ...minimal, oidc: { ...minimal.oidc, baseUrl: "file:///etc/passwd" } };
    expect(() => parse({ auth })).toThrow();
  });

  it("rejects an unknown key inside the oidc block", () => {
    const auth = { ...minimal, oidc: { ...minimal.oidc, allowedDomain: ["typo.com"] } };
    expect(() => parse({ auth })).toThrow();
  });

  it("leaves the three existing modes untouched", () => {
    expect(parse({}).auth.mode).toBe("proxy-header");
  });

  it("rejects provider: google with an explicit issuer, since Google's issuer is fixed", () => {
    const auth = { ...minimal, oidc: { ...minimal.oidc, issuer: "https://accounts.google.com" } };
    expect(fail({ auth }).success).toBe(false);
  });

  it("accepts an explicit issuer for a non-google provider", () => {
    const auth = {
      mode: "oidc",
      oidc: { ...minimal.oidc, provider: "logto", issuer: "https://idp.example.com" },
    };
    expect(parse({ auth }).auth.mode).toBe("oidc");
  });

  it("rejects a non-loopback http issuer", () => {
    const auth = {
      mode: "oidc",
      oidc: { ...minimal.oidc, provider: "logto", issuer: "http://idp.example.com" },
    };
    expect(fail({ auth }).success).toBe(false);
  });

  it("accepts a loopback http issuer, for local development", () => {
    const auth = {
      mode: "oidc",
      oidc: { ...minimal.oidc, provider: "logto", issuer: "http://localhost:9000" },
    };
    expect(parse({ auth }).auth.mode).toBe("oidc");
  });

  it("rejects a non-loopback http baseUrl", () => {
    const auth = { ...minimal, oidc: { ...minimal.oidc, baseUrl: "http://portal.example.com" } };
    expect(fail({ auth }).success).toBe(false);
  });

  it("accepts a loopback http baseUrl, for local development", () => {
    const auth = { ...minimal, oidc: { ...minimal.oidc, baseUrl: "http://localhost:3100" } };
    expect(parse({ auth }).auth.mode).toBe("oidc");
  });
});
