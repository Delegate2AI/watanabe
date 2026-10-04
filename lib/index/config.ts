import path from "node:path";
import { isFlagEnabled } from "@/lib/config/flags";
/** Config for the generated vault INDEX subsystem. Gates on its own flag, independent of others. */
export function isIndexEnabled(): boolean {
  return isFlagEnabled("INDEX_ENABLED");
}
/** Where the generated index is cached on disk. Overridable via INDEX_CACHE_DIR; default /data/index. */
export function indexCacheDir(): string {
  const o = process.env.INDEX_CACHE_DIR?.trim();
  return o ? path.resolve(process.cwd(), o) : "/data/index";
}
