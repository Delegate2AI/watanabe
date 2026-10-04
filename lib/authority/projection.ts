import {
  copyFileSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
} from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { unfilteredVaultRoot } from "@/lib/repo";
import { removeMissingNoteLinks } from "./backlinks";
import { canSee } from "./groups";
import { readVisibility } from "./visibility";
import { copyReachableAssets } from "./assets";

export interface ProjectionOptions {
  sourceRoot?: string;
  outputRoot?: string;
  destinationKey?: string;
}

export function projectionStoreDir(): string {
  const override = process.env.AUTHORITY_PROJECTION_DIR?.trim();
  return override ? path.resolve(process.cwd(), override) : "/data/authority";
}

function projectionName(clearanceSet: string[]): string {
  return createHash("sha256")
    .update([...new Set(clearanceSet)].sort().join("\0"))
    .digest("hex")
    .slice(0, 24);
}

function copyVisibleNotes(source: string, destination: string, clearance: string[], admin: boolean): void {
  for (const entry of readdirSync(source, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const sourcePath = path.join(source, entry.name);
    const destinationPath = path.join(destination, entry.name);
    if (entry.isDirectory()) {
      copyVisibleNotes(sourcePath, destinationPath, clearance, admin);
      continue;
    }
    if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".md")) continue;
    const visibility = readVisibility(readFileSync(sourcePath, "utf8"));
    if (visibility === "unparseable" ? !admin : !canSee(visibility, clearance, admin)) continue;
    mkdirSync(path.dirname(destinationPath), { recursive: true });
    copyFileSync(sourcePath, destinationPath);
  }
}

export function buildProjection(
  clearanceSet: string[],
  _vaultSha: string,
  options: ProjectionOptions = {},
): string {
  const source = path.resolve(options.sourceRoot ?? unfilteredVaultRoot());
  const output = path.resolve(options.outputRoot ?? projectionStoreDir());
  mkdirSync(output, { recursive: true });
  const target = path.join(output, projectionName(clearanceSet));
  const temporary = `${target}.tmp-${process.pid}-${Date.now()}`;
  mkdirSync(temporary, { recursive: true });
  try {
    copyVisibleNotes(source, temporary, clearanceSet, clearanceSet.includes("admins"));
    copyReachableAssets(source, temporary);
    removeMissingNoteLinks(temporary);
    rmSync(target, { recursive: true, force: true });
    renameSync(temporary, target);
    return target;
  } catch (error) {
    rmSync(temporary, { recursive: true, force: true });
    throw error;
  }
}
