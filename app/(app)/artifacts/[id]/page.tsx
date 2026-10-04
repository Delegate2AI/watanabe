import { headers } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { ArtifactEditor } from "@/components/artifacts/artifact-editor";
import { getDb } from "@/lib/db/client";
import { getArtifactForOwner, getVersions, latestBody } from "@/lib/db/artifacts";
import { resolveIdentity } from "@/lib/identity/resolve";
import { isArtifactsEnabled, isArtifactPublishEnabled } from "@/lib/artifacts/config";
import { targetFoldersForRoot } from "@/lib/artifacts/target-folders";
import { isRichEditorEnabled } from "@/lib/markdown/config";
import { effectiveCanWrite } from "@/lib/authority/write-gate";
import { can } from "@/lib/authority/roles";
import { visibilityOptionsFor } from "@/lib/authority/visibility-options";
import { sourceNoteExists } from "@/lib/kb/source-note";
import { vaultRootFor } from "@/lib/repo";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * The artifact detail/editor page (spec 27). Owner-scoped: an artifact owned by
 * someone else, an unknown id, and (flag-off) any id all resolve to `notFound()`
 * so there is no existence oracle. Publish gating (spec 22) is computed here on
 * the server and passed to the editor: the Publish controls only render for a
 * writer, and direct publish only for an approver.
 */
export default async function ArtifactDetailPage({ params }: { params: Promise<{ id: string }> }) {
  if (!isArtifactsEnabled()) notFound();
  const { id } = await params;
  const identity = await resolveIdentity(await headers());
  if (!identity) notFound();

  const artifact = getArtifactForOwner(getDb(), id, identity.email);
  if (!artifact) notFound();

  const body = latestBody(getDb(), id, identity.email) ?? "";
  const versions = getVersions(getDb(), id, identity.email);
  const canPublish = isArtifactPublishEnabled() && effectiveCanWrite(identity.email);
  const canPublishDirect = canPublish && can(identity.email, "approve");
  const visibilityOptions = visibilityOptionsFor(identity.clearance, identity.email, {
    isAdmin: can(identity.email, "manageAccess"),
  });
  const targetFolders = targetFoldersForRoot(vaultRootFor(identity.clearance));
  // An artifact aimed at a note that ALREADY exists is an edit, and an edit does
  // not get to choose who may read what it edits: `publishCore` carries that
  // note's own frontmatter through and never consults the value stored here.
  // Offering the picker would therefore be a control that silently does nothing,
  // so the panel shows the inherited groups as read-only instead. Derived at
  // render time from the note's presence, which is why no column records it.
  const visibilityLocked =
    artifact.targetPath !== null && sourceNoteExists(artifact.targetPath, identity.clearance);

  return (
    <div className="mx-auto max-w-5xl px-8 pb-14 pt-12">
      <Link
        href="/artifacts"
        className="mb-6 inline-flex items-center gap-1 text-sm text-ink-muted hover:text-ink"
      >
        <ChevronLeft className="size-4" aria-hidden />
        All artifacts
      </Link>
      <ArtifactEditor
        artifact={{
          id: artifact.id,
          title: artifact.title,
          status: artifact.status,
          targetPath: artifact.targetPath,
          targetVisibility: artifact.targetVisibility,
          publishedNotePath: artifact.publishedNotePath,
          mrUrl: artifact.mrUrl,
        }}
        body={body}
        versions={versions}
        visibilityOptions={visibilityOptions}
        visibilityLocked={visibilityLocked}
        targetFolders={targetFolders}
        canPublish={canPublish}
        canPublishDirect={canPublishDirect}
        richEditorEnabled={isRichEditorEnabled()}
      />
    </div>
  );
}
