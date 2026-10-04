import { describe, it, expect, vi, afterEach } from "vitest";

const getConfigMock = vi.fn();
vi.mock("@/lib/config", () => ({ getConfig: () => getConfigMock() }));

afterEach(() => {
  vi.unstubAllEnvs();
});

const { resolveConnectorRedirectUri } = await import("./oauth-exchange");

describe("resolveConnectorRedirectUri", () => {
  it("builds the callback url from the configured oidc base url", () => {
    getConfigMock.mockReturnValue({ auth: { mode: "oidc", oidc: { baseUrl: "https://portal.example.com" } } });
    const result = resolveConnectorRedirectUri();
    expect(result).toEqual({ ok: true, value: "https://portal.example.com/api/connectors/oauth/callback" });
  });

  it("keeps only the origin of the configured oidc base url, dropping any path or trailing slash", () => {
    getConfigMock.mockReturnValue({ auth: { mode: "oidc", oidc: { baseUrl: "https://portal.example.com/some/path/" } } });
    const result = resolveConnectorRedirectUri();
    expect(result).toEqual({ ok: true, value: "https://portal.example.com/api/connectors/oauth/callback" });
  });

  it("prefers the oidc base url over MCP_PUBLIC_ORIGIN when both are available", () => {
    vi.stubEnv("MCP_PUBLIC_ORIGIN", "https://mcp.example.com/mcp");
    getConfigMock.mockReturnValue({ auth: { mode: "oidc", oidc: { baseUrl: "https://portal.example.com" } } });
    const result = resolveConnectorRedirectUri();
    expect(result).toEqual({ ok: true, value: "https://portal.example.com/api/connectors/oauth/callback" });
  });

  it("falls back to MCP_PUBLIC_ORIGIN's origin when the portal auth mode is not oidc", () => {
    vi.stubEnv("MCP_PUBLIC_ORIGIN", "https://mcp.example.com/mcp");
    getConfigMock.mockReturnValue({ auth: { mode: "proxy-header" } });
    const result = resolveConnectorRedirectUri();
    expect(result).toEqual({ ok: true, value: "https://mcp.example.com/api/connectors/oauth/callback" });
  });

  it("falls back to MCP_PUBLIC_ORIGIN's origin for every non oidc auth mode", () => {
    vi.stubEnv("MCP_PUBLIC_ORIGIN", "https://mcp.example.com/mcp");
    for (const mode of ["jwt", "none"]) {
      getConfigMock.mockReturnValue({ auth: { mode } });
      expect(resolveConnectorRedirectUri()).toEqual({ ok: true, value: "https://mcp.example.com/api/connectors/oauth/callback" });
    }
  });

  it("fails closed when auth.mode is not oidc and MCP_PUBLIC_ORIGIN is unset", () => {
    getConfigMock.mockReturnValue({ auth: { mode: "none" } });
    const result = resolveConnectorRedirectUri();
    expect(result.ok).toBe(false);
  });

  it("fails closed when MCP_PUBLIC_ORIGIN is not a valid https (or loopback) url", () => {
    vi.stubEnv("MCP_PUBLIC_ORIGIN", "not-a-url");
    getConfigMock.mockReturnValue({ auth: { mode: "jwt" } });
    expect(resolveConnectorRedirectUri().ok).toBe(false);
  });

  it("fails closed on a non loopback http MCP_PUBLIC_ORIGIN", () => {
    vi.stubEnv("MCP_PUBLIC_ORIGIN", "http://mcp.example.com/mcp");
    getConfigMock.mockReturnValue({ auth: { mode: "jwt" } });
    expect(resolveConnectorRedirectUri().ok).toBe(false);
  });

  it("accepts a loopback http MCP_PUBLIC_ORIGIN for local development", () => {
    vi.stubEnv("MCP_PUBLIC_ORIGIN", "http://localhost:4000/mcp");
    getConfigMock.mockReturnValue({ auth: { mode: "jwt" } });
    expect(resolveConnectorRedirectUri()).toEqual({ ok: true, value: "http://localhost:4000/api/connectors/oauth/callback" });
  });
});
