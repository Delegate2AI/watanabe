import { describe, it, expect, beforeEach, afterEach } from "vitest";

/**
 * The discovery document that makes `/api/mcp` reachable from a browser-based
 * MCP client. It lives under a dot-directory (`app/.well-known/...`) because
 * RFC 9728 fixes the path; the build output confirms Next serves it.
 *
 * The test lives here rather than beside the route so vitest's default glob,
 * which does not descend into dot-directories, still finds it.
 */
const { GET } = await import("@/app/.well-known/oauth-protected-resource/api/mcp/route");

beforeEach(() => {
  process.env.MCP_ENABLED = "1";

  
  process.env.MCP_PUBLIC_ORIGIN = "https://portal.example.test";
});

afterEach(() => {
  delete process.env.MCP_ENABLED;

  
  delete process.env.MCP_PUBLIC_ORIGIN;
});

describe("GET /.well-known/oauth-protected-resource/api/mcp", () => {
  it("publishes the resource and its authorization server", async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      resource: "https://portal.example.test/api/mcp",
      authorization_servers: ["https://portal.example.test"],
      bearer_methods_supported: ["header"],
      scopes_supported: ["mcp"],
    });
  });

  // The document is public, non-secret, and fetched cross-origin by clients
  // that run in a browser.
  it("is cacheable and readable cross-origin", async () => {
    const response = await GET();
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    expect(response.headers.get("cache-control")).toContain("max-age");
  });

  it("is a 404 with the flag off, so flag-off leaves nothing advertised", async () => {
    delete process.env.MCP_ENABLED;
    expect((await GET()).status).toBe(404);
  });

  it("is a 404 when the identity provider has not been configured yet", async () => {
    delete process.env.MCP_PUBLIC_ORIGIN;
    expect((await GET()).status).toBe(404);
  });
});
