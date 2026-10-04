import { describe, it, expect, beforeEach, afterEach } from "vitest";

const { protectedResourceMetadata, resourceMetadataUrl, mcpUnauthorized } =
  await import("./resource-metadata");

beforeEach(() => {
  process.env.MCP_ENABLED = "1";

  
  process.env.MCP_PUBLIC_ORIGIN = "https://portal.example.test";
});

afterEach(() => {
  delete process.env.MCP_ENABLED;

  
  delete process.env.MCP_PUBLIC_ORIGIN;
});

describe("resourceMetadataUrl", () => {
  // RFC 9728: the resource's path is appended to the well-known prefix, so a
  // resource at /api/mcp advertises /.well-known/oauth-protected-resource/api/mcp.
  it("inserts the well-known prefix ahead of the resource path", () => {
    expect(resourceMetadataUrl()).toBe(
      "https://portal.example.test/.well-known/oauth-protected-resource/api/mcp",
    );
  });

  it("is null when the resource is not configured", () => {
    delete process.env.MCP_PUBLIC_ORIGIN;
    expect(resourceMetadataUrl()).toBeNull();
  });
});

describe("protectedResourceMetadata", () => {
  it("names this resource and the authorization server that guards it", () => {
    expect(protectedResourceMetadata()).toEqual({
      resource: "https://portal.example.test/api/mcp",
      authorization_servers: ["https://portal.example.test"],
      bearer_methods_supported: ["header"],
      scopes_supported: ["mcp"],
    });
  });

  it("is null when unconfigured, so the document cannot advertise a half-set-up server", () => {
    delete process.env.MCP_PUBLIC_ORIGIN;

    expect(protectedResourceMetadata()).toBeNull();
  });
});

describe("mcpUnauthorized", () => {
  it("points an unauthenticated client at the metadata document", () => {
    const response = mcpUnauthorized();
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toBe(
      'Bearer resource_metadata="https://portal.example.test/.well-known/oauth-protected-resource/api/mcp"',
    );
  });

  // Without a configured resource there is nothing to point at, and a
  // WWW-Authenticate naming no metadata would send a client into a dead loop.
  it("omits the challenge entirely when unconfigured, still answering 401", () => {
    delete process.env.MCP_PUBLIC_ORIGIN;
    const response = mcpUnauthorized();
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toBeNull();
  });

  // Flag-off has to restore the previous byte-path. The metadata route answers
  // 404 with the flag off, so a challenge naming it would point a client at
  // nothing.
  it.each(["MCP_ENABLED"])(
    "omits the challenge when %s is off, even with the issuer still configured",
    (flag) => {
      delete process.env[flag];
      const response = mcpUnauthorized();
      expect(response.status).toBe(401);
      expect(response.headers.get("www-authenticate")).toBeNull();
    },
  );

  it("keeps the same body every refusal already used, so a probe learns nothing new", async () => {
    const { unauthorized } = await import("@/lib/auth/identity");
    expect(await mcpUnauthorized().json()).toEqual(await unauthorized().json());
  });
});
