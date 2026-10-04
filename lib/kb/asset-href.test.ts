import { describe, it, expect } from "vitest";
import { kbAssetHref } from "./asset-href";

describe("kbAssetHref", () => {
  it("builds the byte-serving URL for a vault-relative path", () => {
    expect(kbAssetHref("assets/charts/x.png")).toBe("/api/kb/asset/assets/charts/x.png");
  });

  it("encodes segments with spaces", () => {
    expect(kbAssetHref("assets/my chart.png")).toBe("/api/kb/asset/assets/my%20chart.png");
  });

  it("drops empty segments", () => {
    expect(kbAssetHref("assets//charts/x.png")).toBe("/api/kb/asset/assets/charts/x.png");
  });
});
