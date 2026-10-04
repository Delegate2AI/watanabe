import type { Database as DatabaseType } from "better-sqlite3";
import { getArtifactForOwner, listArtifactsForOwner } from "./artifacts";
import { getSharedDoc, listSharedByOwner, listSharedWith } from "./shared-docs";
import { shareClearanceFor } from "@/lib/shared-docs/clearance";
import { accessFor, canRead } from "@/lib/shared-docs/access";
import { isSharedDocsEnabled } from "@/lib/shared-docs/config";
import { resolveKbDoc } from "@/lib/kb/resolve";
import { vaultRootFor } from "@/lib/repo";

/**
 * `project_references` access (surface-polish P-05): content that already
 * exists elsewhere in the app, attached to a project by REFERENCE.
 *
 * The distinction from `project_documents` is the whole point. A document is
 * uploaded INTO a project and the project owns its bytes. A reference points at
 * an artifact, a shared doc, or a knowledge-base note that keeps its own owner
 * and its own access rules, so attaching one never copies content and never
 * widens who can read it. {@link resolveProjectReferences} re-resolves the
 * target's access on every read, which is why revoking access to the target
 * simply drops it out of the project view rather than deleting the row:
 * re-granting brings it straight back.
 *
 * DI-seam module (takes `db` first), prepared statements, named params. Every
 * function is scoped by `project_id`, so a reference id alone can never reach
 * across projects. The caller authorizes the PROJECT first.
 */

export type ReferenceKind = "artifact" | "shared_doc" | "kb";

export interface ProjectReference {
  id: string;
  projectId: string;
  kind: ReferenceKind;
  targetId: string;
  addedBy: string;
  createdAt: string;
}

/** A reference plus what the requester may actually see of its target. */
export interface ResolvedReference extends ProjectReference {
  title: string;
  /** Where the target lives, for the link. */
  href: string;
}

/**
 * One thing a requester could attach, offered by the picker.
 *
 * `kb` is deliberately absent: the vault is far too large to enumerate into a
 * candidate list, so KB notes are found by search and authorized by resolution
 * ({@link resolveKbTarget}) instead.
 */
export interface AttachableTarget {
  kind: Exclude<ReferenceKind, "kb">;
  targetId: string;
  title: string;
}

interface Row {
  id: string;
  project_id: string;
  kind: ReferenceKind;
  target_id: string;
  added_by: string;
  created_at: string;
}

function fromRow(row: Row): ProjectReference {
  return {
    id: row.id,
    projectId: row.project_id,
    kind: row.kind,
    targetId: row.target_id,
    addedBy: row.added_by,
    createdAt: row.created_at,
  };
}

/**
 * Attach a reference. Idempotent on (project, kind, target): re-attaching the
 * same target is a no-op rather than a duplicate row. Returns false when the
 * pair was already attached.
 */
export function insertProjectReference(db: DatabaseType, ref: ProjectReference): boolean {
  const info = db
    .prepare(
      `INSERT OR IGNORE INTO project_references (id, project_id, kind, target_id, added_by, created_at)
       VALUES (@id, @projectId, @kind, @targetId, @addedBy, @createdAt)`,
    )
    .run(ref);
  return info.changes > 0;
}

/** Every reference row on a project, oldest first. Access is NOT applied here. */
export function listProjectReferences(db: DatabaseType, projectId: string): ProjectReference[] {
  const rows = db
    .prepare(`SELECT * FROM project_references WHERE project_id = @projectId ORDER BY created_at ASC, id ASC`)
    .all({ projectId }) as Row[];
  return rows.map(fromRow);
}

/** Detach a reference, scoped to its project. False when nothing matched. */
export function deleteProjectReference(db: DatabaseType, projectId: string, id: string): boolean {
  const info = db
    .prepare(`DELETE FROM project_references WHERE id = @id AND project_id = @projectId`)
    .run({ id, projectId });
  return info.changes > 0;
}

/**
 * Resolve a KB note for `clearance`, returning its canonical vault-relative
 * path plus what a link to it needs. `null` means "not attachable", which
 * covers a restricted note and an invented path with the same answer: the
 * clearance projection (spec 19) does not contain a note above the requester,
 * so it fails to resolve for the same reason a typo does. Path containment is
 * `resolveVaultEntry`'s, so a `../` escape resolves to `null` here too.
 *
 * Accepts either spelling of a note (`a/b` or `a/b.md`) and always answers with
 * the on-disk `.md` form, so callers can normalize before storing and one note
 * cannot attach twice under two names.
 */
export function resolveKbTarget(
  pathOrRoute: string,
  clearance: string[],
): { relPath: string; title: string; href: string } | null {
  const segments = pathOrRoute.split("/").filter(Boolean);
  if (segments.length === 0) return null;
  const resolution = resolveKbDoc(segments, vaultRootFor(clearance));
  if (!resolution || resolution.kind !== "doc") return null;
  return {
    relPath: resolution.relPath,
    title: resolution.note.title,
    // The KB view's clean-URL scheme (lib/vault.ts#toRouteSlug): the on-disk
    // name carries `.md`, the route never does.
    href: `/kb/${resolution.relPath.replace(/\.md$/i, "")}`,
  };
}

/**
 * The project's references the REQUESTER may see, with the target's live title.
 *
 * Access is the TARGET's, resolved now: an artifact is owner-private (spec 27),
 * a shared doc is governed by its explicit ACL (spec 28), and a KB note by the
 * requester's own clearance projection (spec 19). A reference whose target the
 * requester cannot read is omitted, and a reference whose target was deleted
 * outright is omitted the same way, so the project view never leaks a title
 * through a stale row.
 *
 * `clearance` is therefore part of the answer, not just of the authorization:
 * two members of one project see different reference lists, and narrowing a
 * note's `visibility:` drops it off the project page with nobody touching the
 * project.
 */
export function resolveProjectReferences(
  db: DatabaseType,
  projectId: string,
  requesterEmail: string,
  clearance: string[],
): ResolvedReference[] {
  const resolved: ResolvedReference[] = [];
  for (const ref of listProjectReferences(db, projectId)) {
    if (ref.kind === "artifact") {
      const artifact = getArtifactForOwner(db, ref.targetId, requesterEmail);
      if (artifact) resolved.push({ ...ref, title: artifact.title, href: `/artifacts/${artifact.id}` });
      continue;
    }
    if (ref.kind === "kb") {
      // Resolved lazily, one row at a time: a project with no KB references
      // never touches the vault at all.
      const note = resolveKbTarget(ref.targetId, clearance);
      if (note) resolved.push({ ...ref, title: note.title, href: note.href });
      continue;
    }
    if (!canRead(accessFor(db, ref.targetId, requesterEmail))) continue;
    const doc = getSharedDoc(db, ref.targetId);
    if (doc) resolved.push({ ...ref, title: doc.title, href: `/docs/${doc.id}` });
  }
  return resolved;
}

/**
 * What `requesterEmail` may attach: their own artifacts, plus every shared doc
 * they own or hold a share on.
 *
 * This list IS the attach authorization for these two kinds. Nothing here
 * consults group clearance, because neither target type is governed by it: an
 * artifact is owner-private (spec 27) and a shared doc is an explicit ACL
 * (spec 28). A target absent from this list is indistinguishable from one that
 * does not exist, which is what stops the attach route from confirming a
 * stranger's document id.
 *
 * A KB note is authorized the other way round, by {@link resolveKbTarget}: it
 * is not enumerable, but absence from the requester's clearance projection
 * gives the identical "unreachable and nonexistent look the same" property.
 */
export function attachableFor(db: DatabaseType, requesterEmail: string): AttachableTarget[] {
  const targets: AttachableTarget[] = listArtifactsForOwner(db, requesterEmail).map((a) => ({
    kind: "artifact" as const,
    targetId: a.id,
    title: a.title,
  }));
  if (!isSharedDocsEnabled()) return targets;
  const seen = new Set<string>();
  for (const doc of [...listSharedByOwner(db, requesterEmail), ...listSharedWith(db, requesterEmail, shareClearanceFor(requesterEmail))]) {
    if (seen.has(doc.id)) continue;
    seen.add(doc.id);
    targets.push({ kind: "shared_doc", targetId: doc.id, title: doc.title });
  }
  return targets;
}
