import { describe, expect, it } from "vitest";
import { slugifySkillName } from "./slugify";
import { slugifySkillName as fromValidate } from "./validate";

/**
 * The slug function moved out of `validate.ts` so the PreToolUse gate can use it
 * without pulling `fs` and `yaml` onto every tool call. These tests exist to
 * hold that move honest: `validate.ts` must keep exporting the SAME function,
 * because the gate compares against slugs `validate.ts` produced at install
 * time, and two copies that drift would silently split that namespace.
 *
 * The behavior itself is covered by validate.test.ts and is not restated here.
 */

describe("slugifySkillName is one function, exported from both modules", () => {
  it("is the identical reference, not a copy", () => {
    expect(fromValidate).toBe(slugifySkillName);
  });

  it("still folds a human-authored name to its slug", () => {
    expect(slugifySkillName("Brand Guidelines")).toBe("brand-guidelines");
  });

  it("carries no imports at all, so the gate stays cheap", async () => {
    // The reason for the split: this module is imported on the PreToolUse path,
    // and validate.ts pulls node:fs, yaml, and the scanner. Matches real import
    // and require statements, not the prose in the doc comment.
    const { readFileSync } = await import("node:fs");
    const source = readFileSync(new URL("./slugify.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/^\s*import\s/m);
    expect(source).not.toMatch(/\brequire\(/);
  });
});
