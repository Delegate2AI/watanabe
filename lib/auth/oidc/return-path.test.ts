import { describe, it, expect } from "vitest";
import { safeReturnPath } from "./return-path";

describe("safeReturnPath", () => {
  it("keeps a same-origin path with its query", () => {
    expect(safeReturnPath("/projects/7?tab=docs")).toBe("/projects/7?tab=docs");
  });

  it("defaults to / for absent and empty input", () => {
    expect(safeReturnPath(null)).toBe("/");
    expect(safeReturnPath(undefined)).toBe("/");
    expect(safeReturnPath("")).toBe("/");
  });

  it("refuses anything that could leave this origin", () => {
    expect(safeReturnPath("//evil.example/x")).toBe("/");
    expect(safeReturnPath("https://evil.example/x")).toBe("/");
    expect(safeReturnPath("/\\evil.example")).toBe("/");
    expect(safeReturnPath("javascript:alert(1)")).toBe("/");
    expect(safeReturnPath("relative/path")).toBe("/");
  });

  it("refuses a dot segment that normalizes into a protocol-relative path", () => {
    // These pass a raw "starts with //" check and then collapse to
    // "//evil.example" during URL parsing, which resolves to another origin.
    expect(safeReturnPath("/.//evil.example")).toBe("/");
    expect(safeReturnPath("/..//evil.example")).toBe("/");
    expect(safeReturnPath("/%2e%2e//evil.example")).toBe("/");
  });

  it("defaults to / for input types a caller's declared signature does not rule out", () => {
    // Next's runtime searchParams type is string | string[] | undefined, not
    // the single string this signature declares. A repeated query parameter
    // (`?next=a&next=b`) arrives as an array; this must not reach .startsWith.
    expect(safeReturnPath(["/a", "/b"] as unknown as string)).toBe("/");
    expect(safeReturnPath(42 as unknown as string)).toBe("/");
    expect(safeReturnPath({} as unknown as string)).toBe("/");
  });

  it("refuses an absurdly long path", () => {
    expect(safeReturnPath(`/${"a".repeat(5000)}`)).toBe("/");
  });

  it("drops any fragment", () => {
    expect(safeReturnPath("/docs#section")).toBe("/docs");
  });
});
