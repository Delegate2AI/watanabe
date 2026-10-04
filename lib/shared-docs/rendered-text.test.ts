// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { plainTextOf, rangeFromOffsets } from "./rendered-text";

function mount(html: string): HTMLElement {
  const el = document.createElement("article");
  el.innerHTML = html;
  document.body.appendChild(el);
  return el;
}

describe("plainTextOf", () => {
  it("concatenates text across elements", () => {
    const el = mount("<p>Hello <strong>bold</strong> world</p>");
    expect(plainTextOf(el)).toBe("Hello bold world");
  });
});

describe("rangeFromOffsets", () => {
  it("builds a range spanning across child text nodes", () => {
    const el = mount("<p>Hello <strong>bold</strong> world</p>");
    const text = plainTextOf(el); // "Hello bold world"
    const start = text.indexOf("bold");
    const range = rangeFromOffsets(el, start, start + 4);
    expect(range).not.toBeNull();
    expect(range!.toString()).toBe("bold");
  });

  it("returns null for out-of-range offsets", () => {
    const el = mount("<p>short</p>");
    expect(rangeFromOffsets(el, 100, 105)).toBeNull();
  });
});
