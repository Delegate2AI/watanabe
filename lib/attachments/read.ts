import fs from "node:fs";
import path from "node:path";
import { attachmentDirFor } from "./store";

/**
 * Agent-read for thread attachments: every stored file is listed for the model
 * as READ-ONLY spec-11 grounding context (the same `<portal-context>`
 * mechanism as a vault selection), NOT by widening the session's KB
 * path-scope. An attachment never becomes KB content, is never written to the
 * vault, and never widens a session's clearance.
 *
 * SECURITY, owner and thread come from the AUTHENTICATED session, never a
 * client field. The caller (app/api/agent/route.ts) resolves attachments from
 * `attachmentDirFor(identity.email, parsed.sessionId)` where `parsed.sessionId`
 * has already been ownership-checked (lib/db/ownership.ts). A client cannot
 * name another user's owner key or another thread's id to read someone else's
 * uploads: this module only ever reads the one directory it is handed, and
 * enforces that every file it returns resolves to a real path that stays
 * INSIDE that directory (realpath + prefix check, mirroring lib/repo-write.ts
 * and lib/agent/permissions.ts#isPathWithinVault). A traversal or symlink
 * escape yields nothing, never a read outside the dir.
 *
 * NEVER-THROWS: a missing/unreadable dir or a bad individual file degrades to
 * "no attachment context" (skip and continue), never crashing a turn.
 */

/** Strips the `${uuid}-` prefix `storeAttachment` adds, recovering the display name. */
const UUID_PREFIX_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-/i;

function displayName(storedName: string): string {
  return storedName.replace(UUID_PREFIX_RE, "");
}

/**
 * `p`'s real, symlink-free absolute form when it exists on disk; a plain
 * lexical resolve otherwise. Mirrors lib/repo-write.ts#realOrResolved so a
 * symlinked base dir (e.g. macOS `/var` → `/private/var`) doesn't spuriously
 * fail the containment prefix check below.
 */
function realOrResolved(p: string): string {
  try {
    return fs.realpathSync(p);
  } catch {
    return path.resolve(p);
  }
}

/** True when `candidate` resolves to a real path that stays strictly inside `dir`. */
function isContainedIn(candidate: string, dir: string): boolean {
  const realDir = realOrResolved(dir);
  const realCandidate = realOrResolved(candidate);
  const rel = path.relative(realDir, realCandidate);
  // Reject the dir itself (rel === ""), any traversal (`..`), any absolute
  // escape, and any nested segment (an attachment dir is a single flat level -
  // a `/` in rel means the file resolved into a subdirectory, not this dir).
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel) && !rel.includes(path.sep);
}

export interface Attachment {
  id: string;
  name: string;
  path: string;
  mimeType: string;
  size: number;
  text?: string;
}

export const MAX_INLINE_TEXT_BYTES = 32 * 1024;

const MIME_BY_EXTENSION: Readonly<Record<string, string>> = {
  ".txt": "text/plain",
  ".md": "text/markdown",
  ".markdown": "text/markdown",
  ".csv": "text/csv",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".pdf": "application/pdf",
};

const INLINE_TEXT_TYPES: ReadonlySet<string> = new Set([
  "text/plain",
  "text/markdown",
  "text/csv",
  "application/json",
]);

function mimeTypeFor(name: string): string {
  return MIME_BY_EXTENSION[path.extname(name).toLowerCase()] ?? "application/octet-stream";
}

function idFrom(storedName: string): string {
  const match = UUID_PREFIX_RE.exec(storedName);
  return match ? match[0].slice(0, -1) : "";
}

export function listAttachments(ownerEmail: string, threadId: string): Attachment[] {
  const dir = attachmentDirFor(ownerEmail, threadId);
  let entries: string[];
  try {
    entries = fs.readdirSync(dir);
  } catch {
    return [];
  }

  const out: Attachment[] = [];
  for (const entry of entries) {
    const abs = path.join(dir, entry);
    if (!isContainedIn(abs, dir)) continue;
    try {
      const stat = fs.statSync(abs);
      if (!stat.isFile()) continue;
      const name = displayName(entry);
      const mimeType = mimeTypeFor(name);
      const attachment: Attachment = {
        id: idFrom(entry),
        name,
        path: realOrResolved(abs),
        mimeType,
        size: stat.size,
      };
      if (INLINE_TEXT_TYPES.has(mimeType) && stat.size <= MAX_INLINE_TEXT_BYTES) {
        attachment.text = fs.readFileSync(abs, "utf8");
      }
      out.push(attachment);
    } catch {
      continue;
    }
  }
  return out;
}
