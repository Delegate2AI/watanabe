import { readFileSync } from "node:fs";
import { readVisibility } from "@/lib/authority/visibility";
import { unfilteredVaultRoot, vaultRootFor } from "@/lib/repo";
import { resolveVaultEntry } from "@/lib/vault";
import { noteMetaFromContent, splitBody } from "./note";

export interface SourceNote {
  /** The on-disk vault-relative path, with its real `.md` name. */
  relPath: string;
  title: string;
  /** The note's prose, frontmatter split off. */
  body: string;
  /**
   * The note's OWN visibility, for display only. A publish over an existing note
   * reads visibility off the note in the worktree and ignores whatever a draft
   * stored, so this can never widen anything: it exists so the editor can show
   * the reader which groups they are proposing an edit within.
   */
  visibility: string[];
}

/**
 * Read a KB note as it exists in the SOURCE vault, for a requester proven to be
 * cleared for it.
 *
 * The distinction this function exists to make: the KB view renders from
 * `vaultRootFor(clearance)`, a per-clearance PROJECTION, and building a
 * projection rewrites files on disk. It deletes any wikilink whose target is
 * absent from that requester's view. So a draft seeded from what the page
 * rendered would silently drop links the author never touched, and the diff
 * would read as their deliberate edit. Seeding from here instead means the draft
 * is byte-identical to the canonical note.
 *
 * Clearance is still enforced by the projection, just not read from it: the path
 * must resolve inside the requester's own root first. That keeps the spec-25
 * rule intact (absence is the boundary, so an uncleared path is indistinguishable
 * from one that does not exist) while the BYTES come from the source. Both
 * lookups go through `resolveVaultEntry`, so traversal segments, the ignore
 * list, and containment are checked twice by the same authority.
 *
 * Returns null for anything the requester may not see, which every caller must
 * surface as a 404 and never as a distinct "not allowed".
 */
function segmentsOf(relPath: string): string[] {
  return relPath.replace(/^docs\//, "").split("/");
}

/**
 * Whether a note is already in the vault, as far as this requester can tell.
 *
 * Deliberately answered from the requester's PROJECTION, not the source vault:
 * a true answer for a note they are not cleared for would be an existence
 * oracle, and the only caller uses this to decide how to render a control.
 */
export function sourceNoteExists(relPath: string, clearance: string[]): boolean {
  const entry = resolveVaultEntry(segmentsOf(relPath), vaultRootFor(clearance));
  return entry !== null && !entry.isDirectory;
}

export function readSourceNote(relPath: string, clearance: string[]): SourceNote | null {
  const segments = segmentsOf(relPath);

  const projected = resolveVaultEntry(segments, vaultRootFor(clearance));
  if (!projected || projected.isDirectory) return null;

  const source = resolveVaultEntry(segments, unfilteredVaultRoot());
  if (!source || source.isDirectory) return null;

  let content: string;
  try {
    content = readFileSync(source.absPath, "utf8");
  } catch {
    return null;
  }

  // An unparseable header is refused HERE, at the point a draft would be
  // created, rather than at publish time. Such a note is visible to admins
  // alone, and its publish would be refused anyway (`lib/kb-write/existing-note.ts`),
  // so allowing the draft would only produce one that can never land.
  const visibility = readVisibility(content);
  if (visibility === "unparseable") return null;

  return {
    relPath: source.relPath,
    title: noteMetaFromContent(source.relPath, content).title,
    body: splitBody(content),
    visibility: visibility.length > 0 ? visibility : ["all-hands"],
  };
}
