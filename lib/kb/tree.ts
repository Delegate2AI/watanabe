import { buildVaultTree, readVaultFile, toRouteSlug, type VaultTreeNode } from "@/lib/vault";
import { meetingDateKey, withMeetingDate } from "./doc-title";
import { displayFolderName } from "./humanize";
import { noteMetaFromContent } from "./note";

/**
 * The KB tree, built from a clearance-scoped vault root (spec 25).
 *
 * The tree is built off `vaultRootFor(clearance)` (spec 19): a note the
 * requester is not cleared for is physically absent from that root, so it is
 * absent from this tree, its search, its backlinks, and the INDEX. There is no
 * per-file visibility check here. A file that IS present and carries a
 * restricted visibility gets a chip: it always sits on a note the requester can
 * open ("restricted, and you are cleared"), never a lock the requester cannot
 * pass.
 */
export interface KbTreeNode {
  /**
   * Display name only: a file node's note title, a directory node's name minus
   * its `NN-` sort prefix. Never a route or an identity, use `routeSlug`/`path`.
   */
  name: string;
  /** Extensionless route slug segments (`foo/bar.md` -> `["foo","bar"]`). */
  routeSlug: string[];
  isDirectory: boolean;
  children?: KbTreeNode[];
  /** Present only on file nodes. */
  visibility?: "all-hands" | "restricted";
  /** Prettified restricting group, present only on restricted file nodes. */
  group?: string;
  /** Vault-relative path: `foo/bar.md` for files, `foo` for directories. Used by the access-admin affordance. */
  path?: string;
  /**
   * The full decorated title, present only when `name` is an abbreviated form
   * of it (a meeting note's short date stamp). The sidebar puts it in the
   * hover tooltip so nothing the label drops is lost.
   */
  tooltip?: string;
}

/** A decorated node plus the key the tree orders meeting notes by. */
interface Decorated {
  node: KbTreeNode;
  dateKey: string | null;
}

/**
 * The vault tree arrives in filename order, which for meeting notes is title
 * then an opaque ingest id: a folder of one recurring meeting comes out in
 * random order. Within a directory: subdirectories first, then dated meeting
 * notes newest first, then everything else in the filename order it came in.
 */
function orderChildren(children: Decorated[]): KbTreeNode[] {
  const rank = (entry: Decorated) => (entry.node.isDirectory ? 0 : entry.dateKey ? 1 : 2);
  return children
    .map((entry, index) => ({ entry, index }))
    .sort(
      (a, b) =>
        rank(a.entry) - rank(b.entry) ||
        (b.entry.dateKey ?? "").localeCompare(a.entry.dateKey ?? "") ||
        a.index - b.index,
    )
    .map(({ entry }) => entry.node);
}

function decorate(node: VaultTreeNode, root: string): Decorated {
  if (node.isDirectory) {
    return {
      dateKey: null,
      node: {
        name: displayFolderName(node.name),
        routeSlug: node.slug,
        isDirectory: true,
        path: node.slug.join("/"),
        children: orderChildren((node.children ?? []).map((child) => decorate(child, root))),
      },
    };
  }
  const relPath = node.slug.join("/");
  const content = readVaultFile(relPath, root) ?? "";
  const meta = noteMetaFromContent(relPath, content);
  const name = withMeetingDate(meta.title, content, "short");
  const fullName = withMeetingDate(meta.title, content);
  return {
    dateKey: meetingDateKey(content),
    node: {
      // Display only. `routeSlug` and `path` stay derived from the on-disk name,
      // so no URL, wikilink, or backlink moves when a note's title changes. A
      // recurring meeting titles every instance alike, so the tree dates them: it
      // is the one surface that stacks them in a column with no date of its own.
      // The short stamp fits the 256px sidebar; the full one rides in the tooltip.
      name,
      tooltip: fullName === name ? undefined : fullName,
      routeSlug: toRouteSlug(node.slug),
      isDirectory: false,
      path: relPath,
      visibility: meta.visibility,
      group: meta.group,
    },
  };
}

/** Build the decorated KB tree for a clearance-scoped vault root. */
export function buildKbTree(root: string): KbTreeNode[] {
  return orderChildren(buildVaultTree("", 0, 12, root).map((node) => decorate(node, root)));
}
