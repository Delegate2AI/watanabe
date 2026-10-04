import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
}));

const notFoundMock = vi.fn(() => {
  throw new Error("NEXT_NOT_FOUND");
});
vi.mock("next/navigation", () => ({
  notFound: () => notFoundMock(),
}));

// Thread is a client component; stub it so the page renders without a runtime.
vi.mock("@/components/chat/thread", () => ({ Thread: () => null }));

const getIdentityMock = vi.fn();
vi.mock("@/lib/auth/identity", () => ({
  getIdentity: (...args: unknown[]) => getIdentityMock(...args),
}));

vi.mock("@/lib/db/client", () => ({ getDb: () => ({}) }));

const isOwnedByMock = vi.fn();
vi.mock("@/lib/db/ownership", () => ({
  isOwnedBy: (...args: unknown[]) => isOwnedByMock(...args),
}));

vi.mock("@/lib/attachments/store", () => ({ isAttachmentsEnabled: () => false }));
vi.mock("@/lib/dictate/config", () => ({ isDictationEnabled: () => false }));
vi.mock("@/lib/agent/model-options", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/agent/model-options")>();
  return { ...actual, modelAllowlist: () => [], isModelSwitchingEnabled: () => false };
});
vi.mock("@/lib/agent/model-availability", () => ({
  availableModelAllowlist: async () => [{ id: "claude-sonnet-5", label: "Sonnet 5" }],
}));

const getThreadModelChoiceMock = vi.fn();
vi.mock("@/lib/db/threads", () => ({
  getThreadModelChoice: (...args: unknown[]) => getThreadModelChoiceMock(...args),
}));

const Page = (await import("./page")).default;

const call = (id: string, q?: string) =>
  Page({ params: Promise.resolve({ id }), searchParams: Promise.resolve(q ? { q } : {}) });

async function threadProps(id: string, q?: string): Promise<Record<string, unknown>> {
  const element = (await call(id, q)) as unknown as { props: Record<string, unknown> };
  return element.props;
}

beforeEach(() => {
  notFoundMock.mockClear();
  getThreadModelChoiceMock.mockReset().mockReturnValue(null);
  getIdentityMock.mockReset().mockResolvedValue({ email: "alice@example.com" });
  isOwnedByMock.mockReset().mockReturnValue(true);
});

describe("ChatThreadPage server-side ownership", () => {
  it("404s a resume of a thread the caller does not own (foreign)", async () => {
    isOwnedByMock.mockReturnValue(false);
    await expect(call("foreign-id")).rejects.toThrow("NEXT_NOT_FOUND");
    expect(notFoundMock).toHaveBeenCalled();
  });

  it("404s a resume of an unknown id IDENTICALLY (isOwnedBy false for both)", async () => {
    isOwnedByMock.mockReturnValue(false);
    await expect(call("unknown-id")).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("404s when there is no identity", async () => {
    getIdentityMock.mockResolvedValue(null);
    await expect(call("some-id")).rejects.toThrow("NEXT_NOT_FOUND");
    expect(isOwnedByMock).not.toHaveBeenCalled();
  });

  it("renders a resume of an owned thread", async () => {
    isOwnedByMock.mockReturnValue(true);
    await expect(call("owned-id")).resolves.toBeTruthy();
    expect(notFoundMock).not.toHaveBeenCalled();
  });

  it("hands the resume path the choice stored on the thread row", async () => {
    getThreadModelChoiceMock.mockReturnValue({ model: "claude-sonnet-5", effort: "high" });

    const props = await threadProps("owned-id");

    expect(getThreadModelChoiceMock).toHaveBeenCalledWith({}, "owned-id");
    expect(props.initialChoice).toEqual({ model: "claude-sonnet-5", effort: "high" });
  });

  it("hands the resume path an empty choice when the row stores none", async () => {
    const props = await threadProps("owned-id");

    expect(props.initialChoice).toEqual({});
  });

  it("renders a NEW thread (?q= seed) without any ownership check", async () => {
    await expect(call("client-minted", "what changed?")).resolves.toBeTruthy();
    expect(isOwnedByMock).not.toHaveBeenCalled();
    expect(getIdentityMock).not.toHaveBeenCalled();
  });
});
