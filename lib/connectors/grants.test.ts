import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Database as DatabaseType } from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openDb } from "@/lib/db/client";
import { setThreadConnector } from "@/lib/db/thread-connectors";
import { invalidateConnectorRegistryCache } from "./registry";
import { EMPTY_GRANTS, resolveConnectorGrants } from "./grants";

describe("resolveConnectorGrants", () => {
  let root: string;
  let filePath: string;
  let db: DatabaseType;

  beforeEach(() => {
    root = mkdtempSync(path.join(os.tmpdir(), "conn-grants-"));
    filePath = path.join(root, "connectors.yaml");
    db = openDb(":memory:");
    invalidateConnectorRegistryCache();
    vi.stubEnv("CONNECTORS_ENABLED", "1");
  });

  afterEach(() => {
    invalidateConnectorRegistryCache();
    rmSync(root, { recursive: true, force: true });
    vi.unstubAllEnvs();
  });

  function writeRegistry(yaml: string) {
    writeFileSync(filePath, yaml);
  }

  it("EMPTY_GRANTS is deep-frozen (notices cannot be mutated at runtime)", () => {
    expect(Object.isFrozen(EMPTY_GRANTS.notices)).toBe(true);
  });

  it("returns EMPTY_GRANTS identity when the flag is off", () => {
    vi.stubEnv("CONNECTORS_ENABLED", "0");
    writeRegistry(
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
    setThreadConnector(db, "thread-1", "circleback", true);

    const grants = resolveConnectorGrants(db, "thread-1", ["all-hands"], filePath);

    expect(grants).toBe(EMPTY_GRANTS);
  });

  it("maps an opted-in, cleared http entry with interpolated headers", () => {
    writeRegistry(
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
    setThreadConnector(db, "thread-1", "circleback", true);
    vi.stubEnv("CIRCLEBACK_TOKEN", "real-value");

    const grants = resolveConnectorGrants(db, "thread-1", ["all-hands"], filePath);

    expect(grants.servers.circleback).toEqual({
      type: "http",
      url: "https://mcp.circleback.ai/mcp",
      headers: { Authorization: "Bearer real-value" },
    });
    expect(grants.notices).toEqual([]);
  });

  it("excludes an opted-in entry whose clearance is disjoint from groups", () => {
    writeRegistry(
      [
        "connectors:",
        "  circleback:",
        "    title: Circleback",
        "    transport: http",
        "    url: https://mcp.circleback.ai/mcp",
        "    groups: [engineering]",
        "",
      ].join("\n"),
    );
    setThreadConnector(db, "thread-1", "circleback", true);

    const grants = resolveConnectorGrants(db, "thread-1", ["all-hands"], filePath);

    expect(grants.servers).toEqual({});
  });

  it("excludes a cleared entry that was never opted in", () => {
    writeRegistry(
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

    const grants = resolveConnectorGrants(db, "thread-1", ["all-hands"], filePath);

    expect(grants.servers).toEqual({});
  });

  it("sends an opted-in entry with an unset ${VAR} to notices, never throws, and skips the entry", () => {
    writeRegistry(
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
    setThreadConnector(db, "thread-1", "circleback", true);

    let grants: ReturnType<typeof resolveConnectorGrants> | undefined;
    expect(() => {
      grants = resolveConnectorGrants(db, "thread-1", ["all-hands"], filePath);
    }).not.toThrow();

    expect(grants!.servers).toEqual({});
    expect(grants!.notices).toHaveLength(1);
    expect(grants!.notices[0]).toMatch(/^connector circleback disabled: /);
  });

  it("maps a stdio entry to command/args/env", () => {
    writeRegistry(
      [
        "connectors:",
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
    setThreadConnector(db, "thread-1", "gitlab-internal", true);
    vi.stubEnv("PORTAL_BOT_TOKEN", "shh");

    const grants = resolveConnectorGrants(db, "thread-1", ["engineering"], filePath);

    expect(grants.servers["gitlab-internal"]).toEqual({
      command: "npx",
      args: ["-y", "@example/gitlab-mcp"],
      env: { GITLAB_TOKEN: "shh" },
    });
  });

  it("maps a tools allowlist to a Set, and absent tools to \"all\"", () => {
    writeRegistry(
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
        "    groups: [all-hands]",
        "",
      ].join("\n"),
    );
    setThreadConnector(db, "thread-1", "circleback", true);
    setThreadConnector(db, "thread-1", "gitlab-internal", true);

    const grants = resolveConnectorGrants(db, "thread-1", ["all-hands"], filePath);

    expect(grants.allow.get("circleback")).toEqual(new Set(["SearchMeetings", "GetTranscriptsForMeetings"]));
    expect(grants.allow.get("gitlab-internal")).toBe("all");
  });

  it("degrades to no grants when the opt-in query throws, instead of failing session build", () => {
    // The module documents a never-throws contract, but the one database call
    // was outside the only try/catch: a SQLITE_BUSY, a SQLITE_CORRUPT, or a
    // partially-migrated `thread_connectors` threw out of the AgentSession
    // constructor and failed the whole agent POST rather than the chat simply
    // proceeding with no connectors.
    writeRegistry(
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
    const broken = {
      prepare: () => {
        throw new Error("SQLITE_BUSY: database is locked");
      },
    } as unknown as DatabaseType;

    const grants = resolveConnectorGrants(broken, "thread-1", ["all-hands"], filePath);

    expect(grants).toBe(EMPTY_GRANTS);
    expect(grants.servers).toEqual({});
  });

  it("silently ignores a stale opt-in slug that is not in the registry", () => {
    writeRegistry(
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
    setThreadConnector(db, "thread-1", "retired-connector", true);

    const grants = resolveConnectorGrants(db, "thread-1", ["all-hands"], filePath);

    expect(grants.servers).toEqual({});
    expect(grants.notices).toEqual([]);
  });
});
