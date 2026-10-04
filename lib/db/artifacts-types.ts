import type { DocFormat } from "@/lib/documents/types";

/**
 * Row shapes and record types for the artifacts store (./artifacts.ts).
 *
 * Split out when that file crossed the size limit. Types plus the two pure row
 * mappers, so nothing here touches a database handle.
 */

/**
 * `in_review` is a real, distinct state, not a flavour of `published`: an `mr`
 * publish opens a merge request and the note is NOT in the knowledge base until
 * somebody merges it. Collapsing the two (as this type previously did) made the
 * UI tell a contributor their change was live while it sat unmerged, so they
 * stopped chasing the review.
 */
export type ArtifactStatus = "draft" | "ready" | "in_review" | "published";

export interface ArtifactRecord {
  id: string;
  title: string;
  ownerEmail: string;
  sourceThreadId: string | null;
  status: ArtifactStatus;
  targetPath: string | null;
  targetVisibility: string[] | null;
  publishedNotePath: string | null;
  /** The merge request an `mr` publish opened, so `in_review` is reachable. */
  mrUrl: string | null;
  /** That merge request's iid, which is what the reconciler queries. */
  mrIid: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface ArtifactVersion {
  version: number;
  body: string;
  format: DocFormat;
  createdAt: string;
}

/**
 * The optional tail of an artifact version write.
 *
 * An object rather than more positionals, matching `lib/db/chat-docs-types.ts`.
 * A `format` slotted in front of the existing `now` typechecks at the definition
 * and silently reinterprets every `addVersion(..., timestamp)` call as a format.
 */
export interface ArtifactVersionOptions {
  format?: DocFormat;
  now?: string;
}

export interface ArtifactRow {
  id: string;
  title: string;
  owner_email: string;
  source_thread_id: string | null;
  status: ArtifactStatus;
  target_path: string | null;
  target_visibility: string | null;
  published_note_path: string | null;
  mr_url: string | null;
  mr_iid: number | null;
  created_at: string;
  updated_at: string;
}

function parseVisibility(raw: string | null): string[] | null {
  if (raw === null) return null;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.every((v) => typeof v === "string") ? parsed : null;
  } catch {
    return null;
  }
}

export function fromRow(row: ArtifactRow): ArtifactRecord {
  return {
    id: row.id,
    title: row.title,
    ownerEmail: row.owner_email,
    sourceThreadId: row.source_thread_id,
    status: row.status,
    targetPath: row.target_path,
    targetVisibility: parseVisibility(row.target_visibility),
    publishedNotePath: row.published_note_path,
    mrUrl: row.mr_url,
    mrIid: row.mr_iid,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
