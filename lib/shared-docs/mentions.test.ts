import { describe, it, expect } from "vitest";
import { extractMentions, mentionSegments } from "./mentions";

const KNOWN = ["alice@example.com", "bob@example.com"];

describe("extractMentions", () => {
  it("returns known emails referenced by @email", () => {
    expect(extractMentions("hey @alice@example.com look", KNOWN)).toEqual(["alice@example.com"]);
  });
  it("ignores unknown or malformed mentions", () => {
    expect(extractMentions("@nobody@example.com and plain text", KNOWN)).toEqual([]);
  });
  it("dedupes", () => {
    expect(extractMentions("@bob@example.com @bob@example.com", KNOWN)).toEqual(["bob@example.com"]);
  });
});

describe("mentionSegments", () => {
  it("splits into text and mention runs", () => {
    const segs = mentionSegments("hi @bob@example.com!");
    expect(segs).toEqual([
      { text: "hi ", mention: false },
      { text: "@bob@example.com", mention: true },
      { text: "!", mention: false },
    ]);
  });
});
