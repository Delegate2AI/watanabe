import { readFileSync } from "node:fs";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import { buildCompatReport, type SkillCompatReport } from "./compat";
import { scanSkillDir } from "./scan";
import { slugifySkillName } from "./slugify";
import { MAX_SKILL_TITLE_CHARS, RESERVED_SKILL_SLUGS, SLUG_RE } from "./types";

/**
 * Install-time validation of a candidate skill folder (spec 34).
 *
 * Two jobs, deliberately separated:
 *
 * 1. Structural: is this a standards-compliant Agent Skill folder at all
 *    (`SKILL.md` with parseable frontmatter carrying `name` and `description`,
 *    a name that normalizes to a usable slug, inside the size caps)? A failure
 *    here blocks the install.
 * 2. Compatibility report: which executable helpers it ships, which
 *    `allowed-tools` this app cannot satisfy, and which http(s) URLs it
 *    references. This is INFORMATIONAL. It never blocks; it is what the admin
 *    reads before making a trust decision, since the folder came from a git
 *    remote, a zip upload, or a marketplace.
 *
 * Never throws: every hostile shape (missing dir, `SKILL.md` that is a
 * directory, binary garbage, frontmatter that parses to a scalar or a list, a
 * null `name`) comes back as `{ ok: false, reason }`.
 */
export const MAX_SKILL_BYTES = 10_000_000;
export const MAX_SKILL_FILES = 500;

/** The manifest filename the Agent Skills standard fixes. */
export const SKILL_MANIFEST = "SKILL.md";

/**
 * Caps on what comes OUT of the folder. The byte and file caps bound the input,
 * but every string below crosses a trust boundary afterwards: `name` and
 * `description` sit permanently in the context of every session for every user
 * whose clearance matches, and `name` (as title) plus `compat.tools` are
 * persisted into access/skills.yaml, which carries matching caps. A 9MB
 * description is comfortably inside MAX_SKILL_BYTES and would land in every one
 * of those prompts.
 *
 * The two field caps REJECT rather than truncate, and match the Agent Skills
 * standard's own limits (name 64, description 1024), so a compliant skill never
 * hits them: truncating a name would silently change the slug it derives, and
 * truncating a description would silently ship a mangled claim while hiding the
 * fact that the skill made an outsized one.
 *
 * The name cap is shared with the registry schema's title cap (./types.ts owns
 * the number, since it is the leaf module) so the two can never drift: the
 * title an install persists IS this name.
 *
 * The advisory report lists have caps of their own in ./compat.ts; those
 * truncate rather than reject, since compat must never block an install.
 */
export const MAX_SKILL_NAME_CHARS = MAX_SKILL_TITLE_CHARS;
export const MAX_SKILL_DESCRIPTION_CHARS = 1024;

/** Re-exported so callers keep a single import for the validation result shape. */
export type { SkillCompatReport } from "./compat";

export type SkillValidation =
  | { ok: true; name: string; slug: string; description: string; compat: SkillCompatReport }
  | { ok: false; reason: string };

export type SkillValidateOptions = { maxBytes?: number; maxFiles?: number };

/**
 * Normalize a frontmatter `name` into a registry slug. Defined in `./slugify`
 * (zero imports) and re-exported here, unchanged for every existing caller:
 * the PreToolUse gate needs this function and must not pull `node:fs`, `yaml`,
 * and the scanner onto every tool call. One implementation, deliberately, since
 * the gate compares against the slugs this produced at install time.
 */
export { slugifySkillName };

export function validateSkillDir(dir: string, options: SkillValidateOptions = {}): SkillValidation {
  const scan = scanSkillDir(dir, {
    maxBytes: options.maxBytes ?? MAX_SKILL_BYTES,
    maxFiles: options.maxFiles ?? MAX_SKILL_FILES,
  });
  if (!scan.ok) return { ok: false, reason: scan.reason };
  if (!scan.files.some((file) => file.rel === SKILL_MANIFEST)) {
    return { ok: false, reason: `no ${SKILL_MANIFEST} at the root of the skill folder` };
  }

  let raw: string;
  try {
    raw = readFileSync(path.join(dir, SKILL_MANIFEST), "utf8");
  } catch (error) {
    return { ok: false, reason: `unreadable ${SKILL_MANIFEST}: ${describe(error)}` };
  }

  const split = splitFrontmatter(raw);
  if (!split.ok) return split;

  let parsed: unknown;
  try {
    parsed = parseYaml(split.front);
  } catch (error) {
    return { ok: false, reason: `unparseable YAML frontmatter: ${describe(error)}` };
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ok: false, reason: "YAML frontmatter is not a map of fields" };
  }
  const fields = parsed as Record<string, unknown>;

  const name = readString(fields.name);
  if (name === "") return { ok: false, reason: "frontmatter `name` is missing or not a string" };
  if (name.length > MAX_SKILL_NAME_CHARS) {
    return { ok: false, reason: tooLong("name", name.length, MAX_SKILL_NAME_CHARS) };
  }
  const description = readString(fields.description);
  if (description === "") {
    return { ok: false, reason: "frontmatter `description` is missing or not a string" };
  }
  if (description.length > MAX_SKILL_DESCRIPTION_CHARS) {
    const cap = MAX_SKILL_DESCRIPTION_CHARS;
    return { ok: false, reason: tooLong("description", description.length, cap) };
  }

  const slug = slugifySkillName(name);
  if (slug === "" || !SLUG_RE.test(slug)) {
    return { ok: false, reason: `frontmatter name "${name}" does not normalize to a valid slug` };
  }
  if (RESERVED_SKILL_SLUGS.has(slug)) {
    return { ok: false, reason: `reserved slug: "${slug}" is an internal name` };
  }

  return {
    ok: true,
    name,
    slug,
    description,
    compat: buildCompatReport(scan.files, fields["allowed-tools"], raw),
  };
}

/**
 * Split on the first two `---` lines, per the Agent Skills standard. Only the
 * frontmatter block is returned: the body is not needed, since the URL scan
 * deliberately runs over the whole manifest.
 */
function splitFrontmatter(
  raw: string,
): { ok: true; front: string } | { ok: false; reason: string } {
  const lines = raw.replace(/^\uFEFF/, "").split(/\r?\n/);
  if (lines[0]?.trim() !== "---") {
    return { ok: false, reason: `no YAML frontmatter: ${SKILL_MANIFEST} must open with a --- line` };
  }
  const end = lines.findIndex((line, i) => i > 0 && line.trim() === "---");
  if (end === -1) {
    return { ok: false, reason: "unterminated YAML frontmatter: no closing --- line" };
  }
  return { ok: true, front: lines.slice(1, end).join("\n") };
}

function readString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function tooLong(field: string, length: number, cap: number): string {
  return `frontmatter \`${field}\` is too long: ${length} characters, cap is ${cap}`;
}

function describe(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return text.replace(/\s+/g, " ").trim();
}


