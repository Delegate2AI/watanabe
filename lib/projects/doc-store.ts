import fs from "node:fs";
import path from "node:path";
import { ALLOWED_ATTACHMENT_TYPES, maxAttachmentBytes } from "@/lib/attachments/store";

/**
 * On-disk storage for project document bytes (spec 26 extension). Bytes live
 * OUTSIDE the KB vault, one directory per project, so an uploaded file never
 * becomes KB content and never widens a session's clearance. Metadata lives in
 * `project_documents` (lib/db/project-docs.ts); this module only moves bytes.
 *
 * Reuses the attachments allow-list and size cap so project uploads accept the
 * same file types under the same limit as thread attachments.
 */

/** Base directory for all project documents. Overridable via `PROJECT_DOCS_DIR`. */
export function projectDocsRoot(): string {
  const override = process.env.PROJECT_DOCS_DIR?.trim();
  return override ? path.resolve(process.cwd(), override) : "/data/project-docs";
}

/** Collapse a path segment to a safe, single-level name (no traversal). */
function safeSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, "-").replace(/^\.+/, "").slice(0, 128) || "unnamed";
}

function projectDir(projectId: string): string {
  return path.join(projectDocsRoot(), safeSegment(projectId));
}

function filePath(projectId: string, id: string, filename: string): string {
  return path.join(projectDir(projectId), `${safeSegment(id)}-${safeSegment(filename)}`);
}

export type ValidationResult = { ok: true } | { ok: false; error: string };

/** Reject an over-cap or unsupported file BEFORE any bytes touch disk. */
export function validateProjectDocument(input: { mimeType: string; size: number }): ValidationResult {
  if (!ALLOWED_ATTACHMENT_TYPES.includes(input.mimeType)) {
    return { ok: false, error: `unsupported file type "${input.mimeType}"` };
  }
  if (input.size <= 0) return { ok: false, error: "empty file" };
  if (input.size > maxAttachmentBytes()) {
    return { ok: false, error: `file exceeds the ${maxAttachmentBytes()} byte limit` };
  }
  return { ok: true };
}

/** Write validated bytes for a project document. Throws on a disk failure. */
export function writeProjectDocument(input: {
  projectId: string;
  id: string;
  filename: string;
  bytes: Buffer;
}): void {
  fs.mkdirSync(projectDir(input.projectId), { recursive: true });
  fs.writeFileSync(filePath(input.projectId, input.id, input.filename), input.bytes);
}

/** Read a project document's bytes, or null if the file is missing on disk. */
export function readProjectDocument(input: { projectId: string; id: string; filename: string }): Buffer | null {
  const file = filePath(input.projectId, input.id, input.filename);
  try {
    return fs.readFileSync(file);
  } catch {
    return null;
  }
}

/** Delete a project document's bytes. A missing file is not an error. */
export function deleteProjectDocumentFile(input: { projectId: string; id: string; filename: string }): void {
  try {
    fs.unlinkSync(filePath(input.projectId, input.id, input.filename));
  } catch (error) {
    // Missing file is fine (already gone); log anything else and move on so the
    // DB row can still be removed.
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      console.error(`[project-docs] failed to delete file: ${String(error)}`);
    }
  }
}
