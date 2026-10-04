import { describe, it, expect, vi, beforeEach } from "vitest";

const loadConnectorRegistryMock = vi.fn();
vi.mock("./registry", () => ({
  loadConnectorRegistry: (...args: unknown[]) => loadConnectorRegistryMock(...args),
}));

const resolveClearanceForEmailMock = vi.fn();
vi.mock("@/lib/identity/resolve", () => ({
  resolveClearanceForEmail: (...args: unknown[]) => resolveClearanceForEmailMock(...args),
}));

const { findClearedConnectorEntry } = await import("./clearance");

const REGISTRY = {
  entries: [
    { slug: "linear", title: "Linear", transport: "http" as const, url: "https://l.example", groups: ["eng"] },
    { slug: "payroll", title: "Payroll", transport: "http" as const, url: "https://p.example", groups: ["finance"] },
  ],
  errors: [],
};

beforeEach(() => {
  loadConnectorRegistryMock.mockReset().mockReturnValue(REGISTRY);
  resolveClearanceForEmailMock.mockReset().mockReturnValue(["eng"]);
});

describe("findClearedConnectorEntry", () => {
  it("returns the entry when the caller's clearance intersects its groups", () => {
    const entry = findClearedConnectorEntry("linear", "alice@example.com");
    expect(entry?.slug).toBe("linear");
    expect(resolveClearanceForEmailMock).toHaveBeenCalledWith("alice@example.com");
  });

  it("returns undefined for an unknown slug", () => {
    expect(findClearedConnectorEntry("nope", "alice@example.com")).toBeUndefined();
  });

  it("returns undefined when the caller's clearance does not intersect the entry's groups", () => {
    resolveClearanceForEmailMock.mockReturnValue(["marketing"]);
    expect(findClearedConnectorEntry("linear", "alice@example.com")).toBeUndefined();
  });

  it("re-resolves clearance on every call, so a revoked group is reflected immediately", () => {
    expect(findClearedConnectorEntry("linear", "alice@example.com")?.slug).toBe("linear");
    resolveClearanceForEmailMock.mockReturnValue([]);
    expect(findClearedConnectorEntry("linear", "alice@example.com")).toBeUndefined();
  });
});
