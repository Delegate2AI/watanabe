import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { migrate } from "./migrate";

/**
 * Embedded thread-ownership store: a single process-wide SQLite connection.
 *
 * Engine choice: `better-sqlite3` over Node's built-in `node:sqlite`. Both
 * work in this repo (verified `node:sqlite` loads fine on Node 22.13.1 with
 * no native build, just an ExperimentalWarning), but `better-sqlite3`
 * installed cleanly here via a prebuilt binary (no compile step, no friction)
 * and is the far more battle-tested option with a stable synchronous API,
 * worth the one extra dependency. `node:sqlite` remains the documented
 * fallback if the prebuilt binary ever fails to install in some target
 * environment (e.g. an unsupported platform/arch for the deploy image).
 *
 * Replaces `lib/agent/session-registry.ts`'s flat JSON file: that file had no
 * owner field and no efficient "list threads for user X" query (full
 * read-modify-write of one shared file on every turn). This is now the ONE
 * source of truth for "which threads exist and who owns them."
 *
 * The ordered schema migrations live in `./migrations` (see `migrate`).
 */

/**
 * Where the DB file lives. Configurable via `PORTAL_DB_PATH`; defaults to
 * `./.data/portal.db` under the process cwd for local dev (same `.data` root
 * the old session registry used, already gitignored). A later infra task
 * points this at a persistent volume path in the real deployment: this
 * function just resolves whatever path it's given.
 */
export function dbPath(): string {
  const configured = process.env.PORTAL_DB_PATH?.trim();
  return configured && configured.length > 0
    ? path.resolve(configured)
    : path.resolve(process.cwd(), ".data", "portal.db");
}

/** Open (and migrate) a database at `file`. Exported for tests (pass `:memory:`). */
export function openDb(file: string): Database.Database {
  if (file !== ":memory:") fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma("journal_mode = WAL");
  // Retry a momentarily-locked write for up to 5s instead of throwing
  // SQLITE_BUSY immediately. Without this, a transient lock surfaces as an
  // exception into a swallowed catch upstream and silently orphans a session.
  // Env-overridable; 5000ms is a sane default for this low-contention store.
  const busyTimeoutMs = Number(process.env.PORTAL_DB_BUSY_TIMEOUT_MS) || 5000;
  db.pragma(`busy_timeout = ${busyTimeoutMs}`);
  // NORMAL is the documented safe+fast pairing with WAL: durable across an app
  // crash, with a loss window only on an OS/power crash, acceptable for this
  // data. Set explicitly (not left to the implicit default) so the durability
  // posture is deliberate and visible.
  db.pragma("synchronous = NORMAL");
  migrate(db);
  return db;
}

// Pinned to globalThis for the same reason as the old session registry's
// in-memory map (see lib/agent/session.ts): Next.js can bundle route handlers
// separately, and dev HMR would otherwise reopen the file repeatedly.
const g = globalThis as unknown as { __portalDb?: Database.Database };

/** The process-wide connection, opened (and migrated) lazily on first use. */
export function getDb(): Database.Database {
  return (g.__portalDb ??= openDb(dbPath()));
}
