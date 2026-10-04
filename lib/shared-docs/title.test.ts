import { describe, it, expect } from "vitest";
import { MAX_TITLE, boundTitle, deriveTitle, firstLineTitle } from "./title";

describe("boundTitle", () => {
  it("trims, and cuts to the bound without leaving a trailing space", () => {
    expect(boundTitle("  spaced  ")).toBe("spaced");
    const long = boundTitle(`${"a".repeat(MAX_TITLE - 1)} tail`);
    expect(long.length).toBeLessThanOrEqual(MAX_TITLE);
    expect(long).not.toMatch(/\s$/);
  });
});

describe("firstLineTitle", () => {
  it("takes the first non-empty line without its heading markers", () => {
    expect(firstLineTitle("\n\n### Launch plan\nbody")).toBe("Launch plan");
    expect(firstLineTitle("plain first line\nsecond")).toBe("plain first line");
  });

  it("is empty when there is no usable line", () => {
    expect(firstLineTitle("   \n\n")).toBe("");
  });
});

describe("deriveTitle", () => {
  it("prefers an explicit title, then the body, then the fallback", () => {
    expect(deriveTitle("Explicit", "# Body")).toBe("Explicit");
    expect(deriveTitle(undefined, "# Body")).toBe("Body");
    expect(deriveTitle("  ", "  ")).toBe("Untitled document");
    expect(deriveTitle(undefined, "", "notes")).toBe("notes");
  });
});
