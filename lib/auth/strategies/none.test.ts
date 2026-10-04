import { describe, it, expect } from "vitest";
import { resolve } from "./none";

describe("none strategy", () => {
  it("returns the configured identity", () => {
    expect(resolve({ email: "dev@example.com", name: "Dev" })).toEqual({
      email: "dev@example.com",
      name: "Dev",
    });
  });

  it("omits name when unset rather than emitting undefined", () => {
    expect(resolve({ email: "dev@example.com" })).toEqual({ email: "dev@example.com" });
  });

  // No headers are read, so nothing a caller sends can change who they are.
  // The boot guard (PORTAL_ALLOW_NO_AUTH) is what keeps this off in prod; see
  // lib/config/load.test.ts.
  it("ignores request headers entirely", () => {
    expect(resolve({ email: "fixed@example.com" }).email).toBe("fixed@example.com");
  });
});
