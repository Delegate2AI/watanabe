import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import { aliasIndex, canonicalEmail } from "@/lib/authority/aliases";
import { loadGroups } from "@/lib/authority/groups";
import { can } from "@/lib/authority/roles";
import { memoryWorktreeDir } from "@/lib/memory/config";

export type SkillAuthors = {
  authors: Record<string, string[]>;
  errors: string[];
};

const EMPTY_AUTHORS: SkillAuthors = { authors: {}, errors: [] };

const FileShapeSchema = z.object({ authors: z.record(z.string(), z.unknown()) }).strict();
const GroupListSchema = z.array(z.string().trim().min(1));
const EmailSchema = z.string().email();

type CacheEntry = { path: string; mtimeMs: number; value: SkillAuthors };
let cache: CacheEntry | null = null;

export function skillAuthorsFilePath(): string {
  return path.join(memoryWorktreeDir(), "access", "skill-authors.yaml");
}

export function invalidateSkillAuthorsCache(): void {
  cache = null;
}

export function loadSkillAuthors(filePath: string = skillAuthorsFilePath()): SkillAuthors {
  let mtimeMs: number;
  let raw: string;
  try {
    mtimeMs = statSync(filePath).mtimeMs;
    raw = readFileSync(filePath, "utf8");
  } catch {
    return EMPTY_AUTHORS;
  }

  if (cache && cache.path === filePath && cache.mtimeMs === mtimeMs) return cache.value;

  const value = parseSkillAuthors(raw);
  cache = { path: filePath, mtimeMs, value };
  return value;
}

function parseSkillAuthors(raw: string): SkillAuthors {
  let parsed: unknown;
  try {
    parsed = parseYaml(raw);
  } catch (error) {
    return fileLevelError(error);
  }

  const shape = FileShapeSchema.safeParse(parsed);
  if (!shape.success) return fileLevelError(shape.error);

  const authors: Record<string, string[]> = {};
  const errors: string[] = [];
  const seenAs: Record<string, string> = {};

  for (const [rawEmail, rawGroups] of Object.entries(shape.data.authors)) {
    const normalizedEmail = rawEmail.trim().toLowerCase();
    const emailResult = EmailSchema.safeParse(normalizedEmail);
    if (!emailResult.success) {
      errors.push(`${rawEmail}: not a valid email`);
      continue;
    }

    const groupsResult = GroupListSchema.safeParse(rawGroups);
    if (!groupsResult.success) {
      errors.push(`${normalizedEmail}: groups must be a non-empty list of non-blank strings`);
      continue;
    }

    const groups = groupsResult.data;
    if (groups.includes("all-hands")) {
      errors.push(`${normalizedEmail}: all-hands is not a valid skill-author group`);
      continue;
    }

    const priorSpelling = seenAs[normalizedEmail];
    if (priorSpelling !== undefined) {
      errors.push(`${priorSpelling} and ${rawEmail} both canonicalize to ${normalizedEmail}: dropping both entries`);
      delete authors[normalizedEmail];
      continue;
    }

    seenAs[normalizedEmail] = rawEmail;
    authors[normalizedEmail] = groups;
  }

  return { authors, errors };
}

function fileLevelError(error: unknown): SkillAuthors {
  const message = error instanceof Error ? error.message : String(error);
  return { authors: {}, errors: [message] };
}

export function canAuthorSkills(email: string, group: string, filePath?: string): boolean {
  if (can(email, "manageAccess")) return true;

  const aliases = aliasIndex();
  const requester = canonicalEmail(email, aliases);
  const { authors } = loadSkillAuthors(filePath);

  return Object.entries(authors).some(
    ([authorEmail, groups]) =>
      canonicalEmail(authorEmail, aliases) === requester && groups.includes(group),
  );
}

export function authorGroups(email: string, filePath?: string): string[] {
  if (can(email, "manageAccess")) {
    return [...new Set([...Object.keys(loadGroups()), "all-hands"])].sort();
  }

  const aliases = aliasIndex();
  const requester = canonicalEmail(email, aliases);
  const { authors } = loadSkillAuthors(filePath);

  const granted = new Set<string>();
  for (const [authorEmail, groups] of Object.entries(authors)) {
    if (canonicalEmail(authorEmail, aliases) !== requester) continue;
    for (const group of groups) granted.add(group);
  }

  return [...granted].sort();
}
