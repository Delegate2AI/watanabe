import type { SharedDocRecord } from "@/lib/shared-docs/types";

/**
 * The raw `shared_docs` row shape and its one mapper.
 *
 * Extracted so `./shared-docs.ts` and `./shared-doc-shares.ts` can both return
 * `SharedDocRecord`s without either importing the other (the shares module is a
 * child of the docs module, so a back-import would be a cycle).
 */
export interface DocRow {
  id: string;
  title: string;
  owner_email: string;
  created_at: string;
  updated_at: string;
}

export function fromRow(row: DocRow): SharedDocRecord {
  return {
    id: row.id,
    title: row.title,
    ownerEmail: row.owner_email,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
