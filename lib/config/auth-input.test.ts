import { describe, it, expect } from "vitest";
import { PortalConfigSchema } from "./schema";

const parse = (auth: unknown) => PortalConfigSchema.safeParse({ auth });

const jwtBlock = {
  algorithm: "HS256",
  secret: "s3cret",
  issuer: "https://idp.example.com",
  audience: "portal",
};

describe("PortalConfigSchema auth, inactive mode blocks", () => {
  it("ignores a leftover jwt block under proxy-header", () => {
    const result = parse({ mode: "proxy-header", jwt: jwtBlock });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.auth).not.toHaveProperty("jwt");
  });

  it("ignores a leftover proxyHeader block under jwt", () => {
    const result = parse({ mode: "jwt", jwt: jwtBlock, proxyHeader: {} });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.auth).not.toHaveProperty("proxyHeader");
  });

  it("ignores an inactive none and oidc block", () => {
    const result = parse({ mode: "proxy-header", none: {}, oidc: { provider: "bogus" } });
    expect(result.success).toBe(true);
  });

  it("still validates the block that matches mode", () => {
    expect(parse({ mode: "jwt", jwt: { algorithm: "HS256" }, proxyHeader: {} }).success).toBe(false);
  });

  it("still rejects an unknown key", () => {
    expect(parse({ mode: "proxy-header", jwt: jwtBlock, bogus: 1 }).success).toBe(false);
  });
});
