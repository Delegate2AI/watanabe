import { describe, it, expect } from "vitest";
import { kbDocHref } from "./doc-path";

describe("kbDocHref", () => {
  it("maps a nested doc path to its extensionless /kb route", () => {
    expect(kbDocHref("00-overview/executive-summary.md")).toBe("/kb/00-overview/executive-summary");
  });

  it("maps a bare filename", () => {
    expect(kbDocHref("INDEX.md")).toBe("/kb/INDEX");
  });

  it("drops a leading docs/ (the vault root is docs/)", () => {
    expect(kbDocHref("docs/00-overview/glossary.md")).toBe("/kb/00-overview/glossary");
  });

  it("drops a leading ./ or /", () => {
    expect(kbDocHref("./notes/x.md")).toBe("/kb/notes/x");
    expect(kbDocHref("/notes/x.md")).toBe("/kb/notes/x");
  });

  it("percent-encodes path segments", () => {
    expect(kbDocHref("01_OUTPUTS/Master Index.md")).toBe(null); // a space means it is prose, not a path
    expect(kbDocHref("a/b c.md")).toBe(null);
    expect(kbDocHref("weird&name.md")).toBe("/kb/weird%26name");
  });

  it("returns null for non-doc-path text", () => {
    expect(kbDocHref("just some prose")).toBe(null);
    expect(kbDocHref("config.yaml")).toBe(null);
    expect(kbDocHref("03-product/")).toBe(null); // a directory ref, not a .md file
    expect(kbDocHref("")).toBe(null);
  });

  it("refuses path traversal", () => {
    expect(kbDocHref("../secret.md")).toBe(null);
  });
});
