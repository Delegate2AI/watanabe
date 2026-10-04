// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import {
  SEED_PENDING,
  decideSeed,
  markSeedPending,
  readSeedMarker,
  recordSeedSession,
  seedDecisionFor,
} from "./seed-guard";

const HANDLE = "7ac2184b-1a15-438f-a086-65ed568473df";
const SDK_ID = "a77170cf-dd4b-436d-b561-2197c833c392";

describe("decideSeed", () => {
  it("sends on the first render of a freshly minted handle", () => {
    expect(decideSeed(HANDLE, `/chat/${HANDLE}`, null)).toEqual({ action: "send" });
  });

  it("resumes the adopted thread when the address bar already carries a different id", () => {
    // The exact shape of the bug: history restored the seeded page (whose route
    // id is still the client handle) into an entry whose URL was swapped to the
    // real SDK id. Re-sending here is what minted a duplicate thread.
    expect(decideSeed(HANDLE, `/chat/${SDK_ID}`, null)).toEqual({
      action: "resume",
      sessionId: SDK_ID,
    });
  });

  it("resumes from the recorded marker even when the URL still reads as the handle", () => {
    expect(decideSeed(HANDLE, `/chat/${HANDLE}`, SDK_ID)).toEqual({
      action: "resume",
      sessionId: SDK_ID,
    });
  });

  it("skips a second send while the first turn has not reported its session yet", () => {
    // Navigating away and back before the `session` event arrives leaves the URL
    // on the handle, so only the marker can tell us the seed already fired.
    expect(decideSeed(HANDLE, `/chat/${HANDLE}`, SEED_PENDING)).toEqual({ action: "skip" });
  });

  it("tolerates a trailing slash and a locale-style prefix in the pathname", () => {
    expect(decideSeed(HANDLE, `/chat/${HANDLE}/`, null)).toEqual({ action: "send" });
    expect(decideSeed(HANDLE, `/chat/${SDK_ID}/`, null)).toEqual({
      action: "resume",
      sessionId: SDK_ID,
    });
  });

  it("sends when the pathname carries no id at all", () => {
    expect(decideSeed(HANDLE, "/", null)).toEqual({ action: "send" });
  });
});

describe("marker storage", () => {
  beforeEach(() => {
    globalThis.sessionStorage?.clear();
  });

  it("round-trips pending then the adopted session id", () => {
    expect(readSeedMarker(HANDLE)).toBeNull();
    markSeedPending(HANDLE);
    expect(readSeedMarker(HANDLE)).toBe(SEED_PENDING);
    recordSeedSession(HANDLE, SDK_ID);
    expect(readSeedMarker(HANDLE)).toBe(SDK_ID);
  });

  it("drives seedDecisionFor across the full lifecycle", () => {
    expect(seedDecisionFor(HANDLE, `/chat/${HANDLE}`)).toEqual({ action: "send" });
    markSeedPending(HANDLE);
    expect(seedDecisionFor(HANDLE, `/chat/${HANDLE}`)).toEqual({ action: "skip" });
    recordSeedSession(HANDLE, SDK_ID);
    expect(seedDecisionFor(HANDLE, `/chat/${HANDLE}`)).toEqual({
      action: "resume",
      sessionId: SDK_ID,
    });
  });

  it("degrades to sending when storage throws, rather than losing the first message", () => {
    const broken = {
      getItem() {
        throw new Error("denied");
      },
      setItem() {
        throw new Error("denied");
      },
    };
    const original = globalThis.sessionStorage;
    Object.defineProperty(globalThis, "sessionStorage", { value: broken, configurable: true });
    try {
      expect(readSeedMarker(HANDLE)).toBeNull();
      expect(() => markSeedPending(HANDLE)).not.toThrow();
      expect(() => recordSeedSession(HANDLE, SDK_ID)).not.toThrow();
      expect(seedDecisionFor(HANDLE, `/chat/${HANDLE}`)).toEqual({ action: "send" });
    } finally {
      Object.defineProperty(globalThis, "sessionStorage", {
        value: original,
        configurable: true,
      });
    }
  });
});
