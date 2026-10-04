import { describe, expect, it } from "vitest";
import { readVisibility } from "./visibility";

describe("readVisibility", () => {
  it("defaults missing frontmatter and missing visibility to all-hands", () => {
    expect(readVisibility("# Plain note\nBody")).toEqual(["all-hands"]);
    expect(readVisibility("---\ntitle: Public note\n---\nBody")).toEqual(["all-hands"]);
  });

  it("accepts scalar, inline-list, and block-list visibility", () => {
    expect(readVisibility("---\nvisibility: exec\n---\nBody")).toEqual(["exec"]);
    expect(readVisibility("---\nvisibility: [exec, finance]\n---\nBody")).toEqual(["exec", "finance"]);
    expect(readVisibility("---\nvisibility:\n  - exec\n  - finance\n---\nBody")).toEqual([
      "exec",
      "finance",
    ]);
  });

  it("returns unparseable for malformed frontmatter", () => {
    expect(readVisibility("---\nvisibility: [exec\n---\nBody")).toBe("unparseable");
    expect(readVisibility("---\nvisibility: exec\nBody without closing delimiter")).toBe("unparseable");
  });

  it("returns unparseable for invalid visibility values", () => {
    expect(readVisibility("---\nvisibility: 42\n---\nBody")).toBe("unparseable");
    expect(readVisibility("---\nvisibility: [exec, 42]\n---\nBody")).toBe("unparseable");
  });
});
