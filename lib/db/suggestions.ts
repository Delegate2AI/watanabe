import type { Database as DatabaseType } from "better-sqlite3";
import type { Suggestion, SuggestionStatus, TextAnchor } from "@/lib/shared-docs/types";

/**
 * `doc_suggestions` table access (proposed edits, spec 2026-07-22). A
 * suggestion carries the anchor plus the exact original/proposed text so an
 * accept can splice into the current body without re-deriving the diff. This
 * module only stores and reads rows; locating the anchor in the live source
 * and applying the splice is the caller's job (`lib/shared-docs/anchor.ts`'s
 * `locateInSource` plus the route layer).
 */

interface Row {
  id: string;
  doc_id: string;
  base_version: number;
  anchor_json: string;
  original_text: string;
  proposed_text: string;
  note: string | null;
  status: SuggestionStatus;
  created_by: string;
  created_at: string;
  resolved_by: string | null;
  resolved_at: string | null;
  applied_version: number | null;
  via: string | null;
}

function toSuggestion(r: Row): Suggestion {
  return {
    id: r.id, docId: r.doc_id, baseVersion: r.base_version,
    anchor: JSON.parse(r.anchor_json) as TextAnchor,
    originalText: r.original_text, proposedText: r.proposed_text, note: r.note,
    status: r.status, createdBy: r.created_by, createdAt: r.created_at,
    resolvedBy: r.resolved_by, resolvedAt: r.resolved_at, appliedVersion: r.applied_version,
    via: r.via,
  };
}

/** Create a pending suggestion. `via` marks a copilot-authored proposal; omitted means a person wrote it. */
export function createSuggestion(
  db: DatabaseType,
  input: {
    id: string; docId: string; baseVersion: number; anchor: TextAnchor;
    originalText: string; proposedText: string; note: string | null;
    createdBy: string; createdAt: string; via?: string | null;
  },
): void {
  db.prepare(
    `INSERT INTO doc_suggestions (id, doc_id, base_version, anchor_json, original_text, proposed_text, note, status, created_by, created_at, via)
     VALUES (@id, @doc, @base, @anchor, @orig, @prop, @note, 'pending', @by, @at, @via)`,
  ).run({
    id: input.id, doc: input.docId, base: input.baseVersion, anchor: JSON.stringify(input.anchor),
    orig: input.originalText, prop: input.proposedText, note: input.note, by: input.createdBy, at: input.createdAt,
    via: input.via ?? null,
  });
}

/** Every suggestion on a doc, newest first. */
export function listSuggestions(db: DatabaseType, docId: string): Suggestion[] {
  const rows = db.prepare(`SELECT * FROM doc_suggestions WHERE doc_id = @doc ORDER BY created_at DESC`).all({ doc: docId }) as Row[];
  return rows.map(toSuggestion);
}

/** A single suggestion by id, or null if unknown. */
export function getSuggestion(db: DatabaseType, id: string): Suggestion | null {
  const row = db.prepare(`SELECT * FROM doc_suggestions WHERE id = @id`).get({ id }) as Row | undefined;
  return row ? toSuggestion(row) : null;
}

/**
 * Move a PENDING suggestion to a terminal status, recording who and when.
 * Conditional on `status = 'pending'`: this is the sole place a suggestion
 * ever leaves pending, so two racing decisions (e.g. concurrent accept and
 * reject) can never both apply -- exactly one UPDATE changes a row, and
 * every other caller sees `false` (0 rows changed) rather than silently
 * overwriting an already-resolved decision.
 */
export function setSuggestionStatus(
  db: DatabaseType,
  id: string,
  status: SuggestionStatus,
  resolvedBy: string,
  at: string,
  appliedVersion: number | null,
): boolean {
  return db
    .prepare(
      `UPDATE doc_suggestions
       SET status = @status, resolved_by = @by, resolved_at = @at, applied_version = @ver
       WHERE id = @id AND status = 'pending'`,
    )
    .run({ id, status, by: resolvedBy, at, ver: appliedVersion }).changes > 0;
}
