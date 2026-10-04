import { can } from "@/lib/authority/roles";
import { scrubReason } from "./admin-record";
import { currentManifest, mayEditEntry } from "./authored";
import { loadSkillRegistry } from "./registry";

export type AuthoredSkillDetail = {
  slug: string;
  title: string;
  description: string;
  groups: string[];
  rev: string;
  body: string;
};

export type ReadAuthoredInput = { actorEmail: string; slug: string };

export type ReadAuthoredResult =
  | { ok: true; skill: AuthoredSkillDetail }
  | { ok: false; error: string };

export async function readAuthoredSkill(input: ReadAuthoredInput): Promise<ReadAuthoredResult> {
  try {
    const admin = can(input.actorEmail, "manageAccess");
    const entry = loadSkillRegistry().entries.find((candidate) => candidate.slug === input.slug);
    if (entry === undefined || entry.source.type !== "authored") {
      return { ok: false, error: "not an authored skill" };
    }
    if (!mayEditEntry(input.actorEmail, admin, entry)) return { ok: false, error: "forbidden" };

    const manifest = currentManifest(input.slug);
    if (!manifest.ok) return { ok: false, error: manifest.error };

    return {
      ok: true,
      skill: {
        slug: entry.slug,
        title: manifest.name,
        description: manifest.description,
        groups: entry.groups,
        rev: entry.source.rev,
        body: manifest.body,
      },
    };
  } catch (error) {
    return { ok: false, error: scrubReason(error instanceof Error ? error.message : String(error)) };
  }
}
