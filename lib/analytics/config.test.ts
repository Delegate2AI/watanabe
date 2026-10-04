import { describe, it, expect, afterEach } from "vitest";
import { analyticsIdFor, isAnalyticsEnabled, posthogHost, posthogKey } from "./config";
import { ownerKey } from "@/lib/attachments/store";

const KEY = "phc_testtesttesttesttesttest";
const HOST = "https://ph.example.com";

afterEach(() => {
  delete process.env.ANALYTICS_ENABLED;
  delete process.env.POSTHOG_KEY;
  delete process.env.POSTHOG_HOST;
});

describe("isAnalyticsEnabled", () => {
  it("is off without the flag", () => {
    process.env.POSTHOG_KEY = KEY;
    expect(isAnalyticsEnabled()).toBe(false);
  });

  it("is off with the flag but no project key, rather than posting nowhere", () => {
    process.env.ANALYTICS_ENABLED = "1";
    expect(isAnalyticsEnabled()).toBe(false);
    process.env.POSTHOG_HOST = HOST;
    expect(isAnalyticsEnabled()).toBe(false);
    process.env.POSTHOG_KEY = "   ";
    expect(isAnalyticsEnabled()).toBe(false);
  });

  it("treats a placeholder as no key, so a deploy waiting on one sends nothing", () => {
    process.env.ANALYTICS_ENABLED = "1";
    for (const placeholder of ["PENDING", "TODO", "changeme", "phc_short"]) {
      process.env.POSTHOG_KEY = placeholder;
      expect(posthogKey(), placeholder).toBeNull();
      expect(isAnalyticsEnabled(), placeholder).toBe(false);
    }
  });

  it("is off with the flag and a key but no host", () => {
    process.env.ANALYTICS_ENABLED = "1";
    process.env.POSTHOG_KEY = KEY;
    expect(isAnalyticsEnabled()).toBe(false);
  });

  it("is on with the flag, a key and a host", () => {
    process.env.ANALYTICS_ENABLED = "1";
    process.env.POSTHOG_KEY = KEY;
    process.env.POSTHOG_HOST = HOST;
    expect(isAnalyticsEnabled()).toBe(true);
    expect(posthogKey()).toBe(KEY);
  });
});

describe("posthogHost", () => {
  it("has no default and takes the configured host", () => {
    expect(posthogHost()).toBeNull();
    process.env.POSTHOG_HOST = "  ";
    expect(posthogHost()).toBeNull();
    process.env.POSTHOG_HOST = HOST;
    expect(posthogHost()).toBe(HOST);
  });
});

describe("analyticsIdFor", () => {
  const EMAIL = "alice@example.com";

  it("is stable for one person and different for another", () => {
    expect(analyticsIdFor(EMAIL)).toBe(analyticsIdFor(EMAIL));
    expect(analyticsIdFor(EMAIL)).not.toBe(analyticsIdFor("bob@example.com"));
  });

  it("carries no part of the address", () => {
    const id = analyticsIdFor(EMAIL);
    expect(id).toMatch(/^[0-9a-f]{32}$/);
    expect(id).not.toContain("alice");
    expect(id).not.toContain("example");
  });

  it("never equals the key that addresses the same person's private files", () => {
    expect(analyticsIdFor(EMAIL)).not.toBe(ownerKey(EMAIL));
  });
});
