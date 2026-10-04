import type { Database as DatabaseType } from "better-sqlite3";

type SqlValue = string | number | bigint | null;

/** SQL identifiers in this config must come from module-level constants. */
export interface VersionStoreConfig<ExtraColumn extends string = never> {
  readonly table: string;
  readonly fkColumn: string;
  readonly extraColumns?: readonly ExtraColumn[];
}

type InsertVersionInput<ExtraColumn extends string> = {
  id: string;
  version: number;
  body: string;
  createdAt: string;
} & ([ExtraColumn] extends [never]
  ? { extra?: never }
  : { extra: Record<ExtraColumn, SqlValue> });

export function nextVersion(
  db: DatabaseType,
  store: VersionStoreConfig<string>,
  id: string,
): number {
  const row = db
    .prepare(`SELECT MAX(version) AS version FROM ${store.table} WHERE ${store.fkColumn} = @id`)
    .get({ id }) as { version: number | null };
  return (row.version ?? 0) + 1;
}

export function insertVersion<ExtraColumn extends string>(
  db: DatabaseType,
  store: VersionStoreConfig<ExtraColumn>,
  input: InsertVersionInput<ExtraColumn>,
): void {
  const extraColumns = store.extraColumns ?? [];
  const columns = [store.fkColumn, "version", "body", ...extraColumns, "created_at"];
  const extraBindings = extraColumns.map((_, index) => `@extra${index}`);
  const bindings = ["@id", "@version", "@body", ...extraBindings, "@createdAt"];
  const params: Record<string, SqlValue> = {
    id: input.id,
    version: input.version,
    body: input.body,
    createdAt: input.createdAt,
  };

  const extra = (input.extra ?? {}) as Record<ExtraColumn, SqlValue>;
  extraColumns.forEach((column, index) => {
    params[`extra${index}`] = extra[column];
  });

  db.prepare(`INSERT INTO ${store.table} (${columns.join(", ")}) VALUES (${bindings.join(", ")})`).run(params);
}

export function listVersions<Row>(
  db: DatabaseType,
  store: VersionStoreConfig<string>,
  id: string,
  columns: readonly string[],
): Row[] {
  return db
    .prepare(
      `SELECT ${columns.join(", ")} FROM ${store.table}
       WHERE ${store.fkColumn} = @id ORDER BY version ASC`,
    )
    .all({ id }) as Row[];
}
