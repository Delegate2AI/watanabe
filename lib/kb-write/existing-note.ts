import { parseDocument } from "yaml";
import { splitBody } from "@/lib/kb/note";

export type MergeResult = { ok: true; note: string } | { ok: false; error: string };

/**
 * Rewrite an EXISTING KB note's body while carrying its frontmatter through
 * unchanged, except for `title`.
 *
 * Why this exists: `buildPublishedNote` re-emits a header of exactly three keys
 * (title, type, visibility) built from the publisher's own values. That is right
 * for a NEW note, where the publisher is the author and there is nothing to
 * preserve. Aimed at a note that already exists it is destructive twice over: it
 * drops every other key the note carried (owner, updated, tags, a non-`note`
 * type), and it overwrites `visibility` with whatever the publisher's picker
 * held. The second one is a clearance decision made by the wrong party, which is
 * why "Propose an edit" was withheld rather than shipped
 * (`app/(app)/kb/[[...slug]]/page.tsx`).
 *
 * So visibility is not a parameter here. An edit to an existing note changes
 * prose, never who may read it: that has its own paths (the KB access modal and
 * meeting re-clearance), each of which requires a role this one does not.
 *
 * Unparseable frontmatter FAILS rather than falling back. A note whose header
 * cannot be read is visible to admins alone, and the old code path would have
 * republished it as `all-hands`: failing open on exactly the decision this
 * module exists to protect. Refusing costs an admin one manual edit; failing
 * open publishes a restricted note to everyone.
 */
export function mergeIntoExistingNote(p: { existing: string; title: string; body: string }): MergeResult {
  const body = splitBody(p.body.replace(/^﻿/, "")).replace(/^\n+/, "").trimEnd();
  const match = p.existing.match(/^---\r?\n([\s\S]*?)\r?\n---(\r?\n|$)/);

  // No frontmatter block at all. The note carries no explicit visibility, which
  // `readVisibility` reads as `all-hands`, so writing a header now would be
  // ADDING a clearance decision to a note that never had one. Keep it absent and
  // write the body alone; a title for such a note lives in its body heading,
  // which the proposer edits directly.
  if (!match) return { ok: true, note: `${body}\n` };

  const document = parseDocument(match[1]);
  if (document.errors.length > 0) {
    return { ok: false, error: "the note's frontmatter could not be parsed" };
  }
  document.set("title", p.title);
  return { ok: true, note: `---\n${document.toString()}---\n\n${body}\n` };
}
