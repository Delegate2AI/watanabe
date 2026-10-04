import type { Database as DatabaseType } from "better-sqlite3";
import { listThreadsForOwner } from "@/lib/db/threads";
import { listArtifactsForOwner } from "@/lib/db/artifacts";
import { listSharedByOwner, listSharedWith } from "@/lib/db/shared-docs";
import { shareClearanceFor } from "@/lib/shared-docs/clearance";
import { getForRequester } from "@/lib/db/tasks";
import { listMeetingNotes } from "@/lib/meetings/list";
import { searchKb } from "@/lib/kb/search";
import { snippetFor, toPlainText } from "@/lib/kb/snippet";
import { vaultRootFor } from "@/lib/repo";
import { isArtifactsEnabled } from "@/lib/artifacts/config";
import { isSharedDocsEnabled } from "@/lib/shared-docs/config";
import { isMeetingsEnabled } from "@/lib/meetings/config";
import { isTasksEnabled } from "@/lib/tasks/config";
import { isPeopleEnabled } from "@/lib/people/config";
import { resolvePeople } from "@/lib/people/resolve";
import { assignableMembers, loadGroups } from "@/lib/authority/groups";

/**
 * Global search across everything the caller is cleared for (chats, KB, files,
 * meetings, tasks), for the command palette. Every source is scoped to the
 * caller's ownership or clearance, so a result can never surface something they
 * could not otherwise open. A source is only included when its feature flag is
 * on; flag-off sources are simply absent (INDEX/artifacts/shared-docs/meetings/
 * tasks). KB search is injectable so the fan-out is unit-testable without a
 * vault on disk.
 */
export interface SearchItem {
  title: string;
  href: string;
  snippet?: string;
}

export interface SearchGroup {
  label: string;
  items: SearchItem[];
}

export interface SearchContext {
  db: DatabaseType;
  email: string;
  clearance: string[];
}

export interface SearchDeps {
  kbSearch: (query: string, clearance: string[]) => Promise<SearchItem[]>;
}

const PER_GROUP = 6;

function defaultKbSearch(query: string, clearance: string[]): Promise<SearchItem[]> {
  return searchKb(query, vaultRootFor(clearance)).then((rows) =>
    rows.map((row) => ({ title: row.title, href: `/kb/${row.route}`, snippet: row.snippet })),
  );
}

function matcher(query: string): (text: string | null | undefined) => boolean {
  const q = query.trim().toLowerCase();
  return (text) => (text ?? "").toLowerCase().includes(q);
}

/**
 * A non-KB row's snippet, reduced the same way a KB snippet is: markdown out,
 * window centered on the query. A row with no body text keeps no snippet.
 */
function describe(body: string | null | undefined, query: string): string | undefined {
  const plain = toPlainText(body ?? "");
  return plain === "" ? undefined : snippetFor(plain, query).text;
}

export async function globalSearch(
  query: string,
  ctx: SearchContext,
  deps: SearchDeps = { kbSearch: defaultKbSearch },
): Promise<SearchGroup[]> {
  const trimmed = query.trim();
  if (trimmed === "") return [];
  const hit = matcher(trimmed);
  const groups: SearchGroup[] = [];

  // Knowledge base (full-text, clearance-scoped).
  const kb = await deps.kbSearch(trimmed, ctx.clearance).catch(() => [] as SearchItem[]);
  if (kb.length > 0) groups.push({ label: "Knowledge base", items: kb.slice(0, PER_GROUP) });

  // Chats (owner-scoped): match the thread title.
  const chats = listThreadsForOwner(ctx.db, ctx.email)
    .filter((thread) => hit(thread.title))
    .slice(0, PER_GROUP)
    .map((thread) => ({ title: thread.title ?? "Untitled chat", href: `/chat/${thread.sdkSessionId}` }));
  if (chats.length > 0) groups.push({ label: "Chats", items: chats });

  // Artifacts (owner-scoped).
  if (isArtifactsEnabled()) {
    const artifacts = listArtifactsForOwner(ctx.db, ctx.email)
      .filter((a) => hit(a.title))
      .slice(0, PER_GROUP)
      .map((a) => ({ title: a.title, href: `/artifacts/${a.id}` }));
    if (artifacts.length > 0) groups.push({ label: "Artifacts", items: artifacts });
  }

  // Shared docs (ACL-scoped): docs the caller owns or that are shared with them.
  if (isSharedDocsEnabled()) {
    const owned = listSharedByOwner(ctx.db, ctx.email);
    const withMe = listSharedWith(ctx.db, ctx.email, shareClearanceFor(ctx.email));
    const seen = new Set<string>();
    const docs = [...owned, ...withMe]
      .filter((d) => hit(d.title) && !seen.has(d.id) && (seen.add(d.id), true))
      .slice(0, PER_GROUP)
      .map((d) => ({ title: d.title, href: `/docs/${d.id}` }));
    if (docs.length > 0) groups.push({ label: "Shared docs", items: docs });
  }

  // Meetings (clearance-scoped, file-backed).
  if (isMeetingsEnabled()) {
    const meetings = listMeetingNotes(ctx.clearance)
      .filter((m) => hit(m.title))
      .slice(0, PER_GROUP)
      .map((m) => ({ title: m.title, href: m.href }));
    if (meetings.length > 0) groups.push({ label: "Meetings", items: meetings });
  }

  // Tasks (clearance-scoped): match title or description. A result names one
  // task, so it links to that task rather than dropping the caller on the list
  // to find it again.
  if (isTasksEnabled()) {
    const tasks = getForRequester(ctx.db, ctx.email, ctx.clearance)
      .filter((t) => hit(t.title) || hit(t.description))
      .slice(0, PER_GROUP)
      .map((t) => ({
        title: t.title,
        href: `/tasks/${encodeURIComponent(t.id)}`,
        snippet: describe(t.description, trimmed),
      }));
    if (tasks.length > 0) groups.push({ label: "Tasks", items: tasks });
  }

  // People, ordered ahead of content: searching a colleague's name only worked
  // before because these emails happen to contain names. A real mchen@ account
  // was unfindable. Only when the directory is on; flag-off has no section.
  if (isPeopleEnabled()) {
    const roster = assignableMembers(loadGroups());
    const people = resolvePeople(roster, { viewerEmail: ctx.email });
    const matches = roster
      .filter((email) => hit(email) || hit(people[email]?.name ?? ""))
      .slice(0, PER_GROUP)
      .map((email) => ({
        title: people[email]?.name ?? email,
        href: "/admin/access",
        snippet: email,
      }));
    if (matches.length > 0) groups.unshift({ label: "People", items: matches });
  }

  return groups;
}
