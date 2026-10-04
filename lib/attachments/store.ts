import fs from "node:fs";
import path from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { isFlagEnabled } from "@/lib/config/flags";

/**
 * Thread-scoped file attachments (spec 24). An uploaded file is stored on the
 * pod PVC under an attachments directory keyed by OWNER then THREAD, deliberately
 * OUTSIDE the KB vault: an attachment is readable content scoped to one thread,
 * it never becomes KB content and never widens a session's KB clearance.
 *
 * Cross-user isolation comes from the path: the owner segment is derived from
 * the authenticated identity (never a client-supplied value), so one user's
 * upload can only ever land under their own slug, and the agent for a thread
 * only ever reads back from that same owner+thread directory.
 *
 * Gated by `ATTACHMENTS_ENABLED` (default off): flag-off, the route refuses and
 * the composer's `+` is disabled with a tooltip, so no byte-path changes.
 */

/** The single source of truth for whether attachments are switched on. */
export function isAttachmentsEnabled(): boolean {
  return isFlagEnabled("ATTACHMENTS_ENABLED");
}

/** MIME types accepted (images, text, markdown, csv, json, pdf). */
export const ALLOWED_ATTACHMENT_TYPES: readonly string[] = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "text/plain",
  "text/markdown",
  "text/csv",
  "application/json",
  "application/pdf",
];

/** Hard per-file size cap. Overridable via `ATTACHMENTS_MAX_BYTES`. */
export function maxAttachmentBytes(): number {
  const raw = Number(process.env.ATTACHMENTS_MAX_BYTES);
  return Number.isFinite(raw) && raw > 0 ? raw : 10 * 1024 * 1024;
}

/**
 * Base directory for all attachments. Overridable via `ATTACHMENTS_DIR` (local
 * dev without a `/data` mount); defaults to `/data/attachments`, a sibling of
 * the KB vault checkout, so the two never collide under the one PVC mount.
 */
export function attachmentsRoot(): string {
  const override = process.env.ATTACHMENTS_DIR?.trim();
  return override ? path.resolve(process.cwd(), override) : "/data/attachments";
}

/**
 * A collision-resistant directory key for an owner. A slug (lowercase, punct
 * collapsed) can map two distinct emails to the same folder (e.g. `a.b@x.com`
 * and `a-b@x.com` both slug to `a-b-at-x.com`), which would let one user's
 * uploads land in another's directory. A SHA-256 of the raw email cannot
 * collide across distinct identities, so it is the isolation boundary here.
 */
export function ownerKey(ownerEmail: string): string {
  return createHash("sha256").update(ownerEmail).digest("hex").slice(0, 32);
}

/** The per-owner, per-thread directory an attachment lands in. */
export function attachmentDirFor(ownerEmail: string, threadId: string): string {
  return path.join(attachmentsRoot(), ownerKey(ownerEmail), safeSegment(threadId));
}

/** A single stored attachment as the composer renders it (a context chip). */
export interface AttachmentChip {
  type: "attachment";
  id: string;
  name: string;
  mimeType: string;
  size: number;
  threadId: string;
}

export type ValidationResult = { ok: true } | { ok: false; error: string };

const GENERIC_MIME_TYPES: ReadonlySet<string> = new Set(["", "application/octet-stream"]);
const TEXT_FALLBACK_EXTENSIONS: readonly string[] = [".csv", ".json", ".txt", ".md"];

function hasTextFallbackExtension(filename: string | undefined): boolean {
  if (!filename) return false;
  const lower = filename.toLowerCase();
  return TEXT_FALLBACK_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

export function validateAttachment(input: {
  mimeType: string;
  size: number;
  filename?: string;
}): ValidationResult {
  const accepted =
    ALLOWED_ATTACHMENT_TYPES.includes(input.mimeType) ||
    (GENERIC_MIME_TYPES.has(input.mimeType) && hasTextFallbackExtension(input.filename));
  if (!accepted) {
    return { ok: false, error: `unsupported file type "${input.mimeType}"` };
  }
  if (input.size <= 0) return { ok: false, error: "empty file" };
  if (input.size > maxAttachmentBytes()) {
    return { ok: false, error: `file exceeds the ${maxAttachmentBytes()} byte limit` };
  }
  return { ok: true };
}

/** Collapse a path segment to a safe, single-level name (no traversal). */
function safeSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, "-").replace(/^\.+/, "").slice(0, 128) || "unnamed";
}

/**
 * Persist one validated attachment for `ownerEmail` in `threadId`, returning the
 * chip the composer shows. The stored filename is prefixed with a fresh UUID so
 * two files of the same name never collide. Throws on a disk write failure (the
 * route turns that into a 500); validation is the caller's job first.
 */
export function storeAttachment(input: {
  ownerEmail: string;
  threadId: string;
  filename: string;
  mimeType: string;
  bytes: Buffer;
}): AttachmentChip {
  const dir = attachmentDirFor(input.ownerEmail, input.threadId);
  fs.mkdirSync(dir, { recursive: true });
  const id = randomUUID();
  const name = safeSegment(input.filename);
  fs.writeFileSync(path.join(dir, `${id}-${name}`), input.bytes);
  return {
    type: "attachment",
    id,
    name,
    mimeType: input.mimeType,
    size: input.bytes.length,
    threadId: input.threadId,
  };
}
