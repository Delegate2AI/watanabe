import type Database from "better-sqlite3";
import { MIGRATIONS_HISTORY_1 } from "./migrations-history-1";
import { MIGRATIONS_HISTORY_2 } from "./migrations-history-2";
import { MIGRATIONS_HISTORY_3 } from "./migrations-history-3";
import { MIGRATIONS_HISTORY_4 } from "./migrations-history-4";
import { MIGRATIONS_HISTORY_5 } from "./migrations-history-5";
import { MIGRATIONS_HISTORY_6 } from "./migrations-history-6";

/**
 * Ordered schema migrations, indexed by target `user_version` (index 0 migrates
 * a version-0 DB up to version 1, index 1 → version 2, and so on). Each function
 * runs the DDL for exactly one version step and is executed inside a transaction
 * by {@link migrate}, which stamps `PRAGMA user_version` after each step.
 *
 * Why this replaces the old bare `CREATE TABLE IF NOT EXISTS` block: with only
 * `IF NOT EXISTS`, a future migration that needs to `ALTER TABLE ... ADD COLUMN`
 * has no way to run (the guard sees the table already exists and does nothing,
 * so the new column silently never appears). Keying migrations off
 * `user_version` gives us a real, ordered, forward-only evolution path.
 *
 * IMPORTANT: v0->v1 must stay idempotent against already-deployed databases.
 * Databases created before this mechanism existed have `user_version = 0` (the
 * SQLite default, never set) but ALREADY contain the `threads` table + index
 * (created by the old `IF NOT EXISTS` schema). The v1 migration therefore
 * KEEPS the `IF NOT EXISTS` guards: run against such a legacy DB it is a no-op
 * that simply stamps `user_version = 1`; run against a fresh DB it creates the
 * schema. Both paths converge on the identical schema that exists today: this is
 * purely the mechanism, with no change to the shape of the data.
 *
 * The frozen v0->v1 through v23->v24 steps live in `migrations-history-1.ts`,
 * `migrations-history-2.ts`, and `migrations-history-3.ts` (split purely to keep
 * each file under the file-size limit as new migrations land). New migrations
 * are appended here, at the end of the assembled `MIGRATIONS` array below.
 */

// Re-exported from its frozen home (the v16 migration's helper) so the import
// path callers have always used keeps working.
export { backfillFlatComments } from "./migrations-history-3";

export const MIGRATIONS: Array<(db: Database.Database) => void> = [
  ...MIGRATIONS_HISTORY_1,
  ...MIGRATIONS_HISTORY_2,
  ...MIGRATIONS_HISTORY_3,
  ...MIGRATIONS_HISTORY_4,
  ...MIGRATIONS_HISTORY_5,
  ...MIGRATIONS_HISTORY_6,
];
// The migration RUNNER lives in ./migrate (migrate()), split out to keep this
// file focused on the ordered MIGRATIONS data as the array grows.
