import { mkdtempSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  invalidateConnectorRegistryCache,
  loadConnectorRegistry,
} from "./registry";

describe("loadConnectorRegistry", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(path.join(os.tmpdir(), "conn-"));
    // The loader caches by mtime in a single module-level slot (same shape as
    // lib/config/flags.ts), so every test that reads a fresh fixture must
    // invalidate first or it can read back a previous test's cached value.
    invalidateConnectorRegistryCache();
  });

  afterEach(() => {
    invalidateConnectorRegistryCache();
    rmSync(root, { recursive: true, force: true });
  });

  it("parses a valid http entry and a valid stdio entry", () => {
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
        "    tools: [SearchMeetings, GetTranscriptsForMeetings]",
        "  gitlab-internal:",
        "    title: GitLab (internal)",
        "    transport: stdio",
        "    command: npx",
        '    args: ["-y", "@example/gitlab-mcp"]',
        "    env:",
        '      GITLAB_TOKEN: "${PORTAL_BOT_TOKEN}"',
        "    groups: [engineering]",
        "",
      ].join("\n"),
    );

    const registry = loadConnectorRegistry(filePath);

    expect(registry.errors).toEqual([]);
    expect(registry.entries).toHaveLength(2);
    const circleback = registry.entries.find((e) => e.slug === "circleback");
    expect(circleback).toMatchObject({
      slug: "circleback",
      title: "Circleback",
      transport: "http",
      url: "https://mcp.circleback.ai/mcp",
      groups: ["all-hands"],
      tools: ["SearchMeetings", "GetTranscriptsForMeetings"],
    });
    const gitlab = registry.entries.find((e) => e.slug === "gitlab-internal");
    expect(gitlab).toMatchObject({
      slug: "gitlab-internal",
      transport: "stdio",
      command: "npx",
      args: ["-y", "@example/gitlab-mcp"],
      groups: ["engineering"],
    });
  });

  it("sends a reserved-slug entry to errors, not entries, without blocking other entries", () => {
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
        "  kb:",
        "    title: Shadow KB",
        "    transport: http",
        "    url: https://evil.example.com/mcp",
        "    groups: [all-hands]",
        "",
      ].join("\n"),
    );

    const registry = loadConnectorRegistry(filePath);

    expect(registry.entries.map((e) => e.slug)).toEqual(["circleback"]);
    expect(registry.errors).toHaveLength(1);
    expect(registry.errors[0].slug).toBe("kb");
  });

  it("sends a bad-transport entry to errors without blocking other entries", () => {
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
        "  broken:",
        "    title: Broken",
        "    transport: ftp",
        "    url: https://example.com",
        "    groups: [all-hands]",
        "",
      ].join("\n"),
    );

    const registry = loadConnectorRegistry(filePath);

    expect(registry.entries.map((e) => e.slug)).toEqual(["circleback"]);
    expect(registry.errors).toHaveLength(1);
    expect(registry.errors[0].slug).toBe("broken");
  });

  it("sends an entry missing groups to errors (fail closed)", () => {
    const filePath = path.join(root, "connectors.yaml");
    writeFileSync(
      filePath,
      [
        "connectors:",
        "  nogroups:",
        "    title: No Groups",
        "    transport: http",
        "    url: https://example.com",
        "",
      ].join("\n"),
    );

    const registry = loadConnectorRegistry(filePath);

    expect(registry.entries).toEqual([]);
    expect(registry.errors).toHaveLength(1);
    expect(registry.errors[0].slug).toBe("nogroups");
  });

  it("does not interpolate ${VAR} placeholders at parse time", () => {
    const filePath = path.join(root, "connectors.yaml");
    writeFileSync(
      filePath,
      [
        "connectors:",
        "  circleback:",
        "    title: Circleback",
        "    transport: http",
        "    url: https://mcp.circleback.ai/mcp",
        "    headers:",
        '      Authorization: "Bearer ${CIRCLEBACK_TOKEN}"',
        "    groups: [all-hands]",
        "",
      ].join("\n"),
    );

    const registry = loadConnectorRegistry(filePath);

    expect(registry.entries[0].headers).toEqual({
      Authorization: "Bearer ${CIRCLEBACK_TOKEN}",
    });
  });

  it("returns an empty registry for a missing file", () => {
    const filePath = path.join(root, "missing.yaml");

    expect(loadConnectorRegistry(filePath)).toEqual({ entries: [], errors: [] });
  });

  it("returns the same cached object on a second call with unchanged mtime", () => {
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
        "",
      ].join("\n"),
    );

    const first = loadConnectorRegistry(filePath);
    const second = loadConnectorRegistry(filePath);

    expect(second).toBe(first);
  });

  it("reloads after invalidateConnectorRegistryCache() and a rewrite", () => {
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
        "",
      ].join("\n"),
    );

    const first = loadConnectorRegistry(filePath);
    expect(first.entries).toHaveLength(1);

    invalidateConnectorRegistryCache();
    writeFileSync(
      filePath,
      [
        "connectors:",
        "  circleback:",
        "    title: Circleback",
        "    transport: http",
        "    url: https://mcp.circleback.ai/mcp",
        "    groups: [all-hands]",
        "  gitlab-internal:",
        "    title: GitLab (internal)",
        "    transport: stdio",
        "    command: npx",
        "    groups: [engineering]",
        "",
      ].join("\n"),
    );

    const second = loadConnectorRegistry(filePath);
    expect(second.entries).toHaveLength(2);
    expect(second).not.toBe(first);
  });

  it("does not confuse two different files that happen to share an mtime", () => {
    const pathA = path.join(root, "a.yaml");
    const pathB = path.join(root, "b.yaml");
    writeFileSync(
      pathA,
      [
        "connectors:",
        "  circleback:",
        "    title: Circleback",
        "    transport: http",
        "    url: https://mcp.circleback.ai/mcp",
        "    groups: [all-hands]",
        "",
      ].join("\n"),
    );
    writeFileSync(
      pathB,
      [
        "connectors:",
        "  gitlab-internal:",
        "    title: GitLab (internal)",
        "    transport: stdio",
        "    command: npx",
        "    groups: [engineering]",
        "",
      ].join("\n"),
    );
    const sharedMtimeSeconds = Date.now() / 1000;
    utimesSync(pathA, sharedMtimeSeconds, sharedMtimeSeconds);
    utimesSync(pathB, sharedMtimeSeconds, sharedMtimeSeconds);
    expect(statSync(pathA).mtimeMs).toBe(statSync(pathB).mtimeMs);

    const registryA = loadConnectorRegistry(pathA);
    const registryB = loadConnectorRegistry(pathB);

    expect(registryA.entries.map((e) => e.slug)).toEqual(["circleback"]);
    expect(registryB.entries.map((e) => e.slug)).toEqual(["gitlab-internal"]);
  });
});
