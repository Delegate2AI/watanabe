import { describe, it, expect } from "vitest";
import { titleCaseTerm } from "./terms";

describe("titleCaseTerm", () => {
  it("title-cases the long term for headings and tool results", () => {
    expect(titleCaseTerm({ short: "MR", long: "merge request" })).toBe("Merge Request");
    expect(titleCaseTerm({ short: "PR", long: "pull request" })).toBe("Pull Request");
  });
});
