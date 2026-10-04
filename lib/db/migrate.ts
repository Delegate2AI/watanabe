import type Database from "better-sqlite3";
import { log } from "@/lib/log";
import { MIGRATIONS } from "./migrations";

/**
 * Bring `db` up to the latest schema version. Runs each pending migration in a
 * transaction and stamps `user_version` after it. A failed migration is fatal:
 * we log it clearly and rethrow so startup fails loudly (a half-migrated DB is
 * worse than a hard failure, and swallowing it would only orphan data later).
 */
export function migrate(db: Database.Database): void {
  const from = db.pragma("user_version", { simple: true }) as number;
  const target = MIGRATIONS.length;
  for (let version = from; version < target; version++) {
    const to = version + 1;
    try {
      // `db.transaction(fn)()` runs fn atomically; the user_version stamp is
      // inside the same transaction so a step is all-or-nothing.
      db.transaction(() => {
        MIGRATIONS[version](db);
        db.pragma(`user_version = ${to}`);
      })();
    } catch (err) {
      log.error("db migration failed", { from: version, to, err: String(err) });
      throw err;
    }
  }
}
