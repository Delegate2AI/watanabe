import { describe, expect, it } from "vitest";
import { materializationKey } from "./materialize-key";

describe("materializationKey and pinOf", () => {
  it("produces different keys for authored sources with different revisions", () => {
    const baseInput = {
      clearance: ["eng"],
      registryPath: "/path/to/skills.yaml",
      registryMtimeMs: 1000,
      registrySize: 512,
      storeDir: "/skills-store",
    };

    const key1 = materializationKey({
      ...baseInput,
      visible: [
        {
          slug: "demo",
          source: { type: "authored", author: "alice@example.com", rev: "abc123" },
        },
      ],
    });

    const key2 = materializationKey({
      ...baseInput,
      visible: [
        {
          slug: "demo",
          source: { type: "authored", author: "alice@example.com", rev: "def456" },
        },
      ],
    });

    expect(key1).not.toEqual(key2);
  });

  it("produces the same key for authored sources with the same revision", () => {
    const baseInput = {
      clearance: ["eng"],
      registryPath: "/path/to/skills.yaml",
      registryMtimeMs: 1000,
      registrySize: 512,
      storeDir: "/skills-store",
    };

    const key1 = materializationKey({
      ...baseInput,
      visible: [
        {
          slug: "demo",
          source: { type: "authored", author: "alice@example.com", rev: "abc123" },
        },
      ],
    });

    const key2 = materializationKey({
      ...baseInput,
      visible: [
        {
          slug: "demo",
          source: { type: "authored", author: "alice@example.com", rev: "abc123" },
        },
      ],
    });

    expect(key1).toEqual(key2);
  });
});
