import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { log } from "@/lib/log";
import { vaultRoot } from "@/lib/repo";
import { buildIndex, type IndexMap } from "./build";
import { indexCacheDir } from "./config";

/**
 * In-memory + on-disk cache for the generated vault INDEX (`IndexMap`).
 *
 * The in-memory half is pinned to `globalThis`, mirroring `lib/db/client.ts`'s
 * `__portalDb` singleton: Next.js can bundle route handlers separately, and
 * dev HMR would otherwise rebuild (or lose) the index on every module reload.
 * The on-disk half is a best-effort mirror of that same map under
 * `indexCacheDir()/index.json`, so a fresh process (a new pod, a cold module
 * reload) can serve the last known-good index before the first rebuild
 * completes, instead of returning nothing.
 *
 * Both `rebuildIndex` and `getIndex` NEVER throw: this cache sits on a
 * request path (or a boot path), and a scan failure or a disk hiccup must
 * degrade to "serve what we have, or nothing," never crash the caller.
 */

/** Fallback returned by `rebuildIndex` when a scan fails and there is no prior good index. */
const EMPTY_INDEX: IndexMap = { generatedFrom: "", groups: [], count: 0 };

const g = globalThis as unknown as { __vaultIndex?: IndexMap };

function cacheFilePath(): string {
  return path.join(indexCacheDir(), "index.json");
}

/** Best-effort persist of `map` to the on-disk cache file. Swallows any failure. */
function writeCacheFile(map: IndexMap): void {
  try {
    mkdirSync(indexCacheDir(), { recursive: true });
    writeFileSync(cacheFilePath(), JSON.stringify(map), "utf8");
  } catch (err) {
    log.warn("index cache: failed to write disk cache", { err: String(err) });
  }
}

/** Best-effort read + parse of the on-disk cache file. Returns null on any failure. */
function readCacheFile(): IndexMap | null {
  try {
    const file = cacheFilePath();
    if (!existsSync(file)) return null;
    return JSON.parse(readFileSync(file, "utf8")) as IndexMap;
  } catch (err) {
    log.warn("index cache: failed to read disk cache", { err: String(err) });
    return null;
  }
}

/**
 * Rescan the vault via `buildIndex()`, store the result as the process-wide
 * singleton, and best-effort persist it to `indexCacheDir()/index.json`.
 *
 * Never throws. On any failure during the scan or the disk write, this falls
 * back to the last good in-memory index, or `EMPTY_INDEX` if there has never
 * been one, so a broken rebuild can never take down whatever called it.
 */
export function rebuildIndex(): IndexMap {
  try {
    const map = buildIndex();
    g.__vaultIndex = map;
    writeCacheFile(map);
    return map;
  } catch (err) {
    log.error("index cache: rebuild failed", { err: String(err) });
    return g.__vaultIndex ?? EMPTY_INDEX;
  }
}

/**
 * The current index for this process: the in-memory singleton if one has
 * already been built (or loaded), else a lazy best-effort load of the
 * on-disk cache file, else null. Never throws.
 */
export function getIndex(): IndexMap | null {
  if (g.__vaultIndex) return g.__vaultIndex;
  const fromDisk = readCacheFile();
  if (fromDisk) g.__vaultIndex = fromDisk;
  return fromDisk;
}

/**
 * Render an `IndexMap` as grouped markdown: one `## <dir>` heading per group
 * (the root group, `dir === "."`, headers as `## (root)`), followed by one
 * `- [title](path) - description` line per doc. The trailing `- description`
 * is omitted when a doc has no description.
 */
export function renderIndexMarkdown(map: IndexMap): string {
  const lines: string[] = [];
  for (const group of map.groups) {
    lines.push(group.dir === "." ? "## (root)" : `## ${group.dir}`);
    for (const doc of group.docs) {
      const suffix = doc.description ? ` - ${doc.description}` : "";
      lines.push(`- [${doc.title}](${doc.path})${suffix}`);
    }
    lines.push("");
  }
  return lines.join("\n").trimEnd();
}

/**
 * True when a committed `INDEX.md` exists at `vaultRoot()` and its content no
 * longer matches a freshly rendered index. A missing `INDEX.md` is not
 * stale, since there is nothing committed to fall behind. Never throws: a
 * read or rebuild failure degrades to "not stale" rather than blocking the
 * caller (`kb_submit`'s success path, see `lib/kb-mcp/write-tools.ts`).
 * Prefers the already-cached index over a rebuild, same as `stagedIndexMarkdown`
 * below, so this stays cheap on the common path instead of forcing a second
 * full synchronous vault scan on every `kb_submit`.
 */
export function committedIndexIsStale(): boolean {
  try {
    const file = path.join(vaultRoot(), "INDEX.md");
    if (!existsSync(file)) return false;
    const committed = readFileSync(file, "utf8");
    return committed !== renderIndexMarkdown(getIndex() ?? rebuildIndex());
  } catch (err) {
    log.warn("index cache: failed to check committed INDEX.md staleness", { err: String(err) });
    return false;
  }
}

/**
 * The markdown an agent should stage as `INDEX.md` (via `kb_stage_edit`) to
 * commit an on-demand versioned snapshot of the current index. See the
 * write system prompt's index-snapshot guidance in `lib/agent/config.ts`.
 * Prefers the already-cached index over a rebuild, same as `kb_index`
 * (`lib/kb-mcp/server.ts`), so this stays cheap on the common path.
 */
export function stagedIndexMarkdown(): string {
  return renderIndexMarkdown(getIndex() ?? rebuildIndex());
}
