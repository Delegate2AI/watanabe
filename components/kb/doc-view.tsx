import { Fragment, type ReactNode } from "react";
import { PersonChip } from "@/components/person-chip";
import { VisibilityChip } from "@/components/kit/visibility-chip";
import { isPeopleEnabled } from "@/lib/people/config";
import { resolvePerson } from "@/lib/people/resolve";
import { formatDate } from "@/lib/ui/date";
import { renderMarkdown } from "@/lib/kb/markdown";
import type { Note } from "@/lib/kb/note";
import type { Backlink } from "@/lib/kb/backlinks";
import type { WikilinkResolver } from "@/lib/kb/wikilinks";
import type { KbAssetResolver } from "@/lib/kb/assets";
import { Backlinks } from "./backlinks";
import { DocActions, type DocActionCapabilities } from "./doc-actions";
import { MeetingTasks, type MeetingTaskItem } from "./meeting-tasks";

/**
 * The KB document view (spec 25): a frontmatter header (title, type, updated,
 * owner, VisibilityChip) over the sanitized markdown body, with a "Referenced
 * by" panel. A server component. The note it renders always came through the
 * clearance-scoped resolver, so a restricted note here is one the requester is
 * cleared for; a note they are not cleared for 404s before reaching this view.
 */
export function DocView({
  note,
  relPath,
  dirSlug,
  resolveWikilink,
  resolveAsset,
  backlinks,
  actions,
  meetingTasks,
}: {
  note: Note;
  relPath: string;
  dirSlug: string[];
  resolveWikilink: WikilinkResolver;
  resolveAsset: KbAssetResolver;
  backlinks: Backlink[];
  actions?: DocActionCapabilities;
  /** The live tasks a meeting note produced; absent or empty renders nothing. */
  meetingTasks?: MeetingTaskItem[];
}) {
  const updated = note.updated ? `Updated ${formatDate(note.updated)}` : undefined;
  const meta: ReactNode[] = [note.type, updated, ownerNode(note.owner)].filter(Boolean);

  return (
    <article className="mx-auto w-full max-w-3xl px-6 py-8">
      <header className="mb-6 border-b border-line-soft pb-4">
        <div className="mb-2 flex items-center gap-2">
          <VisibilityChip visibility={note.visibility} group={note.group} />
        </div>
        <h1 className="text-2xl font-semibold tracking-tight text-ink">{note.title}</h1>
        {meta.length > 0 && (
          <p className="mt-1.5 text-[13px] text-ink-faint">
            {meta.map((part, index) => (
              <Fragment key={index}>
                {index > 0 ? " · " : null}
                {part}
              </Fragment>
            ))}
          </p>
        )}
        {actions ? (
          <DocActions
            title={note.title}
            body={note.body}
            relPath={relPath}
            capabilities={actions}
          />
        ) : null}
      </header>

      <div className="md">
        {renderMarkdown(note.body, {
          title: note.title,
          currentDirSlug: dirSlug,
          currentRelPath: relPath,
          resolveWikilink,
          resolveAsset,
        })}
      </div>

      <MeetingTasks tasks={meetingTasks ?? []} />
      <Backlinks links={backlinks} />
    </article>
  );
}

/**
 * The byline. A frontmatter `owner` is free text: usually an address, sometimes
 * a name, occasionally a team. Only an address goes through the directory, and
 * only with the flag on, so flag-off this renders the exact string the note
 * carries, byte for byte, as it always did.
 *
 * This is a server component, which is the only reason it may call the resolver
 * at all: `resolvePerson` reads the directory from disk.
 */
function ownerNode(owner: string | undefined): ReactNode {
  if (!owner) return undefined;
  if (!isPeopleEnabled() || !owner.includes("@")) return owner;
  return <PersonChip person={resolvePerson(owner)} className="inline" />;
}
