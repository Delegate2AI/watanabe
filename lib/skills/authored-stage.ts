import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { scrubReason } from "@/lib/errors/scrub-reason";
import { makeStagingDir } from "./install-store";
import { SKILL_MANIFEST, validateSkillDir, type SkillValidation } from "./validate";

export type ValidAuthored = Extract<SkillValidation, { ok: true }>;

export type StagedManifest =
  | { ok: true; staging: string; dir: string }
  | { ok: false; error: string };

export function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function stageManifest(manifest: string): StagedManifest {
  let staging: string;
  try {
    staging = makeStagingDir();
  } catch (error) {
    return { ok: false, error: scrubReason(errorText(error)) };
  }
  try {
    const dir = path.join(staging, "skill");
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, SKILL_MANIFEST), manifest);
    return { ok: true, staging, dir };
  } catch (error) {
    rmSync(staging, { recursive: true, force: true });
    return { ok: false, error: scrubReason(errorText(error)) };
  }
}

export function validateStaged(
  dir: string,
  slug: string,
): { ok: true; validation: ValidAuthored } | { ok: false; error: string } {
  const validation = validateSkillDir(dir);
  if (!validation.ok) return { ok: false, error: scrubReason(validation.reason) };
  if (validation.slug !== slug) return { ok: false, error: "the title does not match the skill's slug" };
  if (validation.compat.scripts.length > 0) {
    return { ok: false, error: "an authored skill cannot carry scripts" };
  }
  return { ok: true, validation };
}
