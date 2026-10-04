import type { Database as DatabaseType } from "better-sqlite3";
import type { DocumentLinkAccess } from "./types";

export type EffectiveAccess = "none" | "view" | "comment" | "edit" | "owner";

const RANK: Record<EffectiveAccess, number> = {
  none: 0,
  view: 1,
  comment: 2,
  edit: 3,
  owner: 4,
};

export function accessFor(
  db: DatabaseType,
  docId: string,
  email: string,
): EffectiveAccess {
  const row = db.prepare(
    `SELECT d.owner_email, s.access
     FROM documents d
     LEFT JOIN document_shares s
       ON s.doc_id = d.id AND s.recipient_email = @email
     WHERE d.id = @doc`,
  ).get({ doc: docId, email }) as
    | { owner_email: string; access: Exclude<EffectiveAccess, "none" | "owner"> | null }
    | undefined;
  if (!row) return "none";
  if (row.owner_email === email) return "owner";
  return row.access ?? "none";
}

export function accessForToken(
  db: DatabaseType,
  token: string,
  now: string = new Date().toISOString(),
): { docId: string; access: DocumentLinkAccess } | null {
  const row = db.prepare(
    `SELECT l.doc_id, l.access, l.expires_at
     FROM document_links l
     JOIN documents d ON d.id = l.doc_id
     WHERE l.token = @token`,
  ).get({ token }) as
    | { doc_id: string; access: DocumentLinkAccess; expires_at: string | null }
    | undefined;
  if (!row) return null;
  if (row.expires_at !== null && row.expires_at <= now) return null;
  return { docId: row.doc_id, access: row.access };
}

export function canRead(access: EffectiveAccess): boolean {
  return RANK[access] >= RANK.view;
}

export function canComment(access: EffectiveAccess): boolean {
  return RANK[access] >= RANK.comment;
}

export function canEdit(access: EffectiveAccess): boolean {
  return RANK[access] >= RANK.edit;
}

export function canManage(access: EffectiveAccess): boolean {
  return access === "owner";
}
