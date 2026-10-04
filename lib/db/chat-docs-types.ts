import type { DocFormat } from "@/lib/documents/types";

/**
 * Row shapes and record types for the chat-documents store (./chat-docs.ts).
 *
 * Split out when that file crossed the size limit. Types only: no SQL, no
 * database import beyond the format union, so a consumer that needs the shape
 * of a chat document does not pull in the store.
 */

export type PromotionTarget = "artifact" | "shared_doc";

export interface ChatDocRecord {
  id: string;
  threadId: string;
  ownerEmail: string;
  title: string;
  currentVersion: number;
  createdAt: string;
  updatedAt: string;
}

export interface ChatDocVersion {
  version: number;
  body: string;
  format: DocFormat;
  createdAt: string;
}

export interface ChatDocPromotion {
  docId: string;
  targetType: PromotionTarget;
  targetId: string;
  promotedVersion: number;
  targetVersionAtPromote: number;
  createdAt: string;
}

/**
 * The optional tail of a version write.
 *
 * An object, not two more positionals. Adding `format` as a fifth positional in
 * front of the existing `now` typechecked at the definition and silently
 * reinterpreted every `addVersion(..., iso(...))` call as a format, which is
 * exactly the break a default value hides.
 */
export interface AddVersionOptions {
  format?: DocFormat;
  now?: string;
}

/** The raw `chat_documents` row, as SQLite returns it. */
export interface DocRow {
  id: string;
  thread_id: string;
  owner_email: string;
  title: string;
  current_version: number;
  created_at: string;
  updated_at: string;
}

export function fromRow(row: DocRow): ChatDocRecord {
  return {
    id: row.id,
    threadId: row.thread_id,
    ownerEmail: row.owner_email,
    title: row.title,
    currentVersion: row.current_version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
