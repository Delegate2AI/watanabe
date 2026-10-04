import { describe, it, expect } from "vitest";
import { contentTypeForAsset } from "./content-type";

describe("contentTypeForAsset", () => {
  it("maps common image extensions", () => {
    expect(contentTypeForAsset("assets/charts/diagram.png")).toBe("image/png");
    expect(contentTypeForAsset("a/b/photo.JPG")).toBe("image/jpeg");
    expect(contentTypeForAsset("logo.svg")).toBe("image/svg+xml");
    expect(contentTypeForAsset("x.webp")).toBe("image/webp");
  });

  it("maps documents and media", () => {
    expect(contentTypeForAsset("report.pdf")).toBe("application/pdf");
    expect(contentTypeForAsset("clip.mp4")).toBe("video/mp4");
  });

  it("is case-insensitive on the extension", () => {
    expect(contentTypeForAsset("DIAGRAM.PNG")).toBe("image/png");
  });

  it("falls back to octet-stream for unknown or missing extensions", () => {
    expect(contentTypeForAsset("assets/data.bin")).toBe("application/octet-stream");
    expect(contentTypeForAsset("assets/README")).toBe("application/octet-stream");
  });
});
