import { describe, expect, it } from "vitest";
import { vaultDocHref } from "./web-links";

describe("vaultDocHref", () => {
  it("maps a vault-relative .md path to the /kb slug route, dropping the extension", () => {
    expect(vaultDocHref("04-economy/tokenomics.md")).toBe("/kb/04-economy/tokenomics");
  });
  it("handles a root-level doc", () => {
    expect(vaultDocHref("README.md")).toBe("/kb/README");
  });
  it("percent-encodes segments with spaces or reserved characters", () => {
    expect(vaultDocHref("trader score/how it works.md")).toBe("/kb/trader%20score/how%20it%20works");
  });
  it("is tolerant of a path that does not end in .md", () => {
    expect(vaultDocHref("notes/raw")).toBe("/kb/notes/raw");
  });
});
