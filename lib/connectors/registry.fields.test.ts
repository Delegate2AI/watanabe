import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  invalidateConnectorRegistryCache,
  loadConnectorRegistry,
} from "./registry";

describe("loadConnectorRegistry schema fields", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(path.join(os.tmpdir(), "conn-"));
    invalidateConnectorRegistryCache();
  });

  afterEach(() => {
    invalidateConnectorRegistryCache();
    rmSync(root, { recursive: true, force: true });
  });

  it("parses description and icon fields", () => {
    const filePath = path.join(root, "connectors.yaml");
    writeFileSync(
      filePath,
      [
        "connectors:",
        "  circleback:",
        "    title: Circleback",
        "    transport: http",
        "    url: https://mcp.circleback.ai/mcp",
        "    groups: [all-hands]",
        "    description: Meeting transcripts",
        "    icon: chart",
        "  gitlab-internal:",
        "    title: GitLab",
        "    transport: stdio",
        "    command: npx",
        "    groups: [engineering]",
        "",
      ].join("\n"),
    );

    const registry = loadConnectorRegistry(filePath);

    expect(registry.errors).toEqual([]);
    expect(registry.entries).toHaveLength(2);
    const circleback = registry.entries.find((e) => e.slug === "circleback");
    expect(circleback?.description).toBe("Meeting transcripts");
    expect(circleback?.icon).toBe("chart");
    const gitlab = registry.entries.find((e) => e.slug === "gitlab-internal");
    expect(gitlab?.description).toBeUndefined();
    expect(gitlab?.icon).toBeUndefined();
  });

  it("rejects invalid icon and oversized description", () => {
    const filePath = path.join(root, "connectors.yaml");
    const longDesc = "a".repeat(281);
    writeFileSync(
      filePath,
      [
        "connectors:",
        "  bad-icon:",
        "    title: Bad",
        "    transport: http",
        "    url: https://example.com",
        "    groups: [all-hands]",
        "    icon: not-real",
        "  bad-desc:",
        "    title: Bad Desc",
        "    transport: http",
        "    url: https://example.com",
        "    groups: [all-hands]",
        `    description: ${longDesc}`,
        "",
      ].join("\n"),
    );

    const registry = loadConnectorRegistry(filePath);

    expect(registry.entries).toEqual([]);
    expect(registry.errors).toHaveLength(2);
    const badIcon = registry.errors.find((e) => e.slug === "bad-icon");
    const badDesc = registry.errors.find((e) => e.slug === "bad-desc");
    expect(badIcon?.reason).toContain("Invalid option");
    expect(badDesc?.reason).toContain("Too big");
  });
});
