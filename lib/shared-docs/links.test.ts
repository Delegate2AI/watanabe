import { describe, it, expect } from "vitest";
import {
  newLinkToken,
  computeExpiry,
  asLinkAccess,
  DEFAULT_LINK_TTL_HOURS,
  MAX_LINK_TTL_HOURS,
} from "./links";
import { rateLimit, resetRateLimits } from "./rate-limit";

describe("newLinkToken", () => {
  it("is a strong, unguessable, non-sequential token", () => {
    const a = newLinkToken();
    const b = newLinkToken();
    expect(a).not.toBe(b);
    // UUID v4 shape (36 chars, hex + dashes): CSPRNG, not a sequential id.
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});

describe("computeExpiry", () => {
  const now = new Date("2026-07-11T00:00:00.000Z");

  it("defaults to the default TTL from now", () => {
    const iso = computeExpiry(now);
    const expected = new Date(now.getTime() + DEFAULT_LINK_TTL_HOURS * 3600_000).toISOString();
    expect(iso).toBe(expected);
  });

  it("honors an explicit TTL", () => {
    const iso = computeExpiry(now, 2);
    expect(iso).toBe(new Date(now.getTime() + 2 * 3600_000).toISOString());
  });

  it("clamps a TTL beyond the maximum so no link is effectively permanent", () => {
    const iso = computeExpiry(now, 10 * 365 * 24);
    expect(iso).toBe(new Date(now.getTime() + MAX_LINK_TTL_HOURS * 3600_000).toISOString());
  });

  it("always returns a future expiry (never never-expiring)", () => {
    expect(new Date(computeExpiry(now, 0)).getTime()).toBeGreaterThan(now.getTime());
  });
});

describe("asLinkAccess", () => {
  it("accepts view and comment only, never edit", () => {
    expect(asLinkAccess("view")).toBe("view");
    expect(asLinkAccess("comment")).toBe("comment");
    expect(asLinkAccess("edit")).toBeNull();
    expect(asLinkAccess("owner")).toBeNull();
    expect(asLinkAccess(undefined)).toBeNull();
  });
});

describe("rateLimit", () => {
  it("allows up to the limit, then refuses within the window", () => {
    resetRateLimits();
    const t0 = 1_000_000;
    expect(rateLimit("docs-link", "k", 3, 1000, t0)).toBe(true);
    expect(rateLimit("docs-link", "k", 3, 1000, t0 + 1)).toBe(true);
    expect(rateLimit("docs-link", "k", 3, 1000, t0 + 2)).toBe(true);
    expect(rateLimit("docs-link", "k", 3, 1000, t0 + 3)).toBe(false);
  });

  it("rolls the window over after it elapses", () => {
    resetRateLimits();
    const t0 = 2_000_000;
    expect(rateLimit("docs-link", "k2", 1, 1000, t0)).toBe(true);
    expect(rateLimit("docs-link", "k2", 1, 1000, t0 + 500)).toBe(false);
    expect(rateLimit("docs-link", "k2", 1, 1000, t0 + 1000)).toBe(true);
  });

  it("keys are independent", () => {
    resetRateLimits();
    const t0 = 3_000_000;
    expect(rateLimit("docs-link", "a", 1, 1000, t0)).toBe(true);
    expect(rateLimit("docs-link", "b", 1, 1000, t0)).toBe(true);
    expect(rateLimit("docs-link", "a", 1, 1000, t0)).toBe(false);
  });
});
