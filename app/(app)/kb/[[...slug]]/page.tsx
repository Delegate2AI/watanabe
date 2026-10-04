import { notFound, redirect } from "next/navigation";
import { requesterKbRoots } from "@/lib/kb/request";
import { resolveKbDoc } from "@/lib/kb/resolve";
import { buildKbTree } from "@/lib/kb/tree";
import { buildWikilinkResolver } from "@/lib/kb/files";
import { buildKbAssetResolver } from "@/lib/kb/assets";
import { backlinksFor } from "@/lib/kb/backlinks";
import { parseNote } from "@/lib/kb/note";
import { readVaultFile, resolveVaultEntry } from "@/lib/vault";
import { kbAssetHref } from "@/lib/kb/asset-href";
import { loadGroups } from "@/lib/authority/groups";
import { effectiveCanWrite } from "@/lib/authority/write-gate";
import { isKbProposeEditEnabled } from "@/lib/artifacts/config";
import { isKbGraphEnabled } from "@/lib/kb/graph-config";
import { isKbDeleteEnabled } from "@/lib/review/config";
import { isTasksEnabled } from "@/lib/tasks/config";
import { getDb } from "@/lib/db/client";
import { listVisibleByMeeting } from "@/lib/db/tasks";
import type { Note } from "@/lib/kb/note";
import type { MeetingTaskItem } from "@/components/kb/meeting-tasks";
import { KbLayout } from "@/components/kb/kb-layout";
import { DocView } from "@/components/kb/doc-view";
import { KbRootGraph } from "@/components/kb/kb-root-graph";
import { SearchBox } from "@/components/kb/search-box";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * The knowledge-base view (spec 25). Document bodies are read only through
 * `readRoot` (`vaultRootFor(clearance)`): a note the requester is not cleared
 * for is absent from that projection, so it 404s, identical to "does not
 * exist". Absence is the boundary; there is no per-file check here. In manage
 * mode (admin + `KB_ACCESS_UI_ENABLED`), the TREE alone switches to
 * `treeRoot` (the unfiltered vault) so an admin can see and manage files
 * outside their own clearance; body reads never widen.
 */
export default async function KbPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug?: string[] }>;
  searchParams: Promise<{ manage?: string }>;
}) {
  const { slug } = await params;
  // `manage` was declared in the props type but never read, so the admin
  // manage-access mode shipped unreachable: the sidebar toggle never rendered,
  // ?manage=1 was inert, and the tree always came from the read root. Folder
  // level bulk access management has no other entry point.
  const manageRequested = (await searchParams)?.manage === "1";
  const { treeRoot, readRoot, isAdmin, email, clearance } = await requesterKbRoots(manageRequested);
  const manage = manageRequested && isAdmin;

  // A non-`.md` file (an image, PDF, ...) is not a document: hand it to the API
  // route that serves its bytes with the right Content-Type, instead of feeding
  // the binary through the markdown renderer as garbled text. A missing path or
  // one absent from the requester's projection falls through to `notFound()`
  // below, indistinguishable from "does not exist": no existence oracle.
  // The path the manage-access toggle links back to, so entering and leaving
  // the mode both keep the note the reader has open.
  const basePath = `/kb${(slug ?? []).map((segment) => `/${encodeURIComponent(segment)}`).join("")}`;

  const entry = resolveVaultEntry(slug, readRoot);
  if (entry && !entry.isDirectory && !entry.relPath.toLowerCase().endsWith(".md")) {
    redirect(kbAssetHref(entry.relPath));
  }

  const resolution = resolveKbDoc(slug, readRoot);
  const tree = buildKbTree(treeRoot);
  const groups = isAdmin ? Object.keys(loadGroups()) : [];
  // Propose an edit was withheld until it could round-trip a note safely. All
  // three preconditions now hold, each in the one place that makes it a property
  // rather than a habit (spec 2026-08-11):
  //
  //  - the draft is seeded from the SOURCE note, not this projection, so the
  //    link deletions a projection performs cannot travel into a diff and read
  //    as the author's own edit (`lib/kb/source-note.ts`);
  //  - publishing over an existing note preserves that note's frontmatter, so
  //    owner, updated, tags and a non-`note` type survive an edit
  //    (`lib/kb-write/existing-note.ts`);
  //  - visibility is read off the live note and is not a parameter of that
  //    merge, so no publisher can widen a restricted note, and an unparseable
  //    header is refused instead of republished as all-hands.
  //
  // The role check is still the gate on WHO may propose: reading a note has
  // never implied being able to write one.
  const canProposeEdit = isKbProposeEditEnabled() && effectiveCanWrite(email);
  // No longer per-path: the visibility a proposed edit lands at is read off the
  // live note at publish time, so there is nothing for this page to resolve and
  // nothing for the client to send.
  // Delete proposes a removal through the write path, so it is admin-only and
  // dies with its flag. Nothing on the client re-derives it.
  const canDelete = isKbDeleteEnabled() && isAdmin;
  const actions = { canProposeEdit, isAdmin, canDelete, groups, requesterEmail: email };
  // Built once per request from the clearance-scoped root, like the wikilink
  // resolver: it maps an embedded image's authored src to the real vault asset.
  const resolveAsset = buildKbAssetResolver(readRoot);

  // No document at this path. `notFound()` so the response really is a 404
  // (returning a pane from here would send 200, and every link checker, cache
  // and monitor would record a broken KB URL as healthy). The reader is not
  // stranded by it: `not-found.tsx` beside this file renders the tree and the
  // search box, so there is always a next click. Still no existence oracle,
  // since a note absent from the requester's projection lands there identically
  // to one that never existed.
  if (!resolution) notFound();

  // A directory (or the vault root): render its landing note if one exists,
  // otherwise a prompt to pick a note. The tree stays visible either way.
  if (resolution.kind === "dir") {
    const landing = landingNote(resolution.relPath, readRoot);
    // The vault root is the KB's front door, so it opens on the graph (when
    // the flag is on) instead of a bare "pick a note" prompt. A curated
    // landing note still renders below it; deeper directories are unchanged.
    const rootGraph = resolution.relPath === "" && isKbGraphEnabled();
    return (
      <KbLayout tree={tree} activeRoute={landing ? landing.route : ""} manage={manage} isAdmin={isAdmin} groups={groups} basePath={basePath}>
        <div className="border-b border-line-soft p-3">
          <SearchBox />
        </div>
        {rootGraph && <KbRootGraph />}
        {landing ? (
          <DocView
            note={landing.note}
            relPath={landing.relPath}
            dirSlug={landing.relPath.split("/").slice(0, -1)}
            resolveWikilink={buildWikilinkResolver(readRoot)}
            resolveAsset={resolveAsset}
            backlinks={backlinksFor(landing.relPath, readRoot)}
            actions={actions}
            meetingTasks={meetingTasksFor(landing.note, email, clearance)}
          />
        ) : rootGraph ? null : (
          <p className="mx-auto max-w-3xl px-6 py-10 text-[15px] text-ink-faint">
            Select a document from the tree.
          </p>
        )}
      </KbLayout>
    );
  }

  const activeRoute = resolution.relPath.replace(/\.md$/i, "");
  return (
    <KbLayout tree={tree} activeRoute={activeRoute} manage={manage} isAdmin={isAdmin} groups={groups} basePath={basePath}>
      <div className="border-b border-line-soft p-3">
        <SearchBox />
      </div>
      <DocView
        note={resolution.note}
        relPath={resolution.relPath}
        dirSlug={resolution.relPath.split("/").slice(0, -1)}
        resolveWikilink={buildWikilinkResolver(readRoot)}
        resolveAsset={resolveAsset}
        backlinks={backlinksFor(resolution.relPath, readRoot)}
        actions={actions}
        meetingTasks={meetingTasksFor(resolution.note, email, clearance)}
      />
    </KbLayout>
  );
}

/**
 * The live tasks a meeting note produced, for the "Action items" panel (spec
 * 2026-08-17-kb-task-links-design). Only a note with `type: meeting` and a
 * `source:` citation qualifies; the query composes the full task-visibility
 * predicate per requester, so this can only ever narrow what the note itself
 * already showed them. Any other note (or the tasks subsystem switched off)
 * passes nothing and renders byte-identically to before.
 */
function meetingTasksFor(note: Note, email: string, clearance: string[]): MeetingTaskItem[] | undefined {
  if (note.type !== "meeting" || !note.source) return undefined;
  if (!isTasksEnabled()) return undefined;
  return listVisibleByMeeting(getDb(), note.source, email, clearance).map((task) => ({
    id: task.id,
    title: task.title,
    status: task.status,
    assigneeEmail: task.assigneeEmail,
  }));
}

/** The README/INDEX landing note inside a directory, if present in the projection. */
function landingNote(dirRel: string, root: string) {
  for (const name of ["README.md", "INDEX.md"]) {
    const rel = dirRel === "" ? name : `${dirRel}/${name}`;
    const entry = resolveVaultEntry(rel.split("/"), root);
    if (!entry || entry.isDirectory) continue;
    const content = readVaultFile(entry.relPath, root);
    if (content === null) continue;
    return { relPath: entry.relPath, route: entry.relPath.replace(/\.md$/i, ""), note: parseNote(entry.relPath, content) };
  }
  return null;
}
