import type { Database as DatabaseType } from "better-sqlite3";
import { insertVersion, nextVersion } from "@/lib/documents/version-store";
import { DEFAULT_DOC_FORMAT, type DocFormat } from "@/lib/documents/types";
import {
  fromRow,
  type ArtifactRecord,
  type ArtifactRow,
  type ArtifactStatus,
  type ArtifactVersion,
  type ArtifactVersionOptions,
} from "./artifacts-types";

const ARTIFACT_VERSION_STORE = {
  table: "artifact_versions",
  fkColumn: "artifact_id",
  extraColumns: ["format"],
} as const;

/**
 * `artifacts` + `artifact_versions` table access (spec 27): the store for
 * titled, versioned markdown documents a user captured from chat and can
 * publish to the KB. Mirrors `lib/db/threads.ts`'s shape: DB-instance-agnostic
 * pure functions, directly unit-testable against an in-memory database.
 *
 * Owner-private contract: every read/write is scoped by `owner_email`. A row
 * owned by someone else and an unknown id are indistinguishable to a caller,
 * both surfacing as `null`/`false` here and a 404 at the route (no existence
 * oracle), the same discipline `lib/db/ownership.ts` gives threads.
 */

export type { ArtifactStatus, ArtifactRecord, ArtifactVersion, ArtifactVersionOptions };

/**
 * Create a `draft` artifact and seed its version 1 from `body`, in one
 * transaction so an artifact never exists without a body. `sourceThreadId`
 * links it back to the chat it was promoted from (spec 29), or is null.
 */
export function insertArtifact(
  db: DatabaseType,
  a: {
    id: string;
    title: string;
    ownerEmail: string;
    sourceThreadId?: string | null;
    body: string;
    format?: DocFormat;
  },
  now: string = new Date().toISOString(),
): void {
  db.transaction(() => {
    db.prepare(
      `INSERT INTO artifacts (id, title, owner_email, source_thread_id, status, created_at, updated_at)
       VALUES (@id, @title, @owner, @thread, 'draft', @now, @now)`,
    ).run({ id: a.id, title: a.title, owner: a.ownerEmail, thread: a.sourceThreadId ?? null, now });
    insertVersion(db, ARTIFACT_VERSION_STORE, {
      id: a.id,
      version: 1,
      body: a.body,
      createdAt: now,
      extra: { format: a.format ?? DEFAULT_DOC_FORMAT },
    });
  })();
}

/** The artifact with `id` IF it belongs to `ownerEmail`, else `null` (no oracle). */
export function getArtifactForOwner(db: DatabaseType, id: string, ownerEmail: string): ArtifactRecord | null {
  const row = db
    .prepare(`SELECT * FROM artifacts WHERE id = @id AND owner_email = @owner`)
    .get({ id, owner: ownerEmail }) as ArtifactRow | undefined;
  return row ? fromRow(row) : null;
}

/** All artifacts owned by `ownerEmail`, newest activity first. */
export function listArtifactsForOwner(db: DatabaseType, ownerEmail: string): ArtifactRecord[] {
  const rows = db
    .prepare(`SELECT * FROM artifacts WHERE owner_email = ? ORDER BY updated_at DESC`)
    .all(ownerEmail) as ArtifactRow[];
  return rows.map(fromRow);
}

/**
 * Every version of `id`, oldest first, IF the artifact belongs to `ownerEmail`.
 * Empty for a foreign OR unknown id (identical, no oracle). The owner filter is
 * a join on `artifacts.owner_email`, enforced in the SQL itself so there is no
 * check-then-read seam a caller could skip.
 */
export function getVersions(db: DatabaseType, id: string, ownerEmail: string): ArtifactVersion[] {
  const rows = db
    .prepare(
      `SELECT v.version, v.body, v.format, v.created_at
       FROM artifact_versions v JOIN artifacts a ON a.id = v.artifact_id
       WHERE v.artifact_id = @id AND a.owner_email = @owner
       ORDER BY v.version ASC`,
    )
    .all({ id, owner: ownerEmail }) as Array<{
      version: number;
      body: string;
      format: DocFormat;
      created_at: string;
    }>;
  return rows.map((r) => ({ version: r.version, body: r.body, format: r.format, createdAt: r.created_at }));
}

/**
 * The latest version body IF the artifact belongs to `ownerEmail`, else `null`
 * (a foreign or unknown id are indistinguishable). Owner-scoped in the SQL for
 * the same reason as {@link getVersions}: the publish path reads the body
 * through here, so the ownership check must live in the query, not the caller.
 */
export function latestBody(db: DatabaseType, id: string, ownerEmail: string): string | null {
  return latestVersionOf(db, id, ownerEmail)?.body ?? null;
}

/**
 * The latest version's body AND what that body is, owner-scoped.
 *
 * The publish path needs both: an HTML body written into `docs/*.md` verbatim is
 * model-authored markup landing in the vault as if it were prose, so the caller
 * has to be able to see the format rather than assume markdown.
 */
export function latestVersionOf(
  db: DatabaseType,
  id: string,
  ownerEmail: string,
): { body: string; format: DocFormat } | null {
  const row = db
    .prepare(
      `SELECT v.body, v.format
       FROM artifact_versions v JOIN artifacts a ON a.id = v.artifact_id
       WHERE v.artifact_id = @id AND a.owner_email = @owner
       ORDER BY v.version DESC LIMIT 1`,
    )
    .get({ id, owner: ownerEmail }) as { body: string; format: DocFormat } | undefined;
  return row ? { body: row.body, format: row.format } : null;
}

/**
 * Append a new version (owner-scoped). Returns `false` without writing when the
 * artifact does not exist or is not owned by `ownerEmail`. The new version
 * number is `max(version) + 1`, and `updated_at` is bumped, in one transaction.
 */
export function addVersion(
  db: DatabaseType,
  id: string,
  ownerEmail: string,
  body: string,
  options: ArtifactVersionOptions = {},
): boolean {
  const format = options.format ?? DEFAULT_DOC_FORMAT;
  const now = options.now ?? new Date().toISOString();
  return db.transaction(() => {
    const owns = db
      .prepare(`SELECT 1 FROM artifacts WHERE id = @id AND owner_email = @owner`)
      .get({ id, owner: ownerEmail });
    if (!owns) return false;
    const next = nextVersion(db, ARTIFACT_VERSION_STORE, id);
    insertVersion(db, ARTIFACT_VERSION_STORE, {
      id,
      version: next,
      body,
      createdAt: now,
      extra: { format },
    });
    db.prepare(`UPDATE artifacts SET updated_at = @now WHERE id = @id`).run({ id, now });
    return true;
  })();
}

/**
 * Patch an artifact's mutable metadata (owner-scoped): `title`, `targetPath`,
 * `targetVisibility` (serialized as JSON), and `status`. Only the present
 * fields are written. Returns `false` when the row does not exist or is not
 * owned by `ownerEmail`. Always bumps `updated_at`.
 */
export function updateArtifact(
  db: DatabaseType,
  id: string,
  ownerEmail: string,
  patch: { title?: string; targetPath?: string; targetVisibility?: string[]; status?: ArtifactStatus },
  now: string = new Date().toISOString(),
): boolean {
  const sets: string[] = ["updated_at = @now"];
  const params: Record<string, string> = { id, owner: ownerEmail, now };
  if (patch.title !== undefined) {
    sets.push("title = @title");
    params.title = patch.title;
  }
  if (patch.targetPath !== undefined) {
    sets.push("target_path = @targetPath");
    params.targetPath = patch.targetPath;
  }
  if (patch.targetVisibility !== undefined) {
    sets.push("target_visibility = @targetVisibility");
    params.targetVisibility = JSON.stringify(patch.targetVisibility);
  }
  if (patch.status !== undefined) {
    sets.push("status = @status");
    params.status = patch.status;
  }
  const info = db
    .prepare(`UPDATE artifacts SET ${sets.join(", ")} WHERE id = @id AND owner_email = @owner`)
    .run(params);
  return info.changes > 0;
}

/**
 * Record where the note landed and flip the artifact to its post-submit state
 * (owner-scoped). Returns `false` for an unknown or foreign id.
 *
 * `status` is a parameter rather than a hard-coded `'published'` because the two
 * publish modes end in genuinely different places: a `direct` publish is on
 * `main` and therefore live, while an `mr` publish is only proposed. The note
 * path is recorded either way, since it is where the note WILL live and the MR
 * already targets it.
 */
export function markPublished(
  db: DatabaseType,
  id: string,
  ownerEmail: string,
  publishedNotePath: string,
  status: Extract<ArtifactStatus, "in_review" | "published"> = "published",
  mr: { url: string; iid: number | null } | null = null,
  now: string = new Date().toISOString(),
): boolean {
  const info = db
    .prepare(
      `UPDATE artifacts SET status = @status, published_note_path = @path,
         mr_url = @mrUrl, mr_iid = @mrIid, updated_at = @now
       WHERE id = @id AND owner_email = @owner`,
    )
    .run({
      id,
      owner: ownerEmail,
      path: publishedNotePath,
      status,
      mrUrl: mr?.url ?? null,
      mrIid: mr?.iid ?? null,
      now,
    });
  return info.changes > 0;
}

/**
 * Delete an artifact and all its versions (owner-scoped). Returns `false` for
 * an unknown or foreign id. Versions are removed explicitly rather than relying
 * on a cascade pragma the shared connection does not enable.
 */
export function deleteArtifact(db: DatabaseType, id: string, ownerEmail: string): boolean {
  return db.transaction(() => {
    const info = db.prepare(`DELETE FROM artifacts WHERE id = @id AND owner_email = @owner`).run({
      id,
      owner: ownerEmail,
    });
    if (info.changes === 0) return false;
    db.prepare(`DELETE FROM artifact_versions WHERE artifact_id = ?`).run(id);
    return true;
  })();
}
