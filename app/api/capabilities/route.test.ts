import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const requireIdentityMock = vi.fn();
vi.mock("@/lib/auth/identity", () => ({
  requireIdentity: (...args: unknown[]) => requireIdentityMock(...args),
}));

const kbWriteFlagMock = vi.fn();
vi.mock("@/lib/authority/write-gate", () => ({
  isKbWriteEnabled: () => kbWriteFlagMock(),
}));

const dictationMock = vi.fn();
vi.mock("@/lib/dictate/config", async (importActual) => {
  const actual = await importActual<typeof import("@/lib/dictate/config")>();
  return { ...actual, isDictationEnabled: () => dictationMock() };
});

const contentMock = vi.fn();
vi.mock("@/lib/content/config", async (importActual) => {
  const actual = await importActual<typeof import("@/lib/content/config")>();
  return { ...actual, isContentConfigured: () => contentMock() };
});

const { GET } = await import("./route");

const IDENTITY = { email: "alice@example.com", name: "Alice" };
const SECRET = "glpat-super-secret-value";

function get(): Request {
  return new Request("http://localhost/api/capabilities");
}

beforeEach(() => {
  requireIdentityMock.mockReset().mockReturnValue({ identity: IDENTITY });
  kbWriteFlagMock.mockReset().mockReturnValue(true);
  dictationMock.mockReset().mockReturnValue(true);
  contentMock.mockReset().mockReturnValue(true);
  process.env.REPO_WRITE_TOKEN = SECRET;
});

afterEach(() => {
  delete process.env.REPO_WRITE_TOKEN;
});

describe("GET /api/capabilities", () => {
  it("401s without an identity, so it is not an open probe of the deployment", async () => {
    requireIdentityMock.mockReturnValue({ response: Response.json({ error: "no" }, { status: 401 }) });
    const res = await GET(get());
    expect(res.status).toBe(401);
  });

  it("reports every capability as a boolean and nothing else", async () => {
    const res = await GET(get());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ kbWrite: true, dictation: true, shortFormContent: true });
  });

  it("never returns the write token, or any part of it, in the body", async () => {
    const raw = await GET(get()).then((r) => r.text());
    expect(raw).not.toContain(SECRET);
    expect(raw).not.toContain("glpat");
    expect(raw).not.toContain("REPO_WRITE_TOKEN");
  });

  it("reports kbWrite false when the write flag is off, even with a token present", async () => {
    kbWriteFlagMock.mockReturnValue(false);
    expect(await GET(get()).then((r) => r.json())).toEqual({ kbWrite: false, dictation: true, shortFormContent: true });
  });

  it("reports kbWrite false when no write token is configured, even with the flag on", async () => {
    delete process.env.REPO_WRITE_TOKEN;
    expect(await GET(get()).then((r) => r.json())).toEqual({ kbWrite: false, dictation: true, shortFormContent: true });
  });

  it("treats a blank write token as no token", async () => {
    process.env.REPO_WRITE_TOKEN = "   ";
    expect(await GET(get()).then((r) => r.json())).toEqual({ kbWrite: false, dictation: true, shortFormContent: true });
  });

  it("reports dictation independently of the write path", async () => {
    dictationMock.mockReturnValue(false);
    expect(await GET(get()).then((r) => r.json())).toEqual({ kbWrite: true, dictation: false, shortFormContent: true });
  });

  it("reports shortFormContent false when the portal holds no content service key", async () => {
    // service is unmerged. That is not-configured, not a capability.
    contentMock.mockReturnValue(false);
    expect(await GET(get()).then((r) => r.json())).toEqual({
      kbWrite: true,
      dictation: true,
      shortFormContent: false,
    });
  });

  it("degrades to no capabilities rather than throwing when a gate blows up", async () => {
    kbWriteFlagMock.mockImplementation(() => {
      throw new Error("flags.yaml is unreadable");
    });
    const res = await GET(get());
    expect(res.status).toBe(200);
    const body = (await res.json()) as { kbWrite: boolean; dictation: boolean };
    expect(body.kbWrite).toBe(false);
  });

  it("does not put an exception message in the body when a gate blows up", async () => {
    dictationMock.mockImplementation(() => {
      throw new Error("DICTATION_API_URL is malformed");
    });
    const raw = await GET(get()).then((r) => r.text());
    expect(raw).not.toContain("DICTATION_API_URL");
    expect(raw).not.toContain("malformed");
  });
});
