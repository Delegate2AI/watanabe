import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { groupsFilePath } from "./config";
import { buildProjection } from "./projection";
import { unfilteredVaultRoot } from "@/lib/repo";

export interface ProjectionCacheOptions {
  vaultSha?: string;
  groupsHash?: string;
  sourceRoot?: string;
  outputRoot?: string;
}

const projections = new Map<string, string>();
const activeKeys = new Map<string, string>();

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function gitDirectories(root: string): { head: string; refs: string } {
  const dotGit = path.join(root, ".git");
  if (statSync(dotGit).isDirectory()) return { head: dotGit, refs: dotGit };
  const marker = readFileSync(dotGit, "utf8").trim();
  if (!marker.startsWith("gitdir:")) return { head: dotGit, refs: dotGit };
  const head = path.resolve(root, marker.slice("gitdir:".length).trim());
  const commonMarker = path.join(head, "commondir");
  const refs = existsSync(commonMarker)
    ? path.resolve(head, readFileSync(commonMarker, "utf8").trim())
    : head;
  return { head, refs };
}

function findGitRoot(start: string): string {
  let current = path.resolve(start);
  while (true) {
    if (existsSync(path.join(current, ".git"))) return current;
    const parent = path.dirname(current);
    if (parent === current) return start;
    current = parent;
  }
}

export function currentVaultSha(root: string = process.cwd()): string {
  try {
    const gitDirs = gitDirectories(root);
    const head = readFileSync(path.join(gitDirs.head, "HEAD"), "utf8").trim();
    if (!head.startsWith("ref:")) return head;
    const ref = head.slice("ref:".length).trim();
    const looseRef = path.join(gitDirs.refs, ref);
    if (existsSync(looseRef)) return readFileSync(looseRef, "utf8").trim();
    const packed = readFileSync(path.join(gitDirs.refs, "packed-refs"), "utf8");
    const line = packed.split("\n").find((entry) => entry.endsWith(` ${ref}`));
    if (line) return line.split(" ")[0];
  } catch {
    return "unavailable";
  }
  return "unavailable";
}

export function currentGroupsHash(filePath: string = groupsFilePath()): string {
  try {
    return digest(readFileSync(filePath, "utf8"));
  } catch {
    return digest("unavailable");
  }
}

export function projectionCacheKey(
  clearanceSet: string[],
  vaultSha: string,
  groupsHash: string,
): string {
  const clearance = [...new Set(clearanceSet)].sort((a, b) => a.localeCompare(b)).join("\0");
  return digest(`${clearance}\0${vaultSha}\0${groupsHash}`);
}

export function getProjection(
  clearanceSet: string[],
  options: ProjectionCacheOptions = {},
): string {
  const sourceRoot = options.sourceRoot ?? unfilteredVaultRoot();
  const vaultSha = options.vaultSha ?? currentVaultSha(findGitRoot(sourceRoot));
  const groupsHash = options.groupsHash ?? currentGroupsHash();
  const key = projectionCacheKey(clearanceSet, vaultSha, groupsHash);
  const cached = projections.get(key);
  if (cached && activeKeys.get(cached) === key && existsSync(cached)) return cached;
  const built = buildProjection(clearanceSet, vaultSha, {
    sourceRoot,
    outputRoot: options.outputRoot,
    destinationKey: groupsHash,
  });
  projections.set(key, built);
  activeKeys.set(built, key);
  return built;
}

export function clearProjectionCacheForTests(): void {
  projections.clear();
  activeKeys.clear();
}
