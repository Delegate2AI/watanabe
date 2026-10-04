// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";

const notFoundMock = vi.fn(() => {
  throw new Error("NEXT_NOT_FOUND");
});
vi.mock("next/navigation", () => ({ notFound: () => notFoundMock() }));

const headersMock = vi.fn(async () => new Headers());
vi.mock("next/headers", () => ({ headers: () => headersMock() }));

vi.mock("@/lib/db/client", () => ({ getDb: () => ({}) }));

const resolveExternalViewMock = vi.fn();
vi.mock("@/lib/shared-docs/external-view", () => ({
  resolveExternalView: (...args: unknown[]) => resolveExternalViewMock(...args),
}));

const Page = (await import("./page")).default;

function ctx(token: string) {
  return { params: Promise.resolve({ token }) };
}

beforeEach(() => {
  notFoundMock.mockClear();
  headersMock.mockReset().mockResolvedValue(new Headers());
  resolveExternalViewMock.mockReset();
});

describe("external shared-doc page", () => {
  it("notFound() when the feature is unavailable (flag off)", async () => {
    resolveExternalViewMock.mockReturnValue({ status: "unavailable" });
    await expect(Page(ctx("t"))).rejects.toThrow("NEXT_NOT_FOUND");
    expect(notFoundMock).toHaveBeenCalled();
  });

  it("notFound() for an invalid/expired/revoked token (no oracle)", async () => {
    resolveExternalViewMock.mockReturnValue({ status: "not-found" });
    await expect(Page(ctx("t"))).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("renders a throttle notice when rate-limited (never the doc)", async () => {
    resolveExternalViewMock.mockReturnValue({ status: "rate-limited" });
    const { container } = render(await Page(ctx("t")));
    expect(container.textContent).toContain("Too many requests");
    expect(notFoundMock).not.toHaveBeenCalled();
  });

  it("renders the read-only doc for a valid token, with no edit affordance", async () => {
    resolveExternalViewMock.mockReturnValue({
      status: "ok",
      title: "Partner brief",
      body: "# hello world",
      access: "view",
      comments: [],
    });
    const { container } = render(await Page(ctx("t")));
    expect(container.textContent).toContain("Partner brief");
    expect(container.textContent).toContain("can view");
    // No interactive edit or share-management affordance leaks onto the
    // external surface: no buttons, no inputs, no links out to management.
    expect(container.querySelector("button")).toBeNull();
    expect(container.querySelector("input")).toBeNull();
    expect(container.querySelector("textarea")).toBeNull();
    const text = container.textContent?.toLowerCase() ?? "";
    expect(text).not.toContain("edit");
    expect(text).not.toContain("manage");
    expect(text).not.toContain("revoke");
  });

  it("renders an HTML document in the sandboxed frame, not through markdown", async () => {
    resolveExternalViewMock.mockReturnValue({
      status: "ok",
      title: "Designed page",
      body: "<h1>Designed</h1>",
      format: "html",
      access: "view",
      comments: [],
    });
    const { container } = render(await Page(ctx("t")));
    const frame = container.querySelector("iframe");
    expect(frame).not.toBeNull();
    // The frame is the boundary on this surface above all others: it is reached
    // with no session at all.
    expect(frame?.getAttribute("sandbox")).toBe("");
  });

  it("passes the client key derived from x-forwarded-for to the resolver", async () => {
    headersMock.mockResolvedValue(new Headers({ "x-forwarded-for": "9.9.9.9, 10.0.0.1" }));
    resolveExternalViewMock.mockReturnValue({ status: "not-found" });
    await expect(Page(ctx("tok"))).rejects.toThrow();
    expect(resolveExternalViewMock).toHaveBeenCalledWith({}, "tok", "9.9.9.9");
  });
});
