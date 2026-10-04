import type { Database as DatabaseType } from "better-sqlite3";
import { can } from "@/lib/authority/roles";
import { effectiveCanWrite } from "@/lib/authority/write-gate";
import { normalizeTargetInput, slugifyTitle } from "@/lib/artifacts/note";
import { publishCore, type PublishMode, type PublishResult } from "@/lib/kb-write/publish-core";
import { isUnifiedDocsEnabled } from "./config";
import { addPublication, getDocument, getPublication, listVersions } from "./store";

export async function publishDocument(
  db: DatabaseType,
  input: { id: string; ownerEmail: string; ownerName?: string | null; mode: PublishMode },
): Promise<PublishResult> {
  const { id, ownerEmail, mode } = input;

  if (!isUnifiedDocsEnabled()) {
    return { ok: false, status: 404, error: "publishing is not enabled" };
  }
  if (!effectiveCanWrite(ownerEmail)) {
    return { ok: false, status: 403, error: "you do not have permission to publish to the knowledge base" };
  }
  if (mode === "direct" && !can(ownerEmail, "approve")) {
    return { ok: false, status: 403, error: "a direct publish requires the approver role" };
  }

  try {
    const document = getDocument(db, id);
    if (!document || document.ownerEmail !== ownerEmail) {
      return { ok: false, status: 404, error: "document not found" };
    }
    const publication = getPublication(db, id);
    if (!publication || publication.status !== "ready") {
      return { ok: false, status: 409, error: "only a ready document can be published" };
    }
    if (!publication.targetPath) {
      return { ok: false, status: 409, error: "the document has no target path" };
    }
    const normalized = normalizeTargetInput(publication.targetPath);
    if (!normalized.ok) {
      return { ok: false, status: 400, error: normalized.error };
    }

    const writeToken = process.env.REPO_WRITE_TOKEN?.trim();
    if (!writeToken) {
      return { ok: false, status: 503, error: "write_unavailable" };
    }

    const message = `Publish document: ${document.title}`;
    const body = listVersions(db, id).at(-1)?.body ?? "";
    const result = await publishCore({
      worktreeKey: `document-${id}`,
      title: document.title,
      body,
      visibility: publication.targetVisibility ?? ["all-hands"],
      targetRel: normalized.rel,
      mode,
      ownerEmail,
      ownerName: input.ownerName,
      writeToken,
      commitMessage: message,
      slug: slugifyTitle(document.title),
      mrDescription: `Publishing the document "${document.title}" to `,
    });
    if (!result.ok) {
      return result.error === "failed to publish" ? { ...result, error: "failed to publish document" } : result;
    }

    addPublication(db, {
      docId: id,
      status: "published",
      targetPath: publication.targetPath,
      targetVisibility: publication.targetVisibility,
      publishedNotePath: result.notePath,
    });
    return result;
  } catch (error) {
    return { ok: false, status: 500, error: error instanceof Error ? error.message : "failed to publish document" };
  }
}
