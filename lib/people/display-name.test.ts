import { describe, expect, it } from "vitest";
import { looksLikeOpaqueId } from "./display-name";

describe("looksLikeOpaqueId", () => {
  it.each([
    ["ybbiiflb2gtz"],
    ["108423901234567890"],
    ["3f2504e0-4f89-11d3-9a0c-0305e82c3301"],
    ["user1234"],
    [""],
    ["   "],
  ])("rejects %s", (value) => {
    expect(looksLikeOpaqueId(value)).toBe(true);
  });

  it.each([
    ["Taylor Reed"],
    ["Fern"],
    ["Madonna"],
    ["j.smith"],
    ["Sam 2"],
    ["Jean-Luc"],
    ["O'Brien"],
    ["taylor"],
  ])("keeps %s", (value) => {
    expect(looksLikeOpaqueId(value)).toBe(false);
  });

  it("rejects the address itself, which is what the directory exists to replace", () => {
    expect(looksLikeOpaqueId("Taylor@Example.com", "taylor@example.com")).toBe(true);
    expect(looksLikeOpaqueId("taylor@example.com")).toBe(true);
  });
});
