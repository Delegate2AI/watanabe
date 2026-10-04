// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import type { OidcConfig } from "@/lib/config/schema";

const getConfigMock = vi.fn();
vi.mock("@/lib/config", () => ({ getConfig: () => getConfigMock() }));
const notFoundMock = vi.fn(() => {
  throw new Error("NEXT_NOT_FOUND");
});
vi.mock("next/navigation", () => ({ notFound: () => notFoundMock() }));

const oidc: OidcConfig = {
  provider: "google",
  clientId: "abc",
  baseUrl: "https://portal.example.com",
  allowedDomains: ["example.com"],
  allowedEmails: [],
  scopes: ["openid", "email", "profile"],
  emailClaim: "email",
  nameClaim: "name",
  cookieName: "portal_session",
  sessionTtlHours: 168,
};

let LoginPage: (props: {
  searchParams: Promise<{ error?: string | string[]; next?: string | string[] }>;
}) => Promise<ReactElement>;

beforeEach(async () => {
  vi.resetModules();
  notFoundMock.mockClear();
  getConfigMock.mockReturnValue({ auth: { mode: "oidc", oidc }, app: { name: "Meridian Portal" } });
  LoginPage = (await import("./page")).default;
});

const renderPage = async (params: { error?: string | string[]; next?: string | string[] } = {}) =>
  render(await LoginPage({ searchParams: Promise.resolve(params) }));

describe("/login", () => {
  it("offers one provider button pointing at the start route", async () => {
    await renderPage();
    const link = screen.getByRole("link", { name: /continue with google/i });
    expect(link).toHaveAttribute("href", "/api/auth/login");
  });

  it("threads a safe next through to the start route", async () => {
    await renderPage({ next: "/projects/7" });
    expect(screen.getByRole("link", { name: /continue with google/i })).toHaveAttribute(
      "href",
      "/api/auth/login?next=%2Fprojects%2F7",
    );
  });

  it("refuses to thread an unsafe next", async () => {
    await renderPage({ next: "//evil.example" });
    expect(screen.getByRole("link", { name: /continue with google/i })).toHaveAttribute(
      "href",
      "/api/auth/login",
    );
  });

  it("renders human copy for a known error code", async () => {
    await renderPage({ error: "not_allowed" });
    expect(screen.getByText(/not allowed to use this portal/i)).toBeInTheDocument();
  });

  it("falls back to generic copy for an unknown code, and never echoes it", async () => {
    await renderPage({ error: "<script>alert(1)</script>" });
    expect(screen.getByText(/could not be completed/i)).toBeInTheDocument();
    expect(screen.queryByText(/script/i)).toBeNull();
  });

  it("falls back to generic copy for inherited object keys", async () => {
    for (const probe of ["constructor", "toString", "hasOwnProperty", "__proto__"]) {
      const { unmount } = await renderPage({ error: probe });
      expect(screen.getByRole("alert")).toHaveTextContent(/could not be completed/i);
      unmount();
    }
  });

  it("renders rather than throwing on a repeated ?next= or ?error=", async () => {
    // Next's runtime searchParams type is string | string[] | undefined for a
    // repeated query parameter, not the single string the page used to
    // declare. This reproduces the reported TypeError: an unsafe first
    // occurrence of next falls back to the safe href, and an unrecognized
    // first occurrence of error falls back to the generic copy.
    await renderPage({ next: ["//evil.example", "/ok"], error: ["not-a-real-code", "other"] });
    expect(screen.getByRole("link", { name: /continue with google/i })).toHaveAttribute(
      "href",
      "/api/auth/login",
    );
    expect(screen.getByText(/could not be completed/i)).toBeInTheDocument();
  });

  it("shows no error region when there is no error", async () => {
    await renderPage();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("404s in every other auth mode", async () => {
    getConfigMock.mockReturnValue({ auth: { mode: "proxy-header", proxyHeader: {} }, app: { name: "P" } });
    await expect(renderPage()).rejects.toThrow("NEXT_NOT_FOUND");
  });
});
