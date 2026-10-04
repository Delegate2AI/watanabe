import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const requireIdentityMock = vi.fn();
vi.mock("@/lib/auth/identity", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth/identity")>();
  return { ...actual, requireIdentity: (...args: unknown[]) => requireIdentityMock(...args) };
});

const resolveTokenMock = vi.fn();
const touchTokenMock = vi.fn();
vi.mock("@/lib/mcp-auth/tokens", () => ({
  resolveToken: (...args: unknown[]) => resolveTokenMock(...(args as [])),
  touchToken: (...args: unknown[]) => touchTokenMock(...(args as [])),
}));

vi.mock("@/lib/db/client", () => ({ getDb: () => ({}) }));

/**
 * Spread over the real module, so the real alias-aware `isKnownMember` runs
 * rather than a hand-stub. `carol@example.com` is deliberately on no roster:
 * she is the verified-but-unknown identity the membership rule turns away.
 */
vi.mock("@/lib/authority/groups", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/authority/groups")>();
  return {
    ...actual,
    loadGroups: () => ({ staff: ["alice@example.com", "bob@example.com"] }),
    resolveClearance: () => ["all-hands"],
  };
});
vi.mock("@/lib/repo", () => ({ vaultRootFor: () => "/vault" }));

const { resolveCaller, workspaceThreadId } = await import("./auth");

function withBearer(token: string): Headers {
  return new Headers({ authorization: `Bearer ${token}` });
}

beforeEach(() => {
  process.env.MCP_ENABLED = "1";
  requireIdentityMock.mockReset().mockResolvedValue({ response: new Response(null, { status: 401 }) });
  resolveTokenMock.mockReset().mockReturnValue(null);
  touchTokenMock.mockReset();
});

afterEach(() => {
  delete process.env.MCP_ENABLED;
});

describe("resolveCaller, bearer token", () => {
  it("accepts a live token belonging to a known member", async () => {
    resolveTokenMock.mockReturnValue({ id: "t1", ownerEmail: "alice@example.com" });

    expect(await resolveCaller(withBearer("good"))).toEqual({
      ownerEmail: "alice@example.com",
      workspaceKey: "token-t1",
    });
    expect(touchTokenMock).toHaveBeenCalledWith(expect.anything(), "t1");
  });

  it("refuses an unknown token, a revoked one, and an owner who is no longer a member identically", async () => {
    expect(await resolveCaller(withBearer("unknown"))).toBeNull();

    resolveTokenMock.mockReturnValue({ id: "t1", ownerEmail: "stranger@example.com" });
    expect(await resolveCaller(withBearer("orphaned"))).toBeNull();

    // Nothing is stamped for a credential that was not accepted, so an unused
    // token still reads as unused.
    expect(touchTokenMock).not.toHaveBeenCalled();
  });

  it("does not look at the token store at all with the flag off", async () => {
    delete process.env.MCP_ENABLED;

    expect(await resolveCaller(withBearer("good"))).toBeNull();
    expect(resolveTokenMock).not.toHaveBeenCalled();
  });

  it("ignores a malformed Authorization header rather than treating it as a token", async () => {
    expect(await resolveCaller(new Headers({ authorization: "Basic abc" }))).toBeNull();
    expect(await resolveCaller(new Headers({ authorization: "Bearer   " }))).toBeNull();
    expect(resolveTokenMock).not.toHaveBeenCalled();
  });

  /**
   * The load-bearing line of the two specs. Before this, a bearer was gated on
   * `manageAccess`; removing that check without replacing it would have admitted
   * any identity the issuer verified.
   */
  it("refuses a verified identity in no group exactly as it refuses an invented token", async () => {
    resolveTokenMock.mockReturnValue({ id: "t9", ownerEmail: "carol@example.com" });
    const nonMember = await resolveCaller(withBearer("real-token-wrong-person"));

    resolveTokenMock.mockReturnValue(null);
    const invented = await resolveCaller(withBearer("made-up"));

    expect(nonMember).toBeNull();
    expect(nonMember).toEqual(invented);
    expect(touchTokenMock).not.toHaveBeenCalled();
  });

  // A token names its owner and nothing else. Capabilities resolve live, so a
  // demoted admin keeps a working credential with a smaller tool set rather
  // than losing the credential itself.
  it("keeps admitting a token whose owner has lost their role but not their membership", async () => {
    resolveTokenMock.mockReturnValue({ id: "t1", ownerEmail: "bob@example.com" });

    expect(await resolveCaller(withBearer("still-good"))).toEqual({
      ownerEmail: "bob@example.com",
      workspaceKey: "token-t1",
    });
  });
});

describe("resolveCaller, SSO cookie", () => {
  it("falls through to the cookie identity when there is no bearer credential", async () => {
    requireIdentityMock.mockResolvedValue({ identity: { email: "bob@example.com" } });

    expect(await resolveCaller(new Headers())).toEqual({
      ownerEmail: "bob@example.com",
      workspaceKey: null,
    });
    expect(resolveTokenMock).not.toHaveBeenCalled();
  });

  it("applies the same membership rule to a cookie caller", async () => {
    requireIdentityMock.mockResolvedValue({ identity: { email: "carol@example.com" } });

    expect(await resolveCaller(new Headers())).toBeNull();
  });

  it("refuses a cookie caller with the flag off, which the old flag did not do", async () => {
    delete process.env.MCP_ENABLED;
    requireIdentityMock.mockResolvedValue({ identity: { email: "bob@example.com" } });

    expect(await resolveCaller(new Headers())).toBeNull();
  });
});

describe("workspaceThreadId", () => {
  const token = { ownerEmail: "alice@example.com", workspaceKey: "token-t1" };

  it("gives the same thread to two connections holding the same token", () => {
    expect(workspaceThreadId(token, "session-a")).toBe(workspaceThreadId(token, "session-b"));
  });

  it("gives two tokens two workspaces, even for the same person", () => {
    expect(workspaceThreadId(token, "s")).not.toBe(
      workspaceThreadId({ ...token, workspaceKey: "token-t2" }, "s"),
    );
  });

  it("keeps a cookie caller per-connection, since they never open a worktree", () => {
    const cookie = { ownerEmail: "bob@example.com", workspaceKey: null };
    expect(workspaceThreadId(cookie, "session-a")).not.toBe(workspaceThreadId(cookie, "session-b"));
  });

  it("never puts the email itself in a name that becomes a directory", () => {
    expect(workspaceThreadId(token, "s")).not.toContain("alice");
  });
});
