import { afterEach, describe, expect, it, vi } from "vitest";
import { FLAG_NAMES, FLAG_REGISTRY } from "@/lib/config/flag-registry";

const isFlagEnabledMock = vi.fn<(name: string) => boolean>();
vi.mock("@/lib/config/flags", () => ({ isFlagEnabled: (n: string) => isFlagEnabledMock(n) }));

const { isKbReviewEnabled, isKbDeleteEnabled } = await import("./config");

afterEach(() => isFlagEnabledMock.mockReset());

describe("review flags", () => {
  it("reads its own registry flag", () => {
    isFlagEnabledMock.mockImplementation((n) => n === "KB_REVIEW_ENABLED");
    expect(isKbReviewEnabled()).toBe(true);
    expect(isKbDeleteEnabled()).toBe(false);
  });

  it("gates delete on the KB write path being on", () => {
    isFlagEnabledMock.mockImplementation((n) => n === "KB_DELETE_ENABLED");
    expect(isKbDeleteEnabled()).toBe(false);
    isFlagEnabledMock.mockImplementation((n) => n === "KB_DELETE_ENABLED" || n === "KB_WRITE_ENABLED");
    expect(isKbDeleteEnabled()).toBe(true);
  });

  it("is off when everything is off", () => {
    isFlagEnabledMock.mockReturnValue(false);
    expect(isKbReviewEnabled()).toBe(false);
    expect(isKbDeleteEnabled()).toBe(false);
  });
});

describe("registry entries", () => {
  it("registers the review queue as a live flag with no dependency", () => {
    const descriptor = FLAG_REGISTRY.find((f) => f.envVar === "KB_REVIEW_ENABLED");
    expect(descriptor).toBeDefined();
    expect(descriptor?.effect).toBe("live");
    expect(descriptor?.dependsOn).toBeUndefined();
    expect(FLAG_NAMES.has("KB_REVIEW_ENABLED")).toBe(true);
  });

  it("registers delete as a live flag depending on the write path", () => {
    const descriptor = FLAG_REGISTRY.find((f) => f.envVar === "KB_DELETE_ENABLED");
    expect(descriptor).toBeDefined();
    expect(descriptor?.effect).toBe("live");
    expect(descriptor?.dependsOn).toBe("KB_WRITE_ENABLED");
    expect(FLAG_NAMES.has("KB_DELETE_ENABLED")).toBe(true);
  });
});
