import { listVaultDir } from "@/lib/vault";

/** Existing top-level folders a contributor may choose as an artifact target. */
export function targetFoldersForRoot(root: string): string[] {
  return listVaultDir("", root)
    .filter((entry) => entry.isDirectory)
    .map((entry) => entry.name);
}
