import path from "node:path";
import { isAdmin, loadGroups, resolveClearance } from "@/lib/authority/groups";
import { readVisibility, type Visibility } from "@/lib/authority/visibility";
import type { ChangedPath } from "@/lib/git-host";
import { unfilteredVaultRoot } from "@/lib/repo";
import { readVaultFile } from "@/lib/vault";

/** The vault subdirectory, which is also the write path's allow-list. */
export const VAULT_PREFIX = "docs/";

function insideVault(repoPath: string): boolean {
  if (!repoPath) return false;
  const normalized = path.posix.normalize(repoPath);
  if (normalized.startsWith("/") || normalized.split("/").includes("..")) return false;
  return normalized.startsWith(VAULT_PREFIX) && normalized.length > VAULT_PREFIX.length;
}

/** Whether every path a merge request touches is a vault path. An empty change set is not. */
export function touchesOnlyVault(changes: ChangedPath[]): boolean {
  if (changes.length === 0) return false;
  return changes.every((change) => {
    // A rename has to clear on both ends, or it moves a file across the boundary.
    const paths = change.newFile ? [change.newPath] : [change.oldPath, change.newPath];
    return paths.every(insideVault);
  });
}

/** The added lines of a unified diff, with the leading `+` stripped. */
function addedContent(diff: string): string {
  return diff
    .split("\n")
    .filter((line) => line.startsWith("+") && !line.startsWith("+++"))
    .map((line) => line.slice(1))
    .join("\n");
}

/**
 * A new note's visibility exists only in the diff; every other status reads the
 * note as it stands on main.
 */
export function visibilityOfChange(change: ChangedPath): Visibility {
  if (change.newFile) {
    const added = addedContent(change.diff);
    // No frontmatter at all is a refusal, not the all-hands default readVisibility
    // gives a note that omits the field (spec D3).
    if (added.split("\n")[0]?.trim() !== "---") return "unparseable";
    return readVisibility(added);
  }
  // A rename's new path does not exist on `main` yet, so its visibility is the
  // one the note carries where it still lives, exactly as for a deletion.
  const repoPath = change.deletedFile || change.renamedFile ? change.oldPath : change.newPath;
  let contents: string | null = null;
  try {
    contents = readVaultFile(repoPath.slice(VAULT_PREFIX.length), unfilteredVaultRoot());
  } catch {
    return "unparseable";
  }
  if (contents === null) return "unparseable";
  return readVisibility(contents);
}

/**
 * Whether this person may see the whole proposal. One note outside their
 * clearance hides all of it: a partial view of a change is not review.
 */
export function clearedForChanges(email: string, changes: ChangedPath[]): boolean {
  if (changes.length === 0) return false;
  const groups = loadGroups();
  if (isAdmin(email, groups)) return true;
  const clearance = new Set(resolveClearance(email, groups));
  return changes.every((change) => {
    const visibility = visibilityOfChange(change);
    if (visibility === "unparseable") return false;
    return visibility.some((group) => clearance.has(group));
  });
}
