import type { Database as DatabaseType } from "better-sqlite3";
import { normalizeTargetInput, slugifyTitle } from "@/lib/artifacts/note";
import { can } from "@/lib/authority/roles";
import { effectiveCanWrite } from "@/lib/authority/write-gate";
import { getSharedDoc, latestVersionOf } from "@/lib/db/shared-docs";
import { recordPublication } from "@/lib/db/shared-doc-publications";
import { publishCore, type PublishMode, type PublishResult } from "@/lib/kb-write/publish-core";
import { holdForTarget, holdNoteForMr } from "@/lib/content/hold";
import { findPromotionByTarget } from "@/lib/db/chat-docs";
import { accessFor, canManage } from "./access";
import { shareClearanceFor } from "./clearance";
import { isSharedDocPublishEnabled } from "./config";

/**
 * Publish a shared doc to the knowledge base (spec 2026-08-11), through the
 * spec-03 write path: worktree, branch, merge request. Never an auto-write.
 *
 * Who may: the OWNER, and only the owner. A recipient with edit access can
 * change the document inside the workspace, which is a different thing from
 * putting it in the canonical vault under the owner's name. On top of that, the
 * spec-22 write role, and the approver role for a direct publish, exactly as
 * artifacts are gated.
 *
 * Re-publishing is allowed on purpose, which is the one place this differs from
 * artifacts. An artifact freezes at `in_review` because editing it would diverge
 * the stored copy from what reviewers are reading. A shared doc has no such
 * copy: it is the working document, and its later revisions are legitimately
 * worth publishing again, so a second publish opens a second merge request and
 * supersedes the row.
 */
export async function publishSharedDoc(
  db: DatabaseType,
  input: {
    id: string;
    actorEmail: string;
    actorName?: string | null;
    mode: PublishMode;
    targetPath: string;
    targetVisibility: string[];
  },
): Promise<PublishResult> {
  if (!isSharedDocPublishEnabled()) {
    return { ok: false, status: 404, error: "publishing a shared document is not enabled" };
  }

  const doc = getSharedDoc(db, input.id);
  // Ownership is resolved through the same ACL the page uses, so a document the
  // caller cannot see and one they can see but do not own stay distinguishable
  // only to the extent they already were: a stranger gets 404, not 403.
  const access = accessFor(db, input.id, input.actorEmail, shareClearanceFor(input.actorEmail));
  if (!doc || !canManage(access)) {
    return { ok: false, status: 404, error: "document not found" };
  }
  if (!effectiveCanWrite(input.actorEmail)) {
    return { ok: false, status: 403, error: "you do not have permission to publish to the knowledge base" };
  }
  if (input.mode === "direct" && !can(input.actorEmail, "approve")) {
    return { ok: false, status: 403, error: "a direct publish requires the approver role" };
  }

  const normalized = normalizeTargetInput(input.targetPath);
  if (!normalized.ok) {
    return { ok: false, status: 400, error: normalized.error };
  }

  // Same refusal as the artifact path, and needed for the same reason: a chat
  // document promoted to a shared doc carries its format with it, so this route
  // reaches HTML bodies too. `publishCore` writes the body verbatim into
  // `docs/<path>.md`, and the vault is the one surface here where a bad write is
  // not undoable by its author.
  const latest = latestVersionOf(db, input.id);
  if (latest?.format === "html") {
    return {
      ok: false,
      status: 409,
      error: "a designed document cannot be published to the knowledge base yet",
    };
  }

  // Spec 2026-09-10: the same compliance refusal the artifact path holds. A
  // shared doc is a second road into the vault, so it needs the same gate.
  const hold = holdForTarget(db, "shared_doc", input.id, input.actorEmail);
  if (hold.held) {
    return { ok: false, status: 409, error: hold.message ?? "this content failed a compliance gate" };
  }

  const writeToken = process.env.REPO_WRITE_TOKEN?.trim();
  if (!writeToken) {
    return { ok: false, status: 503, error: "write_unavailable" };
  }

  const result = await publishCore({
    worktreeKey: `shared-doc-${input.id}`,
    title: doc.title,
    body: latest?.body ?? "",
    visibility: input.targetVisibility,
    targetRel: normalized.rel,
    mode: input.mode,
    ownerEmail: input.actorEmail,
    ownerName: input.actorName,
    writeToken,
    commitMessage: `Publish document: ${doc.title}`,
    slug: slugifyTitle(doc.title),
    mrDescription: `Publishing the shared document "${doc.title}" to `,
    mrDescriptionSuffix: sharedDocGateNote(db, input.id, input.actorEmail),
  });
  if (!result.ok) return result;

  // Recorded only after the write really landed, so a failed attempt never
  // leaves a document claiming a review that does not exist.
  recordPublication(db, {
    docId: input.id,
    status: result.mode === "mr" ? "in_review" : "published",
    targetPath: input.targetPath,
    targetVisibility: input.targetVisibility,
    publishedNotePath: result.notePath,
    mrUrl: result.mode === "mr" ? result.mrUrl : null,
  });
  return result;
}

function sharedDocGateNote(db: DatabaseType, id: string, actorEmail: string): string {
  // Two roads, same as `holdForTarget`: the shared doc may BE the landing
  // document (queued over /api/mcp) or may be a promoted chat document.
  const direct = holdNoteForMr(db, id, actorEmail);
  if (direct) return direct;
  const promotion = findPromotionByTarget(db, "shared_doc", id, actorEmail);
  return promotion ? holdNoteForMr(db, promotion.docId, actorEmail) : "";
}
