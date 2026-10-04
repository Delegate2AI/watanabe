import type { Database as DatabaseType } from "better-sqlite3";
import { effectiveCanWrite } from "@/lib/authority/write-gate";
import { can } from "@/lib/authority/roles";
import { getArtifactForOwner, latestVersionOf, markPublished } from "@/lib/db/artifacts";
import { publishCore, type PublishMode, type PublishResult } from "@/lib/kb-write/publish-core";
import { isArtifactPublishEnabled } from "./config";
import { holdForTarget, holdNoteForMr } from "@/lib/content/hold";
import { findPromotionByTarget } from "@/lib/db/chat-docs";
import { normalizeTargetInput, slugifyTitle } from "./note";

export type { PublishMode, PublishResult } from "@/lib/kb-write/publish-core";

/**
 * Publish an artifact to the KB through the EXISTING write path (spec 27).
 *
 * Doctrine, all enforced here: publishing goes through the shared publish core;
 * never auto-merges, never force-pushes, never widens the `docs/` allow-list.
 * Role-gated by spec 22: `mr` needs `write` (editor+), `direct` additionally
 * needs `approve` (approver+). Owner-scoped: a foreign or unknown id both
 * return the same 404 (no existence oracle). Never throws: every failure is a
 * typed `{ ok: false }` result the route maps to a status.
 */
export async function publishArtifact(
  db: DatabaseType,
  input: { id: string; ownerEmail: string; ownerName?: string | null; mode: PublishMode },
): Promise<PublishResult> {
  const { id, ownerEmail, mode } = input;

  if (!isArtifactPublishEnabled()) {
    return { ok: false, status: 404, error: "publishing is not enabled" };
  }
  if (!effectiveCanWrite(ownerEmail)) {
    return { ok: false, status: 403, error: "you do not have permission to publish to the knowledge base" };
  }
  if (mode === "direct" && !can(ownerEmail, "approve")) {
    return { ok: false, status: 403, error: "a direct publish requires the approver role" };
  }

  const artifact = getArtifactForOwner(db, id, ownerEmail);
  if (!artifact) return { ok: false, status: 404, error: "artifact not found" };
  if (artifact.status !== "ready") {
    return { ok: false, status: 409, error: "only a ready artifact can be published" };
  }
  if (!artifact.targetPath) {
    return { ok: false, status: 409, error: "the artifact has no target path" };
  }
  const normalized = normalizeTargetInput(artifact.targetPath);
  if (!normalized.ok) {
    return { ok: false, status: 400, error: normalized.error };
  }

  // `publishCore` writes this body verbatim into `docs/<path>.md`. A designed
  // HTML page written into a markdown note is model-authored markup landing in
  // the vault as if it were prose: Quartz renders it as escaped tag soup or as
  // nothing, and the merge request is a diff nobody can read. Spec section 7
  // makes an HTML publish a two-file merge request (a derived `.md` beside the
  // designed `.html`), which needs the renderer. Until a derived markdown is
  // actually in hand the answer is a refusal, not a best effort: the vault is
  // the one place here where a bad write is not undoable by its author.
  const latest = latestVersionOf(db, id, ownerEmail);
  if (latest?.format === "html") {
    return {
      ok: false,
      status: 409,
      error: "a designed document cannot be published to the knowledge base yet",
    };
  }

  // well as at promotion because the two are separately reachable and because
  // the gate report can land after the artifact was promoted. An artifact with
  // no chat document behind it (which is most of them) is never held.
  const hold = holdForTarget(db, "artifact", id, ownerEmail);
  if (hold.held) {
    return { ok: false, status: 409, error: hold.message ?? "this content failed a compliance gate" };
  }

  const writeToken = process.env.REPO_WRITE_TOKEN?.trim();
  if (!writeToken) {
    // A reason code, not prose: this string reaches the wire through the
    // publish route, and naming an environment variable to a contributor who
    // has never seen the repo tells them nothing they can act on.
    return { ok: false, status: 503, error: "write_unavailable" };
  }

  const message = `Publish artifact: ${artifact.title}`;
  const result = await publishCore({
    worktreeKey: `artifact-${id}`,
    title: artifact.title,
    body: latest?.body ?? "",
    visibility: artifact.targetVisibility ?? ["all-hands"],
    targetRel: normalized.rel,
    mode,
    ownerEmail,
    ownerName: input.ownerName,
    writeToken,
    commitMessage: message,
    slug: slugifyTitle(artifact.title),
    // The gate report travels into the merge request so an approver who never saw
    // every existing description stays byte-identical.
    mrDescription: `Publishing the artifact "${artifact.title}" to `,
    mrDescriptionSuffix: artifactGateNote(db, id, ownerEmail),
  });

  if (!result.ok) {
    return result.error === "failed to publish" ? { ...result, error: "failed to publish artifact" } : result;
  }

  try {
    // `mr` mode has only PROPOSED the note: it lives on a branch behind a merge
    // request and is not in the knowledge base until someone merges it. Only a
    // `direct` publish is actually live, so only it may claim `published`.
    //
    // The merge request URL is persisted, not just returned: without it an
    // artifact sat in `in_review` with no way to reach its own review after a
    // reload, since the URL only ever existed in transient client state.
    markPublished(
      db,
      id,
      ownerEmail,
      result.notePath,
      mode === "direct" ? "published" : "in_review",
      result.mode === "mr" ? { url: result.mrUrl, iid: result.mrIid } : null,
    );
    return result;
  } catch (error) {
    return { ok: false, status: 500, error: error instanceof Error ? error.message : "failed to publish artifact" };
  }
}

function artifactGateNote(db: DatabaseType, id: string, ownerEmail: string): string {
  const promotion = findPromotionByTarget(db, "artifact", id, ownerEmail);
  return promotion ? holdNoteForMr(db, promotion.docId, ownerEmail) : "";
}
