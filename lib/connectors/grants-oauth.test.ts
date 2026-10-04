import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Database as DatabaseType } from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openDb } from "@/lib/db/client";
import { setThreadConnector } from "@/lib/db/thread-connectors";
import { invalidateConnectorRegistryCache } from "./registry";
import { resolveConnectorGrants } from "./grants";

describe("resolveConnectorGrants oauth entries", () => {
  let root: string;
  let filePath: string;
  let db: DatabaseType;

  beforeEach(() => {
    root = mkdtempSync(path.join(os.tmpdir(), "conn-oauth-"));
    filePath = path.join(root, "connectors.yaml");
    db = openDb(":memory:");
    invalidateConnectorRegistryCache();
    vi.stubEnv("CONNECTORS_ENABLED", "1");
    vi.stubEnv("CONNECTOR_OAUTH_ENABLED", "1");
  });

  afterEach(() => {
    invalidateConnectorRegistryCache();
    rmSync(root, { recursive: true, force: true });
    vi.unstubAllEnvs();
  });

  function writeRegistry(): void {
    writeFileSync(
      filePath,
      [
        "connectors:",
        "  linear:",
        "    title: Linear",
        "    transport: http",
        "    url: https://linear.example/mcp",
        "    groups: [eng]",
        "    auth: oauth",
        "",
      ].join("\n"),
    );
  }

  it("merges the bearer token as an Authorization header for a connected oauth entry", () => {
    writeRegistry();
    setThreadConnector(db, "thread-1", "linear", true);
    const oauthBearer = new Map([["linear", { token: "tok-abc", url: "https://linear.example/mcp" }]]);

    const grants = resolveConnectorGrants(db, "thread-1", ["eng"], filePath, undefined, oauthBearer);

    expect(grants.servers.linear).toEqual({
      type: "http",
      url: "https://linear.example/mcp",
      headers: { Authorization: "Bearer tok-abc" },
    });
    expect(grants.notices).toEqual([]);
  });

  it("skips an oauth entry whose bearer was resolved against a different url than the current registry entry", () => {
    writeRegistry();
    setThreadConnector(db, "thread-1", "linear", true);
    const oauthBearer = new Map([["linear", { token: "tok-abc", url: "https://old.example.com/mcp" }]]);

    const grants = resolveConnectorGrants(db, "thread-1", ["eng"], filePath, undefined, oauthBearer);

    expect(grants.servers).toEqual({});
    expect(grants.notices).toEqual(["connector linear disabled: reconnect required"]);
  });

  it("skips an oauth entry with no bearer and leaves a connect-first notice", () => {
    writeRegistry();
    setThreadConnector(db, "thread-1", "linear", true);

    const grants = resolveConnectorGrants(db, "thread-1", ["eng"], filePath, undefined, new Map());

    expect(grants.servers).toEqual({});
    expect(grants.notices).toEqual(["connector linear disabled: connect first"]);
  });

  it("skips an oauth entry with no bearer map at all, same as an empty one", () => {
    writeRegistry();
    setThreadConnector(db, "thread-1", "linear", true);

    const grants = resolveConnectorGrants(db, "thread-1", ["eng"], filePath);

    expect(grants.servers).toEqual({});
    expect(grants.notices).toEqual(["connector linear disabled: connect first"]);
  });

  it("skips every oauth entry with no notice when CONNECTOR_OAUTH_ENABLED is off", () => {
    vi.stubEnv("CONNECTOR_OAUTH_ENABLED", "0");
    writeRegistry();
    setThreadConnector(db, "thread-1", "linear", true);
    const oauthBearer = new Map([["linear", { token: "tok-abc", url: "https://linear.example/mcp" }]]);

    const grants = resolveConnectorGrants(db, "thread-1", ["eng"], filePath, undefined, oauthBearer);

    expect(grants.servers).toEqual({});
    expect(grants.notices).toEqual([]);
  });

  it("never injects a header into a non-oauth entry, with or without a bearer map", () => {
    writeFileSync(
      filePath,
      [
        "connectors:",
        "  circleback:",
        "    title: Circleback",
        "    transport: http",
        "    url: https://mcp.circleback.ai/mcp",
        "    groups: [eng]",
        "",
      ].join("\n"),
    );
    setThreadConnector(db, "thread-1", "circleback", true);

    const withoutMap = resolveConnectorGrants(db, "thread-1", ["eng"], filePath);
    const withMap = resolveConnectorGrants(
      db,
      "thread-1",
      ["eng"],
      filePath,
      undefined,
      new Map([["circleback", { token: "tok-abc", url: "https://mcp.circleback.ai/mcp" }]]),
    );

    expect(withoutMap.servers).toEqual(withMap.servers);
    expect(withoutMap.servers.circleback).toEqual({
      type: "http",
      url: "https://mcp.circleback.ai/mcp",
      headers: undefined,
    });
  });
});
