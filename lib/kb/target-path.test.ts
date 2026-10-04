import { describe, it, expect } from "vitest";
import {
  isCreatableFolder,
  joinTargetPath,
  normalizeFolderInput,
  normalizeNameInput,
  splitTargetPath,
} from "./target-path";

describe("normalizeFolderInput", () => {
  it("strips slashes, backslashes, and the docs/ prefix", () => {
    expect(normalizeFolderInput(" /docs/handbook/ ")).toBe("handbook");
    expect(normalizeFolderInput("a\\b//c")).toBe("a/b/c");
    expect(normalizeFolderInput("")).toBe("");
  });
});

describe("normalizeNameInput", () => {
  it("drops the extension and turns separators into hyphens", () => {
    expect(normalizeNameInput("onboarding.md")).toBe("onboarding");
    expect(normalizeNameInput("a/b")).toBe("a-b");
    expect(normalizeNameInput("  Notes.MD ")).toBe("Notes");
  });
});

describe("splitTargetPath / joinTargetPath", () => {
  it("round-trips a nested target", () => {
    const { folder, name } = splitTargetPath("handbook/hr/onboarding.md");
    expect(folder).toBe("handbook/hr");
    expect(name).toBe("onboarding");
    expect(joinTargetPath(folder, name)).toBe("handbook/hr/onboarding.md");
  });

  it("handles a top-level target", () => {
    expect(splitTargetPath("readme.md")).toEqual({ folder: "", name: "readme" });
    expect(joinTargetPath("", "readme")).toBe("readme.md");
  });

  it("returns an empty target while the name is empty", () => {
    expect(joinTargetPath("handbook", "")).toBe("");
    expect(joinTargetPath("handbook", "   ")).toBe("");
  });
});

describe("isCreatableFolder", () => {
  it("accepts nested folders and refuses traversal or empty segments", () => {
    expect(isCreatableFolder("handbook/new-team")).toBe(true);
    expect(isCreatableFolder("")).toBe(false);
    expect(isCreatableFolder("../escape")).toBe(false);
    expect(isCreatableFolder("a/./b")).toBe(false);
  });
});
