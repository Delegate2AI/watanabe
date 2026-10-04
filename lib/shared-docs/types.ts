import type { DocFormat } from "@/lib/documents/types";

/**
 * Shared-doc domain types (spec 28). Kept separate from the DB module so both
 * the store (`lib/db/shared-docs.ts`) and the access resolver
 * (`lib/shared-docs/access.ts`) import one source of truth without a cycle.
 */

import type { Person } from "@/lib/people/types";

export type SharedAccess = "view" | "comment" | "edit";
export type LinkAccess = "view" | "comment";

export interface SharedDocRecord {
  id: string;
  title: string;
  ownerEmail: string;
  createdAt: string;
  updatedAt: string;
}

export interface DocVersion {
  version: number;
  body: string;
  format: DocFormat;
  authorEmail: string;
  createdAt: string;
}

/**
 * The optional tail of a shared-doc version write.
 *
 * An object rather than more positionals, matching the other three version
 * stores. A `format` slotted in front of the existing `now` typechecks at the
 * definition and silently reinterprets every `addVersion(..., timestamp)` call
 * as a format.
 */
export interface SharedVersionOptions {
  format?: DocFormat;
  now?: string;
}

/**
 * What a share row is addressed to. A "user" grant names one person by email; a
 * "group" grant names a team by its `access/groups.yaml` key and resolves live,
 * so joining that team grants access and leaving it takes access away with no
 * edit to the document.
 */
export type ShareRecipientKind = "user" | "group";

export interface DocShare {
  /**
   * The ACL key. An email address when `recipientKind` is "user", a group NAME
   * when it is "group". The two can never collide: a user recipient is validated
   * as an email and a group key is validated against `groups.yaml`, which holds
   * bare names.
   */
  recipient: string;
  recipientKind: ShareRecipientKind;
  access: SharedAccess;
  createdAt: string;
}

export interface DocComment {
  id: string;
  authorEmail: string;
  body: string;
  anchor: string | null;
  createdAt: string;
}

export interface DocLink {
  token: string;
  docId: string;
  access: LinkAccess;
  expiresAt: string | null;
  createdAt: string;
}

/**
 * A quote+context anchor (spec 2026-07-22). Computed over the rendered plaintext
 * of a doc, NOT the Markdown source, so it matches exactly what a reader selects.
 * `start` is a hint used to break ties between identical quotes; `prefix`/`suffix`
 * are up to 32 chars of surrounding rendered text for disambiguation.
 */
export interface TextAnchor {
  quote: string;
  prefix: string;
  suffix: string;
  start: number;
}

export interface CommentMessage {
  id: string;
  authorEmail: string;
  body: string;
  createdAt: string;
}

export interface CommentThread {
  id: string;
  docId: string;
  anchor: TextAnchor | null;
  status: "open" | "resolved";
  createdBy: string;
  createdAt: string;
  resolvedBy: string | null;
  resolvedAt: string | null;
  messages: CommentMessage[];
}

export type SuggestionStatus = "pending" | "accepted" | "rejected" | "stale";

export interface Suggestion {
  id: string;
  docId: string;
  baseVersion: number;
  anchor: TextAnchor;
  originalText: string;
  proposedText: string;
  note: string | null;
  status: SuggestionStatus;
  createdBy: string;
  createdAt: string;
  resolvedBy: string | null;
  resolvedAt: string | null;
  appliedVersion: number | null;
  /** Who authored the proposal: "copilot" for the doc copilot, null for a person. */
  via: string | null;
}

export interface ShareTeamOption {
  name: string;
  /** Members in `groups.yaml`. `null` for all-hands, which is never declared per-member. */
  memberCount: number | null;
}

export interface SharePersonOption {
  email: string;
  person: Person;
}

export interface ShareOptions {
  teams: ShareTeamOption[];
  people: SharePersonOption[];
}

/** Where an access request stands. A decided request is kept for the audit. */
export type AccessRequestStatus = "pending" | "granted" | "declined";

/**
 * One person asking the owner of a shared document for access to it (the
 * "You need access" screen). `access` is the level they ASKED for; what they
 * were given, if anything, is the `doc_shares` row the owner's decision wrote.
 */
export interface DocAccessRequest {
  id: string;
  docId: string;
  requesterEmail: string;
  access: SharedAccess;
  message: string | null;
  status: AccessRequestStatus;
  createdAt: string;
  decidedAt: string | null;
  decidedBy: string | null;
}
