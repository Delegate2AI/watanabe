import type { Database as DatabaseType } from "better-sqlite3";
import { setThreadConnector } from "@/lib/db/thread-connectors";
import { log } from "@/lib/log";
import { isConnectorsEnabled } from "./config";
import { loadConnectorRegistry } from "./registry";

export function refusePendingConnectors(
  slugs: readonly string[],
  resuming: boolean,
  clearanceSet: readonly string[],
): string | null {
  if (!isConnectorsEnabled()) return "connectors disabled";
  if (resuming) return "connectors on a resume";
  const clearance = new Set(clearanceSet);
  const cleared = new Set(
    loadConnectorRegistry()
      .entries.filter((entry) => entry.groups.some((group) => clearance.has(group)))
      .map((entry) => entry.slug),
  );
  for (const slug of slugs) {
    if (!cleared.has(slug)) return "connector slug not available";
  }
  return null;
}

export function makePendingPersister(
  db: DatabaseType,
  slugs: readonly string[] | undefined,
): (threadId: string) => void {
  let pending = slugs;
  return (threadId) => {
    if (!pending || pending.length === 0) return;
    const toWrite = pending;
    pending = undefined;
    for (const slug of toWrite) {
      try {
        setThreadConnector(db, threadId, slug, true);
      } catch (error) {
        log.warn("pending connector persist failed", { threadId, slug, err: String(error) });
      }
    }
  };
}
