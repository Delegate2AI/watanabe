import { realpathSync, statSync } from "node:fs";
import path from "node:path";
import { tripsNonInterpreterTierZero } from "@/lib/agent/bash-patterns";
import { isSkillsEnabled, skillsMaterializedDir, skillsStoreDir } from "./config";
import { PLUGIN_SKILLS_DIR } from "./materialize-key";
import { loadSkillRegistry } from "./registry";

/**
 * Spec 34: the one narrow relaxation of the Bash policy that lets an installed
 * skill run its own bundled script.
 *
 * Without this, a skill that ships `scripts/gen.py` is inert: Tier 0's
 * `INTERPRETER` rule hard-denies `python3 anything`. The carve-out relaxes that
 * single rule, and only for a script file that provably lives inside the
 * admin-installed skill store. It is NOT a general widening: everything this
 * function returns `true` for still lands on `"confirm"`, never `"allow"`, so a
 * human still approves each run.
 *
 * The shape, all of which must hold:
 *  - the flag is on (flag off, this function is a constant `false`);
 *  - the whole command matches a conservative ASCII charset, which excludes
 *    quotes, `$`, backslashes, globs, control characters, newlines, and every
 *    non-ASCII look-alike, so there is no quoting or expansion to reason about;
 *  - every Tier 0 rule EXCEPT `INTERPRETER` still passes on the full string,
 *    so a chained, secret-reading, egressing, destructive, git-mutating, or
 *    privilege-escalating command is refused here exactly as it is there;
 *  - the command is a single token list: either `<interpreter> <script> [args]`
 *    with the interpreter drawn from a fixed set and NO flag before the script,
 *    or a bare `<script> [args]`;
 *  - the script token is an absolute path whose REAL path (symlinks resolved on
 *    every component) sits inside a skill directory in the store or in a
 *    materialized plugin tree, and is a regular file;
 *  - that skill directory is not one of this app's own dot-prefixed machinery
 *    directories, and the root it sits under is not implausibly shallow;
 *  - the skill directory's SLUG is in the calling session's own resolved slug
 *    set, the same set `gateSkillTool` checks.
 *
 * That last clause is what makes the carve-out clearance-scoped. Both accepted
 * roots are shared across clearances: the store holds every installed skill, and
 * the materialized root holds one directory per clearance key. Containment alone
 * would therefore let a caller cleared for group A run
 * `python3 <store>/<slug-only-installed-for-B>/scripts/run.py`, skipping both
 * physical materialization and the `Skill` gate. Requiring membership in the
 * caller's own slug set closes that, and it fails closed exactly like
 * `gateSkillTool`: no set, or an empty one, matches nothing.
 *
 * Deny by default: anything unparsed, unresolvable, missing, or unreadable is
 * `false`. Never throws, since it runs on the session path.
 */

/** Interpreters a skill may be launched with. Bare names only, resolved via PATH. */
const INTERPRETERS: ReadonlySet<string> = new Set(["python3", "python", "node", "bash", "sh"]);

/**
 * The only characters a carve-out command may contain. An allowlist rather than
 * a denylist: `SHELL_METACHARACTERS` is a denylist and does not cover newlines,
 * quotes, `$`, `\`, `~`, globs, or non-ASCII, all of which change how a shell
 * reads a command. Tokens are separated by plain spaces and nothing else, so a
 * tab or a newline cannot act as a separator that this matcher does not see.
 */
const SAFE_TOKEN_CHARS = "A-Za-z0-9_@%+=:,./-";
const SAFE_COMMAND = new RegExp(`^[${SAFE_TOKEN_CHARS}]+( +[${SAFE_TOKEN_CHARS}]+)*$`);

/**
 * Bounds on a permitted command, set by what a human can actually READ rather
 * than by what is cheap to parse.
 *
 * The whole safety argument for not path-containing arguments is that the
 * reviewer sees the full command, and the confirm modal
 * (`components/agent/permission-modal.tsx`) shows it in a `max-h-56` scrollable
 * `<pre>` roughly 70 monospace columns wide: about 800 characters before it
 * scrolls. 512 characters and 12 tokens fit inside that, which covers an
 * interpreter, a long store path, and a handful of short arguments. A
 * 30-argument wall whose tail scrolls out of the box is refused rather than
 * confirmed, because hiding the tail from the reviewer is the point of it.
 */
const MAX_COMMAND_LENGTH = 512;
const MAX_TOKENS = 12;

/**
 * Roots shallower than this are refused outright. `PORTAL_SKILLS_DIR=/` would
 * otherwise make every regular file on the host a "skill script", and a store
 * at `/data` is close behind. Admin misconfiguration rather than an attack, but
 * a containment check whose root is attacker-irrelevant config should not
 * simply trust that config.
 */
const MIN_ROOT_DEPTH = 2;

const INSTALLED_SOURCE_TYPES: ReadonlySet<string> = new Set(["git", "zip", "marketplace"]);

/**
 * Whether this Bash command is one of the CALLER'S OWN installed skills running
 * one of its own scripts. `skillSlugs` is the session's resolved slug set (see
 * `lib/skills/materialize.ts`); `storeDir` and `materializedDir` are test-only
 * overrides, so production calls this with the command and the slug set alone.
 */
export function isSkillScriptInvocation(
  command: string,
  skillSlugs?: ReadonlySet<string>,
  storeDir?: string,
  materializedDir?: string,
  registryPath?: string,
): boolean {
  try {
    return matchesSkillScript(command, skillSlugs, storeDir, materializedDir, registryPath);
  } catch {
    // A permission error on a realpath, an unexpected input shape: deny.
    return false;
  }
}

function matchesSkillScript(
  command: string,
  skillSlugs?: ReadonlySet<string>,
  storeDir?: string,
  materializedDir?: string,
  registryPath?: string,
): boolean {
  if (!isSkillsEnabled()) return false;
  // No slug set, or an empty one, means this caller's clearance materialized
  // nothing: there is no skill of its own for it to run a script from.
  if (!skillSlugs || skillSlugs.size === 0) return false;
  if (typeof command !== "string") return false;
  const trimmed = command.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_COMMAND_LENGTH) return false;
  if (!SAFE_COMMAND.test(trimmed)) return false;
  // The ordering contract with lib/agent/bash-policy.ts: the carve-out is
  // consulted BEFORE isHardDenied, which would otherwise swallow every skill
  // script via INTERPRETER, so it owes the rest of Tier 0 a re-check of its own.
  // A script named curl.py, or an argument mentioning .env, is therefore
  // refused. A false positive on a legitimate-looking name is the right trade,
  // and lib/skills/compat.ts warns the admin at install time so it is not silent.
  if (tripsNonInterpreterTierZero(trimmed)) return false;

  const tokens = trimmed.split(/ +/);
  if (tokens.length > MAX_TOKENS) return false;
  const script = scriptToken(tokens);
  if (script === null) return false;
  const slug = skillSlugForScript(script, storeDir, materializedDir);
  if (slug === null || !skillSlugs.has(slug)) return false;
  return hasInstalledProvenance(slug, registryPath);
}

function hasInstalledProvenance(slug: string, registryPath?: string): boolean {
  const entry = loadSkillRegistry(registryPath).entries.find((candidate) => candidate.slug === slug);
  return entry !== undefined && INSTALLED_SOURCE_TYPES.has(entry.source.type);
}

/**
 * The token that names the file to be executed, or `null` if the command is not
 * shaped like a script invocation at all.
 *
 * No flag may precede the script path. That single rule is what rejects
 * `bash -c '...'`, `python3 -c '...'`, and `node -e '...'`: the inline-code
 * forms all need a flag, so refusing every leading `-` refuses all of them
 * without enumerating them. An absolute interpreter path (`/bin/bash x.sh`) is
 * not accepted either: it is read as a bare script invocation of `/bin/bash`,
 * which is not in the store, so it fails containment.
 */
function scriptToken(tokens: string[]): string | null {
  const [head, ...rest] = tokens;
  if (!INTERPRETERS.has(head)) return head;
  const first = rest[0];
  if (first === undefined || first.startsWith("-")) return null;
  return first;
}

/**
 * Containment, resolved rather than assumed. `path.resolve` plus
 * `path.relative` alone is a LEXICAL check, and this branch has already been
 * burned by that: a committed symlink in an intermediate path component escaped
 * a clone entirely in task 3, because nothing resolved the real path.
 *
 * So both sides are put through `realpathSync`, which resolves every component,
 * and containment is decided on the real paths. That gets both halves right at
 * once:
 *  - the materializer's OWN symlinks are fine. It links `<store>/<slug>` into
 *    `<materialized>/<key>/skills/<slug>`, so a path through that link resolves
 *    back into the store and is contained by the store root.
 *  - an escape THROUGH a symlink is refused. A link in the store pointing out
 *    of it, or a symlinked intermediate directory, resolves outside both roots.
 *
 * The materialized root is a second accepted root only for the copy fallback in
 * `materialize-build.ts` (filesystems that refuse symlinks), whose files really
 * do live there and never resolve into the store. Both roots are written by
 * this app from admin-installed content, so they are one trust domain.
 *
 * The path must also be a regular file at least one directory deep inside a
 * root, so a loose file dropped in the store root is not a skill script.
 *
 * The answer is the containing skill's SLUG rather than a boolean, because
 * containment is shared across clearances and the caller has to intersect it
 * with its own slug set. Layout differs per root: the store is
 * `<store>/<slug>/...`, the materialized root is `<root>/<key>/skills/<slug>/...`
 * (see `materialize-build.ts`), so the slug sits at a different depth in each.
 */
function skillSlugForScript(
  candidate: string,
  storeDir?: string,
  materializedDir?: string,
): string | null {
  if (!path.isAbsolute(candidate)) return null;
  let real: string;
  try {
    real = realpathSync(candidate);
    if (!statSync(real).isFile()) return null;
  } catch {
    // Missing, unreadable, or a broken link. Deny, exactly as for a path that
    // was never contained in the first place.
    return null;
  }
  return (
    slugUnderStore(real, storeDir ?? skillsStoreDir()) ??
    slugUnderMaterialized(real, materializedDir ?? skillsMaterializedDir())
  );
}

/** `<store>/<slug>/<something>`: the slug is the first segment. */
function slugUnderStore(realCandidate: string, root: string): string | null {
  const parts = relativeSegments(realCandidate, root);
  // At least one directory deep, so a loose file in the root is not a script.
  if (parts === null || parts.length < 2) return null;
  return isSkillDirName(parts[0]) ? parts[0] : null;
}

/** `<materialized>/<key>/skills/<slug>/<something>`: the slug is the third segment. */
function slugUnderMaterialized(realCandidate: string, root: string): string | null {
  const parts = relativeSegments(realCandidate, root);
  if (parts === null || parts.length < 4) return null;
  if (!isSkillDirName(parts[0]) || parts[1] !== PLUGIN_SKILLS_DIR) return null;
  return isSkillDirName(parts[2]) ? parts[2] : null;
}

/**
 * SLUG_RE cannot produce a leading dot, so everything dot-prefixed at a skill
 * directory level is machinery: the installer's `.replacing-<slug>-<uuid>`
 * asides and the materializer's `.skills-materialize-*` staging trees. A failed
 * aside cleanup is deliberately swallowed, so a replaced or rolled-back skill
 * version can survive on disk while being invisible to every lister and to the
 * admin UI, and invisible content must not stay runnable. A dot-directory
 * DEEPER inside a skill is the skill's own content and stays permitted.
 */
function isSkillDirName(name: string): boolean {
  return !name.startsWith(".");
}

/** Segments of `realCandidate` relative to `root`, or null when it is not inside it. */
function relativeSegments(realCandidate: string, root: string): string[] | null {
  let realRoot: string;
  try {
    realRoot = realpathSync(path.resolve(root));
  } catch {
    // Nothing installed yet, or the root is not readable: nothing is contained.
    return null;
  }
  if (segments(realRoot).length < MIN_ROOT_DEPTH) return null;
  const rel = path.relative(realRoot, realCandidate);
  if (rel === "" || rel.startsWith("..") || path.isAbsolute(rel)) return null;
  return segments(rel);
}

function segments(target: string): string[] {
  return target.split(path.sep).filter((part) => part.length > 0);
}
