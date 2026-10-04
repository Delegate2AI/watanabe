import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Database as DatabaseType } from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openDb } from "@/lib/db/client";
import { setThreadConnector } from "@/lib/db/thread-connectors";
import { invalidateConnectorRegistryCache } from "./registry";
import { resolveConnectorGrants } from "./grants";

describe("resolveConnectorGrants pending slugs", () => {
  let root: string;
  let filePath: string;
  let db: DatabaseType;

  beforeEach(() => {
    root = mkdtempSync(path.join(os.tmpdir(), "conn-pending-"));
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

  function writeRegistry(groups: string) {
    writeFileSync(
      filePath,
      [
        "connectors:",
        "  circleback:",
        "    title: Circleback",
        "    transport: http",
        "    url: https://mcp.circleback.ai/mcp",
        `    groups: [${groups}]`,
        "",
      ].join("\n"),
    );
  }

  it("resolves a pending slug the caller is cleared for without any DB opt-in", () => {
    writeRegistry("all-hands");

    const grants = resolveConnectorGrants(db, "thread-1", ["all-hands"], filePath, ["circleback"]);

    expect(Object.keys(grants.servers)).toEqual(["circleback"]);
    expect(grants.allow.get("circleback")).toBe("all");
  });

  it("resolves a pending slug outside the caller's clearance to nothing", () => {
    writeRegistry("engineering");

    const grants = resolveConnectorGrants(db, "thread-1", ["all-hands"], filePath, ["circleback"]);

    expect(grants.servers).toEqual({});
  });

  it("dedupes a pending slug that is also a DB opt-in", () => {
    writeRegistry("all-hands");
    setThreadConnector(db, "thread-1", "circleback", true);

    const grants = resolveConnectorGrants(db, "thread-1", ["all-hands"], filePath, ["circleback"]);

    expect(Object.keys(grants.servers)).toEqual(["circleback"]);
    expect(grants.allow.size).toBe(1);
  });
});
