import { describe, it, expect, beforeEach } from "vitest";
import { rateLimit, resetRateLimits, clientKey, bucketCount, MAX_RATE_LIMIT_BUCKETS } from "./rate-limit";

beforeEach(() => resetRateLimits());

describe("rateLimit", () => {
  it("allows up to the limit then refuses inside the window", () => {
    expect(rateLimit("ns", "k", 2, 1000, 0)).toBe(true);
    expect(rateLimit("ns", "k", 2, 1000, 1)).toBe(true);
    expect(rateLimit("ns", "k", 2, 1000, 2)).toBe(false);
  });

  it("rolls over when the window elapses", () => {
    expect(rateLimit("ns", "k", 1, 1000, 0)).toBe(true);
    expect(rateLimit("ns", "k", 1, 1000, 500)).toBe(false);
    expect(rateLimit("ns", "k", 1, 1000, 1000)).toBe(true);
  });

  it("keys are independent within a namespace", () => {
    expect(rateLimit("ns", "a", 1, 1000, 0)).toBe(true);
    expect(rateLimit("ns", "b", 1, 1000, 0)).toBe(true);
  });
});

describe("clientKey", () => {
  it("takes the first forwarded entry", () => {
    expect(clientKey(new Headers({ "x-forwarded-for": "1.2.3.4, 10.0.0.1" }))).toBe("1.2.3.4");
  });

  it("falls back to a shared bucket", () => {
    expect(clientKey(new Headers())).toBe("unknown");
    expect(clientKey(new Headers({ "x-forwarded-for": "  " }))).toBe("unknown");
  });
});

describe("namespaces", () => {
  it("the same key in two different namespaces gets independent budgets", () => {
    expect(rateLimit("a", "shared-key", 1, 1000, 0)).toBe(true);
    // Namespace "a" is now exhausted for "shared-key", but namespace "b" has
    // never seen it: it gets its own fresh allowance.
    expect(rateLimit("a", "shared-key", 1, 1000, 0)).toBe(false);
    expect(rateLimit("b", "shared-key", 1, 1000, 0)).toBe(true);
  });

  it("exhausting one namespace's cap does not evict another namespace's active bucket", () => {
    // Fill namespace "victim" with one long-lived bucket that must survive.
    expect(rateLimit("victim", "important-caller", 1, 1_000_000, 0)).toBe(true);
    // Refused a second hit in the same window: the allowance is exhausted.
    expect(rateLimit("victim", "important-caller", 1, 1_000_000, 1)).toBe(false);

    // Now drive a completely different namespace to its own cap and beyond,
    // the exact eviction pressure that used to be shared across every caller
    // of rateLimit before each surface got its own map.
    for (let i = 0; i < MAX_RATE_LIMIT_BUCKETS + 1; i += 1) {
      rateLimit("attacker", `key-${i}`, 1, 1_000_000, 0);
    }
    expect(bucketCount("attacker")).toBe(MAX_RATE_LIMIT_BUCKETS);

    // The victim namespace's bucket was never touched by that eviction, so
    // its allowance is still exhausted, not renewed.
    expect(rateLimit("victim", "important-caller", 1, 1_000_000, 2)).toBe(false);
    expect(bucketCount("victim")).toBe(1);
  });

  it("resetRateLimits clears every namespace", () => {
    rateLimit("a", "k", 1, 1000, 0);
    rateLimit("b", "k", 1, 1000, 0);
    resetRateLimits();
    expect(bucketCount("a")).toBe(0);
    expect(bucketCount("b")).toBe(0);
  });
});

describe("bucket eviction and cap, per namespace", () => {
  it("does not grow past one entry per distinct key under ordinary use", () => {
    rateLimit("ns", "a", 5, 1000, 0);
    rateLimit("ns", "b", 5, 1000, 0);
    rateLimit("ns", "a", 5, 1000, 1);
    expect(bucketCount("ns")).toBe(2);
  });

  it("evicts expired windows before falling back to FIFO once the cap is hit", () => {
    // Fill to the cap with windows that will all have expired by t=1000.
    for (let i = 0; i < MAX_RATE_LIMIT_BUCKETS; i += 1) {
      rateLimit("ns", `short-${i}`, 1, 500, 0);
    }
    expect(bucketCount("ns")).toBe(MAX_RATE_LIMIT_BUCKETS);

    // Every one of those windows is expired by now. A new key reclaims the
    // space by eviction rather than pushing the map past its cap.
    rateLimit("ns", "new-key", 1, 500, 1000);
    expect(bucketCount("ns")).toBe(1);
  });

  it("caps the map at its maximum, evicting the oldest surviving bucket first", () => {
    for (let i = 0; i < MAX_RATE_LIMIT_BUCKETS; i += 1) {
      // Long windows: nothing here expires during the test, so the cap is
      // the only thing standing between this loop and unbounded growth.
      rateLimit("ns", `long-${i}`, 1, 1_000_000, 0);
    }
    expect(bucketCount("ns")).toBe(MAX_RATE_LIMIT_BUCKETS);

    rateLimit("ns", "overflow", 1, 1_000_000, 0);
    expect(bucketCount("ns")).toBe(MAX_RATE_LIMIT_BUCKETS);

    // long-0 was the oldest surviving bucket and should have been evicted to
    // make room, so it starts a fresh window rather than being refused.
    expect(rateLimit("ns", "long-0", 1, 1_000_000, 1)).toBe(true);
  });

  it("each namespace has its own independent cap", () => {
    for (let i = 0; i < MAX_RATE_LIMIT_BUCKETS; i += 1) {
      rateLimit("ns-a", `k-${i}`, 1, 1_000_000, 0);
    }
    expect(bucketCount("ns-a")).toBe(MAX_RATE_LIMIT_BUCKETS);
    // A different namespace starts from zero, unaffected by ns-a's fill.
    expect(bucketCount("ns-b")).toBe(0);
    expect(rateLimit("ns-b", "k-0", 1, 1_000_000, 0)).toBe(true);
    expect(bucketCount("ns-b")).toBe(1);
  });
});
