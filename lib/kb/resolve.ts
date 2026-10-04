import { resolveVaultEntry, readVaultFile } from "@/lib/vault";
import { parseNote, type Note } from "./note";

/**
 * Resolve a KB route slug against a clearance-scoped vault root (spec 25).
 *
 * The root is `vaultRootFor(clearance)` (spec 19). A slug that points at a note
 * outside the requester's projection (restricted, or simply unknown) fails to
 * resolve and returns `null`: the caller renders a 404 that is byte-identical
 * to "does not exist", so a restricted note is indistinguishable from a
 * missing one. Absence is the boundary.
 */
export type KbResolution =
  | { kind: "doc"; relPath: string; slug: string[]; note: Note }
  | { kind: "dir"; relPath: string; slug: string[] }
  | null;

export function resolveKbDoc(slug: string[] | undefined, root: string): KbResolution {
  const entry = resolveVaultEntry(slug, root);
  if (!entry) return null;
  if (entry.isDirectory) return { kind: "dir", relPath: entry.relPath, slug: entry.slug };
  // Only markdown notes are documents. A non-`.md` file (an image, PDF, ...) is
  // NOT fed through the markdown renderer here. It is served as raw bytes by
  // the `/kb/assets` asset route. Resolving it as `null` makes the page and the
  // doc API 404 it, byte-identical to "does not exist", instead of rendering the
  // binary content inline as garbled text.
  if (!entry.relPath.toLowerCase().endsWith(".md")) return null;
  const content = readVaultFile(entry.relPath, root);
  if (content === null) return null;
  return { kind: "doc", relPath: entry.relPath, slug: entry.slug, note: parseNote(entry.relPath, content) };
}

/** Route slug of the directory containing a note, for relative-link resolution. */
export function dirSlugOf(slug: string[]): string[] {
  return slug.slice(0, -1);
}
