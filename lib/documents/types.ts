/**
 * What a document version's body IS. Not a presentation preference: the two are
 * read by different renderers, and the markdown one sets `proseSkipHtml`, so an
 * HTML body sent through it renders as an empty document rather than as tag soup.
 */
export type DocFormat = "md" | "html";

/** The value every row written before the column existed carries. */
export const DEFAULT_DOC_FORMAT: DocFormat = "md";

export function isDocFormat(value: unknown): value is DocFormat {
  return value === "md" || value === "html";
}

export type DocumentAccess = "view" | "comment" | "edit";
export type DocumentLinkAccess = "view" | "comment";
// Mirrors ArtifactStatus: backfill copies an artifact's status straight in,
// so any status the artifact model can hold must be representable here.
export type PublicationStatus = "draft" | "ready" | "in_review" | "published";

export interface DocumentRecord {
  id: string;
  ownerEmail: string;
  title: string;
  currentVersion: number;
  originThreadId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DocumentVersion {
  version: number;
  body: string;
  format: DocFormat;
  authorEmail: string;
  createdAt: string;
}

export interface DocumentShare {
  recipientEmail: string;
  access: DocumentAccess;
  createdAt: string;
}

export interface DocumentComment {
  id: string;
  authorEmail: string;
  body: string;
  anchor: string | null;
  createdAt: string;
}

export interface DocumentLink {
  token: string;
  access: DocumentLinkAccess;
  expiresAt: string | null;
  createdAt: string;
}

export interface DocumentPublication {
  status: PublicationStatus;
  targetPath: string | null;
  targetVisibility: string[] | null;
  publishedNotePath: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DocumentDisposition {
  private: boolean;
  shared: boolean;
  published: boolean;
}
