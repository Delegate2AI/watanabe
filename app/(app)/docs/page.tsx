import { headers } from "next/headers";
import { Share2 } from "lucide-react";
import { RouteScaffold } from "@/components/shell/route-scaffold";
import { PageHeader } from "@/components/kit/page-header";
import { SharedDocList } from "@/components/docs/shared-doc-list";
import { NewSharedDoc } from "@/components/docs/new-shared-doc";
import { DocDropZone } from "@/components/docs/doc-drop-zone";
import { getDb } from "@/lib/db/client";
import { listSharedByOwner, listSharedWith } from "@/lib/db/shared-docs";
import { shareClearanceFor } from "@/lib/shared-docs/clearance";
import { getIdentity } from "@/lib/auth/identity";
import { resolvePeople } from "@/lib/people/resolve";
import { isDocImportEnabled, isSharedDocsEnabled } from "@/lib/shared-docs/config";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const EYEBROW = "My Shared Docs";
const TITLE = "Shared with people";
const DESCRIPTION =
  "Documents you handed directly to specific teammates, outside the knowledge base. Open one to manage who can view, comment, or edit it.";

/**
 * The My Shared Docs surface (spec 28), filling the spec-18 scaffold. Flag-off it
 * renders the identical empty scaffold as before, so the byte-path is unchanged.
 * On: the caller's two groups (docs they own, docs shared with them), each read
 * owner/recipient-scoped so no group can surface another user's private docs.
 */
export default async function SharedDocsPage() {
  if (!isSharedDocsEnabled()) {
    return (
      <RouteScaffold icon={Share2} eyebrow={EYEBROW} title={TITLE} description={DESCRIPTION} spec="spec 28" flag="SHARED_DOCS_ENABLED" />
    );
  }

  // Identity-only: shared-doc access is an explicit ACL, so this surface still
  // must not resolveIdentity and inherit spec-19 KB clearance wholesale. Team
  // grants are resolved through `shareClearanceFor`, which is flag-gated and
  // only ever decides which explicit share rows are addressed to this reader.
  const identity = await getIdentity(await headers());
  const clearance = identity ? shareClearanceFor(identity.email) : [];
  const sharedByMe = identity
    ? listSharedByOwner(getDb(), identity.email).map((d) => ({ id: d.id, title: d.title, updatedAt: d.updatedAt }))
    : [];
  const sharedWithMe = identity
    ? listSharedWith(getDb(), identity.email, clearance).map((d) => ({
        id: d.id,
        title: d.title,
        ownerEmail: d.ownerEmail,
        access: d.access,
        updatedAt: d.updatedAt,
      }))
    : [];

  // People render through <PersonChip>, which takes an already-resolved person:
  // the resolver reads the directory from disk, so it must run here and not in
  // the client island.
  const people = resolvePeople(
    sharedWithMe.map((d) => d.ownerEmail),
    identity ? { viewerEmail: identity.email } : {},
  );

  const pageHeader = <PageHeader icon={Share2} eyebrow={EYEBROW} title={TITLE} description={DESCRIPTION} />;
  const list = <SharedDocList sharedByMe={sharedByMe} sharedWithMe={sharedWithMe} people={people} />;

  return (
    <div className="mx-auto max-w-5xl px-8 pb-14 pt-16">
      {/* Flag-off the island is not rendered at all, so no importer JavaScript
          reaches the client. Flag-on, DocDropZone owns the header row so its
          Upload button sits beside New document, while the drop target still
          wraps only the list, so a dropped file cannot land on the buttons. */}
      {isDocImportEnabled() ? (
        <DocDropZone header={pageHeader} actions={<NewSharedDoc />}>
          {list}
        </DocDropZone>
      ) : (
        <>
          <div className="flex items-start justify-between gap-4">
            {pageHeader}
            {/* The page told people to create a document and offered no way to
                do it; the only control here was the filter box. */}
            <div className="shrink-0 pt-1">
              <NewSharedDoc />
            </div>
          </div>
          {list}
        </>
      )}
    </div>
  );
}
