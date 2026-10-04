import { describe, expect, it } from "vitest";
import { EntrySchema, SourceSchema } from "./types";

describe("authored source type", () => {
  it("parses a registry entry with an authored source (author and rev)", () => {
    const source = {
      type: "authored",
      author: "alice@example.com",
      rev: "abc123",
    };
    const entry = {
      title: "Demo Skill",
      source,
      groups: ["eng"],
    };

    const result = SourceSchema.safeParse(source);
    expect(result.success).toBe(true);
    expect(EntrySchema.safeParse(entry).success).toBe(true);
  });

  it("rejects an authored source with missing rev", () => {
    const source = {
      type: "authored",
      author: "alice@example.com",
    };

    const result = SourceSchema.safeParse(source);
    expect(result.success).toBe(false);
  });

  it("rejects an authored source with empty rev", () => {
    const source = {
      type: "authored",
      author: "alice@example.com",
      rev: "",
    };

    const result = SourceSchema.safeParse(source);
    expect(result.success).toBe(false);
  });

  it("rejects an authored source with invalid email", () => {
    const source = {
      type: "authored",
      author: "notanemail",
      rev: "abc123",
    };

    const result = SourceSchema.safeParse(source);
    expect(result.success).toBe(false);
  });
});
