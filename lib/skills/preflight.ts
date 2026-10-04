import { lstatSync } from "node:fs";
import { skillDirFor } from "./install-store";
import { loadSkillRegistry } from "./registry";
import { RESERVED_SKILL_SLUGS, SLUG_RE, type SkillSource } from "./types";

export type PreflightSourceType = SkillSource["type"];

export type PreflightReason = "registry" | "store" | "invalid";

export type PreflightResult = { ok: true } | { ok: false; reason: PreflightReason };

export function storeDirExists(slug: string): boolean {
  try {
    return lstatSync(skillDirFor(slug)).isDirectory();
  } catch {
    return false;
  }
}

export function preflightSlug(slug: string, incomingSourceType: PreflightSourceType): PreflightResult {
  if (!SLUG_RE.test(slug) || RESERVED_SKILL_SLUGS.has(slug)) {
    return { ok: false, reason: "invalid" };
  }

  const registry = loadSkillRegistry();
  const entry = registry.entries.find((candidate) => candidate.slug === slug);
  if (entry !== undefined) {
    return entry.source.type === incomingSourceType ? { ok: true } : { ok: false, reason: "registry" };
  }
  if (registry.errors.some((error) => error.slug === slug)) {
    return { ok: false, reason: "registry" };
  }
  return { ok: true };
}

export function preflightRefusalReason(slug: string, reason: PreflightReason): string {
  if (reason === "invalid") return `slug "${slug}" is not a valid skill slug`;
  if (reason === "registry") {
    return `slug "${slug}" is already registered under a different source type, refusing to overwrite it`;
  }
  return `slug "${slug}" already has store content under a different source type, refusing to overwrite it`;
}
