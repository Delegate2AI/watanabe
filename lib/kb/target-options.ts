import { listVaultDir } from "@/lib/vault";
import { listKbFiles } from "./files";

/**
 * Everything the publish destination picker needs to offer real choices
 * (spec 2026-08-11 follow-up): the folders that exist in the requester's
 * clearance-scoped vault, and the notes that already live in them.
 *
 * Built off `vaultRootFor(clearance)` like the KB tree (spec 25), so a folder
 * or note the requester is not cleared for is simply absent, never a locked
 * row. Paths are vault-relative POSIX (`03-product/pricing.md`), no `docs/`
 * prefix, matching what the publish route's `normalizeTargetInput` accepts.
 */
export interface KbTargetNote {
  /** On-disk rel path with `.md`. A publish to this path updates, not creates. */
  path: string;
  title: string;
}

export interface KbTargetOptions {
  /** Every directory, nested paths included, sorted. */
  dirs: string[];
  /** Every existing note, sorted by path. */
  notes: KbTargetNote[];
}

const MAX_DEPTH = 12;

function walkDirs(relPath: string, root: string, depth: number, out: string[]): void {
  if (depth > MAX_DEPTH) return;
  for (const entry of listVaultDir(relPath, root)) {
    if (!entry.isDirectory) continue;
    const childRel = entry.slug.join("/");
    out.push(childRel);
    walkDirs(childRel, root, depth + 1, out);
  }
}

/** List target folders and existing notes for a clearance-scoped vault root. Never throws: an unreadable root yields empty lists. */
export function kbTargetOptions(root: string): KbTargetOptions {
  const dirs: string[] = [];
  walkDirs("", root, 0, dirs);
  dirs.sort();
  const notes = listKbFiles(root)
    .map((file) => ({ path: file.relPath, title: file.title }))
    .sort((a, b) => a.path.localeCompare(b.path));
  return { dirs, notes };
}
