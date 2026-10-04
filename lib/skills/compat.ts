import path from "node:path";
import { tripsNonInterpreterTierZero } from "@/lib/agent/bash-patterns";
import type { ScanFile } from "./scan";

/**
 * The advisory half of skill validation (spec 34): what an admin is about to
 * install. Which executable helpers the folder ships, which `allowed-tools` it
 * declares that this app cannot satisfy, and which http(s) URLs it references.
 *
 * Nothing here ever blocks an install. It exists to inform a trust decision,
 * which is also why every list is capped: a 50,000 URL report is noise, and
 * noise is the opposite of an informed decision.
 */
export type SkillCompatReport = {
  scripts: string[];
  tools: string[];
  urls: string[];
  /**
   * The subset of `scripts` the Bash policy can never run, because the script's
   * own relative path trips a Tier 0 pattern (a file named `curl.py`,
   * `rm-old.sh`, `env-setup.sh`, and so on). The skill-script carve-out in
   * `lib/skills/script-policy.ts` re-applies those patterns to the whole command
   * string, so the path alone is enough to refuse it forever.
   *
   * Without this the failure is silent and confusing: an admin installs a skill,
   * reads "scripts: 3", and the session gets a flat deny at runtime with no
   * explanation. The fix an admin needs is to rename the file, which they can
   * only do if they are told.
   *
   * Not persisted: `SkillEntry.compat` deliberately keeps only `{ scripts,
   * tools }`, and this is derivable from `scripts` at any time.
   */
  blockedScripts: string[];
};

/** Per-list item count, and per-item character cap. Both truncate, never reject. */
export const MAX_COMPAT_ITEMS = 50;
export const MAX_COMPAT_ITEM_CHARS = 200;

/**
 * What `clip` appends to an item it shortened. Exported because the persisted
 * entry schema in ./types.ts has to size its own cap around it: a clipped item
 * is longer than MAX_COMPAT_ITEM_CHARS, so a schema cap set to the raw number
 * would reject this module's own output.
 */
export const TRUNCATION_SUFFIX = "... (truncated)";

/**
 * Tools this app actually exposes to a session: `ALLOWED_TOOLS` from
 * `lib/agent/permissions.ts`, plus `Bash` (gated by the tiered bash policy) and
 * `Skill` itself. Duplicated as a literal rather than imported so this module
 * stays pure and free of the flag/vault imports permissions.ts pulls in; a test
 * asserts the two stay in step.
 */
export const EXPOSED_TOOLS: ReadonlySet<string> = new Set([
  "Read", "Glob", "Grep", "TodoWrite", "WebSearch", "WebFetch", "Bash", "Skill",
]);

const SCRIPT_EXTENSIONS: ReadonlySet<string> = new Set([".sh", ".py", ".js", ".ts", ".rb"]);

/** Stops at whitespace and at the closers that usually wrap a link in prose. */
const URL_RE = /https?:\/\/[^\s<>"'`)\]}]+/g;

/**
 * `manifest` is the whole SKILL.md, frontmatter included, on purpose: a URL
 * sitting in a metadata field is the same egress hint as one in the prose, and
 * skipping it would understate what the admin is agreeing to.
 */
export function buildCompatReport(
  files: ScanFile[],
  allowedTools: unknown,
  manifest: string,
): SkillCompatReport {
  const scripts = files.filter(isScript).map((file) => file.rel);
  return {
    scripts: capList(scripts),
    tools: capList(unsupportedTools(allowedTools)),
    urls: capList(collectUrls(manifest)),
    blockedScripts: capList(scripts.filter(tripsNonInterpreterTierZero)),
  };
}

/** Extension match, or an executable mode bit on a file with no known extension. */
function isScript(file: ScanFile): boolean {
  return SCRIPT_EXTENSIONS.has(path.extname(file.rel).toLowerCase()) || file.executable;
}

/**
 * Every declared tool this app does not expose, deduped and sorted. Both
 * frontmatter spellings are accepted: a YAML list, and the comma-separated
 * string Claude Code also allows. A scoped entry such as `Bash(git status:*)`
 * is matched on its base name (the scope is the caller's business, not a
 * different tool) but reported verbatim so the admin sees what was written.
 */
function unsupportedTools(value: unknown): string[] {
  let declared: unknown[] = [];
  if (Array.isArray(value)) declared = value;
  else if (typeof value === "string") declared = value.split(",");

  const out = new Set<string>();
  for (const item of declared) {
    if (typeof item !== "string") continue;
    const tool = item.trim();
    if (tool === "") continue;
    const base = (tool.split("(")[0] ?? tool).trim();
    if (!EXPOSED_TOOLS.has(base)) out.add(tool);
  }
  return [...out].sort();
}

function collectUrls(text: string): string[] {
  const found = new Set<string>();
  for (const match of text.matchAll(URL_RE)) {
    const url = match[0].replace(/[.,;:!?]+$/, "");
    if (url.length > 0) found.add(url);
  }
  return [...found].sort();
}

/**
 * Cap one advisory list: each item clipped, at most MAX_COMPAT_ITEMS of them,
 * and a trailing "+N more" so the admin still learns the list ran longer rather
 * than silently seeing a short one.
 */
function capList(items: string[]): string[] {
  const kept = items.slice(0, MAX_COMPAT_ITEMS).map(clip);
  const dropped = items.length - kept.length;
  if (dropped > 0) kept.push(`+${dropped} more`);
  return kept;
}

function clip(item: string): string {
  if (item.length <= MAX_COMPAT_ITEM_CHARS) return item;
  return `${item.slice(0, MAX_COMPAT_ITEM_CHARS)}${TRUNCATION_SUFFIX}`;
}
