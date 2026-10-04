import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { canonicalEmail, loadAliasIndex } from "./aliases";

function fileWith(content: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), "aliases-"));
  const filePath = path.join(dir, "aliases.yaml");
  writeFileSync(filePath, content, "utf8");
  return filePath;
}

describe("loadAliasIndex", () => {
  it("maps each alias to its canonical email, normalized", () => {
    const index = loadAliasIndex(fileWith([
      "aliases:",
      "  alice@example.com:",
      "    - Alice.Personal@Gmail.test",
      "  bob@example.com:",
      "    - bob@vendor.test",
    ].join("\n")));
    expect(index).toEqual({
      "alice.personal@gmail.test": "alice@example.com",
      "bob@vendor.test": "bob@example.com",
    });
  });

  it("returns an empty index for a missing or malformed file", () => {
    expect(loadAliasIndex("/nonexistent/aliases.yaml")).toEqual({});
    expect(loadAliasIndex(fileWith("aliases: [not, a, map]"))).toEqual({});
  });

  it("drops an alias that is not an email without losing the rest", () => {
    const index = loadAliasIndex(fileWith([
      "aliases:",
      "  alice@example.com:",
      "    - not-an-email",
      "    - alice.personal@gmail.test",
    ].join("\n")));
    expect(index).toEqual({ "alice.personal@gmail.test": "alice@example.com" });
  });

  it("never lets an alias shadow an address that is itself canonical", () => {
    const index = loadAliasIndex(fileWith([
      "aliases:",
      "  alice@example.com:",
      "    - carol@example.com",
      "  carol@example.com:",
      "    - carol.personal@gmail.test",
    ].join("\n")));
    expect(index["carol@example.com"]).toBeUndefined();
    expect(index["carol.personal@gmail.test"]).toBe("carol@example.com");
  });
});

describe("canonicalEmail", () => {
  const index = { "alice.personal@gmail.test": "alice@example.com" };

  it("resolves an alias case-insensitively", () => {
    expect(canonicalEmail(" Alice.Personal@Gmail.test ", index)).toBe("alice@example.com");
  });

  it("passes through a non-alias unchanged apart from normalization", () => {
    expect(canonicalEmail("Alice@Example.com", index)).toBe("alice@example.com");
  });
});
