import type { Database as DatabaseType } from "better-sqlite3";
import type { McpServerConfig } from "@anthropic-ai/claude-agent-sdk";
import { interpolate } from "@/lib/config/interpolate";
import { listThreadConnectors } from "@/lib/db/thread-connectors";
import { log } from "@/lib/log";
import { isConnectorOauthEnabled, isConnectorsEnabled } from "./config";
import { loadConnectorRegistry } from "./registry";
import type { ConnectorEntry, OauthBearer } from "./types";

/**
 * Per-thread, per-caller resolution of external MCP connectors (spec 33):
 * the registry entries a thread has opted into AND whose `groups` intersect
 * the caller's clearance, ready to merge into a session's `mcpServers`.
 *
 * Never-throws contract, like `lib/memory/mem-tools.ts` and
 * `lib/connectors/registry.ts`: a bad `${VAR}` reference disables just that
 * one connector (a `notices` entry) rather than failing session build, and a
 * database that cannot answer at all degrades to no grants rather than throwing
 * out of the `AgentSession` constructor and failing the whole chat POST.
 */
export type ConnectorGrants = {
  servers: Record<string, McpServerConfig>;
  allow: ReadonlyMap<string, ReadonlySet<string> | "all">;
  notices: string[];
};

/**
 * Flag-off / nothing-opted-in shape. Deep-frozen so accidental mutation throws
 * loudly in dev: the notices array and the allow Map object are frozen too
 * (freezing a Map cannot block `.set` at runtime, so `allow` additionally
 * stays behind the ReadonlyMap type; the freeze is belt-and-suspenders).
 */
export const EMPTY_GRANTS: ConnectorGrants = Object.freeze({
  servers: Object.freeze({}),
  allow: Object.freeze(new Map<string, ReadonlySet<string> | "all">()),
  notices: Object.freeze([]) as unknown as string[],
});

/**
 * `filePath` is test-only (mirrors `loadConnectorRegistry`'s own signature);
 * production always calls this with no third argument.
 */
export function resolveConnectorGrants(
  db: DatabaseType,
  threadId: string,
  clearanceSet: string[],
  filePath?: string,
  pendingSlugs?: readonly string[],
  oauthBearer?: ReadonlyMap<string, OauthBearer>,
): ConnectorGrants {
  if (!isConnectorsEnabled()) return EMPTY_GRANTS;

  const registry = loadConnectorRegistry(filePath);
  // The one call here that touches a database. SQLITE_BUSY, SQLITE_CORRUPT, or a
  // partially-migrated `thread_connectors` must not fail session construction:
  // the honest degradation is "this thread has no connectors this turn", which
  // is the same shape as nothing being opted in.
  let optedIn: ReadonlySet<string>;
  try {
    optedIn = new Set(listThreadConnectors(db, threadId));
  } catch (error) {
    log.warn("connector opt-in lookup failed", { threadId, err: describe(error) });
    return EMPTY_GRANTS;
  }
  const enabled = new Set([...optedIn, ...(pendingSlugs ?? [])]);
  const clearance = new Set(clearanceSet);

  const servers: Record<string, McpServerConfig> = {};
  const allow = new Map<string, ReadonlySet<string> | "all">();
  const notices: string[] = [];

  for (const entry of registry.entries) {
    // A slug enabled on the thread but retired from the registry since (or
    // never present) simply never matches an entry here: silently ignored,
    // no notice, per spec's "rows referencing missing slugs are ignored".
    if (!enabled.has(entry.slug)) continue;
    if (!entry.groups.some((group) => clearance.has(group))) continue;

    let bearer: string | undefined;
    if (entry.auth === "oauth") {
      if (!isConnectorOauthEnabled()) continue;
      const resolved = oauthBearer?.get(entry.slug);
      if (!resolved) {
        notices.push(`connector ${entry.slug} disabled: connect first`);
        continue;
      }
      if (resolved.url !== entry.url) {
        notices.push(`connector ${entry.slug} disabled: reconnect required`);
        continue;
      }
      bearer = resolved.token;
    }

    let interpolated: ConnectorEntry;
    try {
      interpolated = interpolate(entry);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      notices.push(`connector ${entry.slug} disabled: ${message}`);
      continue;
    }

    // Every field comes off the INTERPOLATED copy, so nothing computed here is
    // discarded. `EntrySchema` refuses `${` in url, command, and args (see
    // lib/connectors/types.ts), so those three are identical to the raw entry by
    // construction; reading them from one object is what keeps a future field
    // from being added to the raw side and silently shipping a placeholder.
    if (interpolated.transport === "stdio") {
      servers[entry.slug] = {
        command: interpolated.command!,
        args: interpolated.args ?? [],
        env: interpolated.env,
      };
    } else {
      servers[entry.slug] = {
        type: interpolated.transport,
        url: interpolated.url!,
        headers: bearer ? { ...interpolated.headers, Authorization: `Bearer ${bearer}` } : interpolated.headers,
      };
    }
    allow.set(entry.slug, interpolated.tools ? new Set(interpolated.tools) : "all");
  }

  return { servers, allow, notices };
}

function describe(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return text.replace(/\s+/g, " ").trim();
}
