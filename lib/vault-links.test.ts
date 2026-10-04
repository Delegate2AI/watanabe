import { describe, it, expect } from "vitest";
import { resolveVaultLink } from "./vault-links";

// The "working internal links" requirement for the native KB view: a
// markdown link authored the way Obsidian writes it (relative to the current
// file) must resolve to this app's route for that page.

describe("resolveVaultLink", () => {
  it("leaves undefined/empty href alone", () => {
    expect(resolveVaultLink(undefined, [])).toBeUndefined();
    expect(resolveVaultLink("", [])).toBe("");
  });

  it("leaves same-page anchors alone", () => {
    expect(resolveVaultLink("#some-heading", ["00-overview"])).toBe("#some-heading");
  });

  it("leaves absolute URLs and mailto/tel links alone", () => {
    expect(resolveVaultLink("https://example.com/x", [])).toBe("https://example.com/x");
    expect(resolveVaultLink("mailto:a@b.com", [])).toBe("mailto:a@b.com");
    expect(resolveVaultLink("tel:+15551234567", [])).toBe("tel:+15551234567");
    expect(resolveVaultLink("//example.com/x", [])).toBe("//example.com/x");
  });

  it("leaves relative links to non-.md targets alone (images, canvases, etc.)", () => {
    expect(resolveVaultLink("../assets/diagram.png", ["01-strategy"])).toBe("../assets/diagram.png");
    expect(resolveVaultLink("Untitled.canvas", [])).toBe("Untitled.canvas");
  });

  it("resolves a same-directory .md link", () => {
    expect(resolveVaultLink("glossary.md", ["00-overview"])).toBe("/00-overview/glossary");
  });

  it("resolves a sibling-directory .md link via ../", () => {
    expect(resolveVaultLink("../02-market-and-research/dsr2-findings.md", ["00-overview"])).toBe(
      "/02-market-and-research/dsr2-findings",
    );
  });

  it("resolves a .md link into a subdirectory", () => {
    expect(resolveVaultLink("03-product/element-catalog.md", [])).toBe("/03-product/element-catalog");
  });

  it("preserves a #heading fragment on a resolved .md link", () => {
    expect(resolveVaultLink("../04-economy/tokenomics.md#lock-memo", ["00-overview"])).toBe(
      "/04-economy/tokenomics#lock-memo",
    );
  });

  it("resolves a vault-root-relative link (leading slash) from the vault root, ignoring currentDirSlug", () => {
    expect(resolveVaultLink("/03-product/element-catalog.md", ["07-governance-decisions"])).toBe(
      "/03-product/element-catalog",
    );
  });

  it("decodes then re-encodes the path segment (round-trips a %20-encoded space)", () => {
    expect(resolveVaultLink("some%20doc.md", ["00-overview"])).toBe("/00-overview/some%20doc");
  });

  it("does not let ../ walk above the vault root — clamps at []", () => {
    expect(resolveVaultLink("../../../etc/passwd.md", ["00-overview"])).toBe("/etc/passwd");
  });
});
