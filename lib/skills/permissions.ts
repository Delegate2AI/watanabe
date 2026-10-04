import { isSkillsEnabled } from "./config";
import { slugifySkillName } from "./slugify";

/**
 * Spec 34: the permission-gate side of installable skills. Lives here (not
 * inline in `lib/agent/permissions.ts`) because that file sits at the repo's
 * 300-line split threshold; the gate still calls these from its decision flow,
 * so the security boundary is unchanged. Same shape as spec 33's
 * `lib/connectors/permissions.ts`.
 *
 * Three layers, none of which trusts the others:
 *  1. materialization filters by physical absence, so another clearance's skill
 *     files are not in the directory this session is given at all;
 *  2. the SDK's own `skills` allow-list gets the same slugs (see
 *     `lib/agent/config.ts`), and rejects an unlisted skill at its Skill tool;
 *  3. this gate re-checks every `Skill` call against the slug set the session
 *     resolved, without touching the filesystem.
 *
 * A materialized tree that was ever wrong (a key collision, a tampered cache, a
 * future build bug) therefore still cannot get an uncleared skill invoked, and a
 * correct tree with a wrong slug set cannot either.
 *
 * Never throws: this runs inside the session's PreToolUse hook.
 */

/** The SDK's tool for invoking a skill. Plain name, no `mcp__` prefix. */
export const SKILL_TOOL = "Skill";

/**
 * Longest name worth parsing. A skill slug is short by construction (see
 * `SLUG_RE`), so anything longer is not a name this gate can honour, and is
 * normalized to a value that no slug set can contain.
 */
const MAX_NAME_LENGTH = 128;

/**
 * Fields the SDK's `Skill` tool is known or likely to carry the name in. Its
 * input schema is not exported, so this list is an optimistic read of a moving
 * target, backed by the shape-based fallback below.
 */
const NAME_FIELDS = ["skill", "skill_name", "skillName", "name", "command"] as const;

/** What a value has to look like before it is even considered a skill name. */
const NAME_SHAPE = /^[A-Za-z0-9][A-Za-z0-9._:@/-]*$/;

/**
 * The skill name a `Skill` call is asking for, or `undefined` when NOTHING in
 * the input can be read as one.
 *
 * Two layers, because the input schema is not exported by the SDK: the known
 * field names first, then, if none of them is a string, any single name-shaped
 * string value anywhere in the input. The second layer is what keeps a renamed
 * or added field from quietly turning this gate off. Ambiguity (two or more
 * name-shaped values, with no way to tell which one is the skill) resolves to
 * `undefined`, which the gate denies.
 *
 * A field that IS present but unusable (blank, over-long, path-shaped) returns
 * a normalized string that no slug set can contain, so it denies too. Nothing
 * here ever returns a value that means "allow anything".
 *
 * Normalization follows the SDK's documented naming (sdk.d.ts:1867-1868: names
 * match the SKILL.md `name` / directory name, or `plugin:skill` for
 * plugin-qualified skills; sdk.d.ts:3287 adds the `:name` suffix form): drop
 * the plugin qualifier ahead of the last colon, then keep the first path
 * segment.
 */
export function parseSkillName(toolInput: unknown): string | undefined {
  if (typeof toolInput !== "object" || toolInput === null) return undefined;
  // A tool input is a JSON object. An array is not one, and reading a name out
  // of its elements would be guessing at a shape that has never been observed.
  if (Array.isArray(toolInput)) return undefined;
  try {
    return readName(toolInput as Record<string, unknown>);
  } catch {
    // Unreachable from JSON-parsed SDK input, which carries no getters or
    // proxies. Kept because this runs inside the PreToolUse hook: a gate that
    // throws into a turn is worse than one that denies. `""` is in no slug set.
    return "";
  }
}

function readName(input: Record<string, unknown>): string | undefined {
  for (const field of NAME_FIELDS) {
    const value = input[field];
    if (typeof value === "string") return normalizeSkillName(value);
  }
  const candidates = new Set(
    Object.values(input)
      .filter((value): value is string => typeof value === "string" && NAME_SHAPE.test(value.trim()))
      .map(normalizeSkillName)
      .filter((name) => name.length > 0),
  );
  return candidates.size === 1 ? [...candidates][0] : undefined;
}

/** Trim, drop the plugin qualifier, keep the first path segment. `""` when unusable. */
function normalizeSkillName(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_NAME_LENGTH) return "";
  const unqualified = trimmed.slice(trimmed.lastIndexOf(":") + 1);
  return unqualified.split("/")[0].trim();
}

/**
 * Deny-by-default decision for the `Skill` tool. Allowed only when the flag is
 * on (backstop, mirroring the doc/tasks/connector pattern), the session
 * resolved a non-empty slug set, and a name could be read out of the input AND
 * is in that set.
 *
 * Every other path denies, including the one where no name could be read at
 * all. A gate that allows what it cannot parse guarantees nothing, and the
 * parse is the part that rests on an input schema the SDK does not export. The
 * SDK's own `skills` allow-list (see `lib/agent/config.ts`) already rejects an
 * unlisted skill, so this layer failing closed costs nothing when the two
 * agree and is the whole point when they do not.
 *
 * An empty set means this caller's clearance materialized nothing, so there is
 * no skill for it to run. Callers that pass no set at all (any pre-spec-34
 * call site) keep today's outright deny.
 */
export function gateSkillTool(
  toolInput: unknown,
  skillSlugs?: ReadonlySet<string>,
): "allow" | "deny" {
  if (!isSkillsEnabled()) return "deny";
  if (!skillSlugs || skillSlugs.size === 0) return "deny";
  const name = parseSkillName(toolInput);
  if (name === undefined) return "deny";
  return isMemberSkill(name, skillSlugs) ? "allow" : "deny";
}

/**
 * Membership, in the slug namespace and only there.
 *
 * The model is shown SKILL.md's `name`, which is slug-shaped only by accident:
 * `slugifySkillName` is lossy for any name with a space, a capital, or more
 * than 32 characters, which is most human-authored names. So a correctly
 * cleared user asking for a skill listed as `Brand Guidelines` would be refused
 * against a set holding `brand-guidelines`, and the denial text would blame
 * clearance for what is a naming mismatch.
 *
 * Mapping the requested name through the SAME function that produced the slug
 * set is a widening inside one namespace, not a loosening of the boundary: a
 * frontmatter name can only ever map to the slug derived from it, and the
 * registry is keyed by slug, so two installed skills cannot collide onto one.
 * Every name that was already refused and does not slugify to a member is still
 * refused.
 */
function isMemberSkill(name: string, skillSlugs: ReadonlySet<string>): boolean {
  if (skillSlugs.has(name)) return true;
  const slug = slugifySkillName(name);
  return slug.length > 0 && skillSlugs.has(slug);
}

/**
 * Denial text handed back to the agent so it self-corrects instead of retrying.
 * Deliberately says nothing about which skills DO exist for other clearances:
 * the whole point of per-clearance materialization is that a caller cannot
 * learn about a skill it may not use.
 */
export function skillDenialReason(toolInput?: unknown): string {
  const name = parseSkillName(toolInput);
  const which = name ? `the skill \`${name}\`` : "that skill";
  return (
    `This assistant cannot run ${which}: no such skill is installed and available ` +
    `to this user. It can only use the skills an administrator has installed for ` +
    `the groups this user belongs to.`
  );
}
