import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const requireIdentityMock = vi.fn();
vi.mock("@/lib/auth/identity", () => ({
  requireIdentity: (...args: unknown[]) => requireIdentityMock(...args),
}));

const canMock = vi.fn();
vi.mock("@/lib/authority/roles", () => ({
  can: (...args: unknown[]) => canMock(...args),
}));

const isConnectorsEnabledMock = vi.fn();
vi.mock("@/lib/connectors/config", () => ({
  isConnectorsEnabled: () => isConnectorsEnabledMock(),
}));

const loadConnectorRegistryMock = vi.fn();
vi.mock("@/lib/connectors/registry", () => ({
  loadConnectorRegistry: (...args: unknown[]) => loadConnectorRegistryMock(...args),
}));

const checkEgressUrlMock = vi.fn();
vi.mock("@/lib/connectors/egress", () => ({
  checkEgressUrl: (...args: unknown[]) => checkEgressUrlMock(...args),
}));

const dispatcherCloseMock = vi.fn();
const createPinnedDispatcherMock = vi.fn();
vi.mock("@/lib/connectors/egress-dispatcher", () => ({
  createPinnedDispatcher: (...args: unknown[]) => createPinnedDispatcherMock(...args),
}));

const connectMock = vi.fn();
const listToolsMock = vi.fn();
const closeMock = vi.fn();
const httpTransports: unknown[][] = [];
const sseTransports: unknown[][] = [];

vi.mock("@modelcontextprotocol/sdk/client/index.js", () => ({
  Client: class {
    connect = connectMock;
    listTools = listToolsMock;
  },
}));
vi.mock("@modelcontextprotocol/sdk/client/streamableHttp.js", () => ({
  StreamableHTTPClientTransport: class {
    close = closeMock;
    constructor(...args: unknown[]) {
      httpTransports.push(args);
    }
  },
}));
vi.mock("@modelcontextprotocol/sdk/client/sse.js", () => ({
  SSEClientTransport: class {
    close = closeMock;
    constructor(...args: unknown[]) {
      sseTransports.push(args);
    }
  },
}));

const { POST, dynamic, runtime } = await import("./route");

const IDENTITY = { email: "admin@example.com", name: "Admin" };

const HTTP_ENTRY = {
  slug: "linear",
  title: "Linear",
  transport: "http",
  url: "https://linear.example/mcp",
  headers: { Authorization: "Bearer ${LINEAR_TOKEN}" },
  groups: ["eng"],
};
const SSE_ENTRY = { slug: "wiki", title: "Wiki", transport: "sse", url: "https://wiki.example/sse", groups: ["all"] };
const STDIO_ENTRY = { slug: "local", title: "Local", transport: "stdio", command: "npx", args: ["-y", "x"], groups: ["eng"] };

function post(body: unknown): Request {
  return new Request("http://localhost/api/admin/connectors/test", {
    method: "POST",
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

const savedEnv = { ...process.env };

beforeEach(() => {
  requireIdentityMock.mockReset().mockResolvedValue({ identity: IDENTITY });
  canMock.mockReset().mockReturnValue(true);
  isConnectorsEnabledMock.mockReset().mockReturnValue(true);
  loadConnectorRegistryMock.mockReset().mockReturnValue({
    entries: [HTTP_ENTRY, SSE_ENTRY, STDIO_ENTRY],
    errors: [],
  });
  checkEgressUrlMock.mockReset().mockImplementation(async (url: string) => ({ ok: true, url: new URL(url) }));
  connectMock.mockReset().mockResolvedValue(undefined);
  listToolsMock.mockReset().mockResolvedValue({ tools: [{ name: "a" }, { name: "b" }] });
  closeMock.mockReset().mockResolvedValue(undefined);
  dispatcherCloseMock.mockReset().mockResolvedValue(undefined);
  createPinnedDispatcherMock.mockReset().mockReturnValue({ close: dispatcherCloseMock });
  httpTransports.length = 0;
  sseTransports.length = 0;
  process.env.LINEAR_TOKEN = "token-value";
});

afterEach(() => {
  process.env = { ...savedEnv };
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("POST /api/admin/connectors/test", () => {
  it("uses the required route runtime conventions", () => {
    expect(dynamic).toBe("force-dynamic");
    expect(runtime).toBe("nodejs");
  });

  it("401s without an identity, before touching the registry", async () => {
    requireIdentityMock.mockResolvedValue({ response: new Response(null, { status: 401 }) });

    expect((await POST(post({ slug: "linear" }))).status).toBe(401);
    expect(loadConnectorRegistryMock).not.toHaveBeenCalled();
  });

  it("404s when the flag is off", async () => {
    isConnectorsEnabledMock.mockReturnValue(false);

    expect((await POST(post({ slug: "linear" }))).status).toBe(404);
    expect(connectMock).not.toHaveBeenCalled();
  });

  it("403s a caller without manageAccess", async () => {
    canMock.mockReturnValue(false);

    const response = await POST(post({ slug: "linear" }));

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: { code: "needs_role" } });
    expect(connectMock).not.toHaveBeenCalled();
  });

  it("400s a body that is not a slug", async () => {
    expect((await POST(post("not-json"))).status).toBe(400);
    expect((await POST(post({}))).status).toBe(400);
  });

  it("404s a slug the registry does not carry", async () => {
    const response = await POST(post({ slug: "absent" }));

    expect(response.status).toBe(404);
    expect(connectMock).not.toHaveBeenCalled();
  });

  it("reports the tool count for a healthy http connector and closes the transport", async () => {
    const response = await POST(post({ slug: "linear" }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, toolCount: 2 });
    expect(httpTransports).toHaveLength(1);
    expect(closeMock).toHaveBeenCalled();
  });

  it("sends the interpolated headers and never the placeholder", async () => {
    await POST(post({ slug: "linear" }));

    const [url, options] = httpTransports[0] as [URL, { requestInit: { headers: Record<string, string> } }];
    expect(url.toString()).toBe("https://linear.example/mcp");
    expect(options.requestInit.headers).toEqual({ Authorization: "Bearer token-value" });
  });

  it("uses the sse transport for an sse connector", async () => {
    const response = await POST(post({ slug: "wiki" }));

    expect(await response.json()).toEqual({ ok: true, toolCount: 2 });
    expect(sseTransports).toHaveLength(1);
    expect(httpTransports).toHaveLength(0);
  });

  it("reports stdio as not testable rather than spawning anything", async () => {
    const response = await POST(post({ slug: "local" }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: false,
      error: "stdio connectors are not testable from the admin UI",
    });
    expect(connectMock).not.toHaveBeenCalled();
  });

  it("returns ok:false rather than throwing when the handshake fails", async () => {
    connectMock.mockRejectedValue(new Error("fetch failed"));

    const response = await POST(post({ slug: "linear" }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: false, error: "fetch failed" });
    expect(closeMock).toHaveBeenCalled();
  });

  it("rejects rather than hanging when an sse handshake never completes", async () => {
    // SSEClientTransport.start() resolves only on the server's endpoint event
    // and carries no timeout, so connect() can stay pending forever. The probe
    // must bound itself rather than trust the SDK's request-level signal.
    vi.useFakeTimers();
    connectMock.mockImplementation(() => new Promise(() => {}));

    const pending = POST(post({ slug: "wiki" }));
    await vi.advanceTimersByTimeAsync(5_000);
    const response = await pending;

    expect(response.status).toBe(200);
    const body = (await response.json()) as { ok: boolean; error: string };
    expect(body.ok).toBe(false);
    expect(body.error).toContain("timed out");
    expect(closeMock).toHaveBeenCalled();
  });

  it("aborts the abandoned request when the deadline passes", async () => {
    vi.useFakeTimers();
    connectMock.mockImplementation(() => new Promise(() => {}));

    const pending = POST(post({ slug: "linear" }));
    await vi.advanceTimersByTimeAsync(5_000);
    await pending;

    const [, options] = connectMock.mock.calls[0] as [unknown, { signal: AbortSignal }];
    expect(options.signal.aborted).toBe(true);
  });

  it("leaves no pending timer behind once a probe succeeds", async () => {
    vi.useFakeTimers();

    await POST(post({ slug: "linear" }));

    expect(vi.getTimerCount()).toBe(0);
  });

  it("returns ok:false rather than throwing when tools/list fails", async () => {
    listToolsMock.mockRejectedValue(new Error("method not found"));

    expect(await (await POST(post({ slug: "linear" }))).json()).toEqual({ ok: false, error: "method not found" });
  });

  it("returns ok:false when a referenced variable is missing from the environment", async () => {
    delete process.env.LINEAR_TOKEN;

    const response = await POST(post({ slug: "linear" }));

    expect(response.status).toBe(200);
    expect(((await response.json()) as { ok: boolean; error: string }).ok).toBe(false);
    expect(connectMock).not.toHaveBeenCalled();
  });

  it("refuses a connector whose url fails egress validation before touching the mcp sdk", async () => {
    checkEgressUrlMock.mockResolvedValue({ ok: false, reason: "resolved to a private address" });

    const response = await POST(post({ slug: "linear" }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: false, error: "resolved to a private address" });
    expect(connectMock).not.toHaveBeenCalled();
    expect(httpTransports).toHaveLength(0);
  });

  it("checks egress against the interpolated url", async () => {
    await POST(post({ slug: "linear" }));

    expect(checkEgressUrlMock).toHaveBeenCalledWith("https://linear.example/mcp");
  });

  it("wires a pinned-egress fetch into the mcp transport and closes the dispatcher after the probe", async () => {
    const response = await POST(post({ slug: "linear" }));

    expect(response.status).toBe(200);
    const [, options] = httpTransports[0] as [URL, { fetch: (...args: unknown[]) => unknown }];
    expect(createPinnedDispatcherMock).toHaveBeenCalled();
    expect(typeof options.fetch).toBe("function");
    expect(dispatcherCloseMock).toHaveBeenCalled();
  });

  it("closes the pinned dispatcher even when the handshake fails", async () => {
    connectMock.mockRejectedValue(new Error("fetch failed"));

    await POST(post({ slug: "linear" }));

    expect(dispatcherCloseMock).toHaveBeenCalled();
  });

  it("never creates a pinned dispatcher when egress validation already refused the url", async () => {
    checkEgressUrlMock.mockResolvedValue({ ok: false, reason: "resolved to a private address" });

    await POST(post({ slug: "linear" }));

    expect(createPinnedDispatcherMock).not.toHaveBeenCalled();
  });
});
