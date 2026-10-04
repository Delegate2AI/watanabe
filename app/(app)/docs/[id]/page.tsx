import { headers } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { getDb } from "@/lib/db/client";
import { getSharedDoc, latestVersionOf, listComments, listShares, listLinks } from "@/lib/db/shared-docs";
import { getIdentity } from "@/lib/auth/identity";
import { accessFor, canRead, canComment, canEdit, canManage } from "@/lib/shared-docs/access";
import {
  isSharedDocsEnabled,
  isExternalShareEnabled,
  isDocAnnotationsEnabled,
  isSharedDocPublishEnabled,
  isDocAccessRequestsEnabled,
  isDocCopilotEnabled,
} from "@/lib/shared-docs/config";
import { latestThreadForDoc } from "@/lib/db/doc-threads";
import { getPending, listPending } from "@/lib/db/doc-access-requests";
import { getPublication } from "@/lib/db/shared-doc-publications";
import { effectiveCanWrite } from "@/lib/authority/write-gate";
import { can } from "@/lib/authority/roles";
import { visibilityOptionsFor } from "@/lib/authority/visibility-options";
import { resolveClearanceForEmail } from "@/lib/identity/resolve";
import { kbTargetOptions } from "@/lib/kb/target-options";
import { vaultRootFor } from "@/lib/repo";
import { PublishCard } from "@/components/docs/publish-card";
import { isRichEditorEnabled } from "@/lib/markdown/config";
import { listThreads } from "@/lib/db/comment-threads";
import { listSuggestions } from "@/lib/db/suggestions";
import { shareOptionsFor } from "@/lib/shared-docs/share-options";
import { shareClearanceFor } from "@/lib/shared-docs/clearance";
import { resolvePeople } from "@/lib/people/resolve";
import { AccessPill } from "@/components/docs/access-pill";
import { DocEditor } from "@/components/docs/doc-editor";
import { CommentsPanel } from "@/components/docs/comments-panel";
import { AnnotatedDoc } from "@/components/docs/annotated-doc";
import { ShareDialog } from "@/components/docs/share-dialog";
import { RequestAccess } from "@/components/docs/request-access";
import { AccessRequestsPanel } from "@/components/docs/access-requests-panel";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * The shared-doc detail page (spec 28). ACL-gated server-side: the caller's
 * effective access is resolved through `accessFor`, and anything short of read
 * (a stranger, an unknown id, or flag-off) is `notFound()` so there is no
 * existence oracle. Each affordance is rendered strictly by capability: the
 * comments panel only for comment/edit, the edit toggle only for edit, the share
 * manager only for the owner. The routes these call re-check authorization too.
 */
export default async function SharedDocDetailPage({ params }: { params: Promise<{ id: string }> }) {
  if (!isSharedDocsEnabled()) notFound();
  const { id } = await params;
  // Identity-only: shared-doc access is an explicit ACL, so this surface still
  // must not resolveIdentity and inherit KB clearance wholesale. Team grants go
  // through `shareClearanceFor`, which is flag-gated and only ever decides which
  // explicit share rows are addressed to this reader (see `access.ts`).
  const identity = await getIdentity(await headers());
  if (!identity) notFound();

  const access = accessFor(getDb(), id, identity.email, shareClearanceFor(identity.email));
  const doc = getSharedDoc(getDb(), id);

  // No access, but the id resolves: offer to ask the owner rather than claiming
  // the document does not exist. This is the one place the no-oracle rule is
  // relaxed, it is what the flag gates, and it discloses existence only. An
  // unknown id stays a 404 here as everywhere else.
  if (!canRead(access)) {
    if (!doc || !isDocAccessRequestsEnabled()) notFound();
    return <RequestAccess docId={id} standing={getPending(getDb(), id, identity.email)} />;
  }
  if (!doc) notFound();

  // Body AND format: a designed page promoted here is a whole HTML document,
  // and the markdown renderer discards raw HTML rather than printing it.
  const latest = latestVersionOf(getDb(), id);
  const body = latest?.body ?? "";
  const format = latest?.format ?? "md";
  const comments = canComment(access) ? listComments(getDb(), id) : [];
  const owner = canManage(access);
  const threads = canComment(access) ? listThreads(getDb(), id) : [];
  const suggestions = canComment(access) ? listSuggestions(getDb(), id) : [];
  const shares = owner ? listShares(getDb(), id) : [];
  const accessRequests = owner && isDocAccessRequestsEnabled() ? listPending(getDb(), id) : [];

  // Every address these surfaces will render, resolved once, here: <PersonChip>
  // takes an already-resolved person and the resolver reaches `node:fs`, which a
  // client island may not import.
  const people = resolvePeople(
    [
      // The viewer, always, even when nothing of theirs is on this doc yet. The
      // panels add a row client-side when they comment, and an address missing
      // from this map renders as the raw address: their first comment on an
      // empty doc was attributed to their email until the next full page load.
      identity.email,
      ...comments.map((c) => c.authorEmail),
      ...threads.flatMap((t) => t.messages.map((m) => m.authorEmail)),
      ...suggestions.map((s) => s.createdBy),
      // Team rows name a group, not a person, so they contribute no address here.
      ...shares.filter((s) => s.recipientKind === "user").map((s) => s.recipient),
      ...accessRequests.map((r) => r.requesterEmail),
    ],
    { viewerEmail: identity.email },
  );

  return (
    // Wider than the max-w-5xl every other detail page uses, because this one
    // carries the 17rem comments rail inside the same container: at 5xl the
    // rail was taxing the reading column, leaving the document narrower than
    // any comparable page (see docs-width.test.ts).
    <div className="mx-auto w-full max-w-7xl px-6 pb-16 pt-6">
      <Link href="/docs" className="mb-4 inline-flex items-center gap-1 text-sm text-ink-muted hover:text-ink">
        <ChevronLeft className="size-4" aria-hidden />
        All shared docs
      </Link>
      <header className="mb-5 flex flex-wrap items-center gap-3">
        <h1 className="min-w-0 flex-1 truncate text-xl font-semibold text-ink">{doc.title}</h1>
        <AccessPill access={access} />
        {owner && (
          <ShareDialog
            id={id}
            title={doc.title}
            initialShares={shares}
            initialLinks={isExternalShareEnabled() ? listLinks(getDb(), id) : []}
            externalEnabled={isExternalShareEnabled()}
            // Teams and people are resolved here because the picker is a client
            // island: `shareOptionsFor` reaches the access registry and the
            // people directory, both of which are server-only.
            options={shareOptionsFor(identity.email)}
            people={people}
          />
        )}
      </header>

      {/* Above the document, not inside the share dialog: an ask waits on the
          owner opening a dialog they have no reason to open. */}
      <AccessRequestsPanel docId={id} initialRequests={accessRequests} people={people} />

      {/* An HTML document takes the DocEditor branch whatever the annotations
          flag says: its body is a whole page rendered inside a sandboxed frame,
          where a text selection is not reachable, so there is nothing for the
          annotate surface to anchor to. */}
      {isDocAnnotationsEnabled() && format !== "html" ? (
        <AnnotatedDoc
          doc={{ id, body }}
          access={{ canComment: canComment(access), canEdit: canEdit(access) }}
          initialThreads={threads}
          initialSuggestions={suggestions}
          people={people}
          richEditorEnabled={isRichEditorEnabled()}
          // Copilot (spec 2026-08-27): comment tier and up, markdown only
          // (this branch already excludes HTML). The route re-checks both.
          copilotEnabled={isDocCopilotEnabled() && canComment(access)}
          docTitle={doc.title}
          copilotThreadId={
            isDocCopilotEnabled() && canComment(access) ? latestThreadForDoc(getDb(), id, identity.email) : null
          }
        />
      ) : (
        <>
          <DocEditor
            id={id}
            initialBody={body}
            format={format}
            canEdit={canEdit(access)}
            richEditorEnabled={isRichEditorEnabled()}
          />
          {canComment(access) && (
            <div className="mt-10">
              <CommentsPanel id={id} initialComments={comments} canComment={canComment(access)} people={people} />
            </div>
          )}
        </>
      )}

      {/* Owner-only, like the share dialog above it: publishing puts the
          document in the canonical vault under the owner's name, which a
          recipient with edit access does not get to do. The route re-checks. */}
      {owner && isSharedDocPublishEnabled() && effectiveCanWrite(identity.email) ? (
        <div className="mt-10">
          <PublishCard
            docId={id}
            docTitle={doc.title}
            publication={getPublication(getDb(), id)}
            // Resolved here for the same reason the share options are: the
            // picker is a client island and this reaches the access registry.
            // KB clearance, resolved explicitly for this one control rather than
            // by widening the page's identity call. The docblock above is about
            // shared-doc ACCESS, which must never inherit KB clearance; choosing
            // which groups a KB note may be filed at is the opposite question,
            // and answering it from the ACL would offer groups the publisher is
            // not in. The same clearance scopes the destination picker: a folder
            // or note the publisher cannot see is absent, not locked.
            targets={kbTargetOptions(vaultRootFor(resolveClearanceForEmail(identity.email)))}
            visibilityOptions={visibilityOptionsFor(
              resolveClearanceForEmail(identity.email),
              identity.email,
              { isAdmin: can(identity.email, "manageAccess") },
            )}
            canPublishDirect={can(identity.email, "approve")}
          />
        </div>
      ) : null}
    </div>
  );
}
