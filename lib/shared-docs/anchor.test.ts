import { describe, it, expect } from "vitest";
import { createAnchor, resolveAnchor, locateInSource } from "./anchor";

const TEXT = "The quick brown fox jumps over the lazy dog.";

describe("createAnchor", () => {
  it("captures the quote plus bounded context", () => {
    const start = TEXT.indexOf("brown fox");
    const a = createAnchor(TEXT, start, start + "brown fox".length);
    expect(a.quote).toBe("brown fox");
    expect(a.prefix.endsWith("The quick ")).toBe(true);
    expect(a.suffix.startsWith(" jumps")).toBe(true);
    expect(a.start).toBe(start);
  });
});

describe("resolveAnchor", () => {
  it("relocates an unchanged quote", () => {
    const start = TEXT.indexOf("lazy");
    const a = createAnchor(TEXT, start, start + 4);
    expect(resolveAnchor(TEXT, a)).toEqual({ start, end: start + 4 });
  });

  it("relocates after edits earlier in the doc shift the offset", () => {
    const start = TEXT.indexOf("lazy");
    const a = createAnchor(TEXT, start, start + 4);
    const shifted = "PREAMBLE. " + TEXT;
    const s2 = shifted.indexOf("lazy");
    expect(resolveAnchor(shifted, a)).toEqual({ start: s2, end: s2 + 4 });
  });

  it("disambiguates identical quotes by context and nearest offset", () => {
    const text = "cat here and cat there";
    const first = createAnchor(text, 0, 3); // the leading "cat"
    const second = createAnchor(text, text.lastIndexOf("cat"), text.lastIndexOf("cat") + 3);
    expect(resolveAnchor(text, first)).toEqual({ start: 0, end: 3 });
    expect(resolveAnchor(text, second)).toEqual({
      start: text.lastIndexOf("cat"),
      end: text.lastIndexOf("cat") + 3,
    });
  });

  it("returns null for an orphaned quote", () => {
    const a = createAnchor(TEXT, 4, 9); // "quick"
    expect(resolveAnchor("totally different text", a)).toBeNull();
  });

  it("never throws on empty inputs", () => {
    expect(resolveAnchor("", { quote: "x", prefix: "", suffix: "", start: 0 })).toBeNull();
  });

  it("keeps a correct contextual match even when it is 1100+ chars from the recorded start", () => {
    // A context-free "target" sits right where `start` points, and a
    // correct, context-matching "target" (preceded by "A", per the anchor's
    // prefix) sits far away. Context must dominate regardless of distance.
    const filler = "x".repeat(1100);
    const text = "target " + filler + "Atarget";
    const a = { quote: "target", prefix: "A", suffix: "", start: 1 };
    const expectedStart = text.lastIndexOf("target");
    expect(resolveAnchor(text, a)).toEqual({ start: expectedStart, end: expectedStart + 6 });
  });
});

describe("locateInSource", () => {
  it("locates a unique quote in the source", () => {
    const src = "# Title\n\nThe quick brown fox.";
    const a = { quote: "quick brown", prefix: "The ", suffix: " fox", start: 0 };
    const at = locateInSource(src, a);
    expect(src.slice(at!.start, at!.end)).toBe("quick brown");
  });

  it("disambiguates repeated quotes by source context", () => {
    const src = "cat in the hat. later a cat sat.";
    const a = { quote: "cat", prefix: "later a ", suffix: " sat", start: 24 };
    const at = locateInSource(src, a);
    expect(at!.start).toBe(src.lastIndexOf("cat"));
  });

  it("returns null when the quote is absent", () => {
    expect(locateInSource("nothing here", { quote: "zebra", prefix: "", suffix: "", start: 0 })).toBeNull();
  });

  it("returns null when repeated and context cannot disambiguate", () => {
    const src = "zaaz zaaz";
    // both "aa" occurrences carry identical single-char context -> tie -> null (fail-safe)
    expect(locateInSource(src, { quote: "aa", prefix: "z", suffix: "z", start: 1 })).toBeNull();
  });
});
