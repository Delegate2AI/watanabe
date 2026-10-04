import { realpathSync } from "node:fs";
import path from "node:path";

/**
 * Argument guards for the git half of the skill install pipeline (spec 34).
 *
 * The remote, the ref, and the subdir all arrive from an admin form and are
 * typed as plain non-empty strings in `types.ts` (deliberately loose, so
 * `ssh://` and `git@host:path` remotes work). Nothing upstream constrains them,
 * so every hostile shape is refused here, before `install-git.ts` spawns
 * anything:
 *
 * - **No argument injection.** A value starting with `-` is refused, and so is
 *   a HOST starting with `-` (`ssh://-oProxyCommand=.../x` is an ssh option
 *   smuggled through the authority). The clone argv is `--`-terminated as well,
 *   so both positionals are protected twice over.
 * - **No transport helpers.** `ext::sh -c ...` is a remote git executes as a
 *   command, and git's default `protocol.ext` policy permits it for a directly
 *   invoked clone. The scheme is allow-listed and `::` is refused outright.
 * - **No subdir escape**, lexically OR through a symlink. See `resolveSubdir`.
 *
 * Never throws: everything returns `{ ok, value | reason }`. The remote and ref
 * checks are pure; `resolveSubdir` is not, because a lexical check cannot see a
 * symlink and it has to call `realpathSync` to close that.
 */

/** Schemes we will clone. `GIT_ALLOW_PROTOCOL` gets the same list, so git enforces it too. */
export const ALLOWED_GIT_SCHEMES = ["file", "git", "http", "https", "ssh"] as const;

const SCHEME_RE = /^([A-Za-z][A-Za-z0-9+.-]*):\/\//;
/** `user@host:path`, the scp-like form git accepts and that is not a parseable URL. */
const SCP_LIKE_RE = /^[A-Za-z0-9._-]+@[A-Za-z0-9._-]+:.+$/;
const CONTROL_RE = /[\u0000-\u001f\u007f]/;
const REF_RE = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/;

export type Checked<T> = { ok: true; value: T } | { ok: false; reason: string };

/** The exact clone argv. `--` sits between every option and the two untrusted positional arguments. */
export function gitCloneArgs(url: string, ref: string, dest: string): string[] {
  return ["clone", "--depth=1", "--branch", ref, "--", url, dest];
}

/**
 * The authority of a remote (everything git turns into an ssh destination), or
 * "" when the remote has none.
 *
 * Checking only the part after `@` was wrong. Git does not split userinfo off
 * and pass a bare hostname: it hands ssh the WHOLE `user@host` string as one
 * argv element, verified against git 2.50.1 with `GIT_SSH_COMMAND`, where
 * `ssh://-Fnope@example.com/x` reaches ssh as the single element
 * `-Fnope@example.com`. So a dash anywhere an ssh argument could begin is an
 * option in disguise, and the check has to cover the authority as a whole as
 * well as the host inside it. Git refuses these itself ("strange hostname
 * blocked", the CVE-2017-1000117 fix), but that is exactly the reliance this
 * guard exists to remove, since it varies with the git in the image.
 *
 * An absolute local path has no authority at all. `/srv/skills@-weird` is a
 * directory name, not a host, so it is returned as "" and never refused.
 */
function authorityOf(value: string, scheme: string | undefined): string {
  if (scheme !== undefined) return value.slice(scheme.length + 3).split("/")[0] ?? "";
  // A colon only starts an scp-like path when no slash precedes it, which is
  // git's own rule and is why a local path is excluded before this is reached.
  const colon = value.indexOf(":");
  return colon === -1 ? "" : value.slice(0, colon);
}

export function checkGitRemote(url: string): Checked<string> {
  const value = url.trim();
  if (value === "") return { ok: false, reason: "git remote is empty" };
  if (CONTROL_RE.test(value)) return { ok: false, reason: "git remote contains control characters" };
  if (value.startsWith("-")) {
    return { ok: false, reason: `git remote may not start with a dash: git would read "${value}" as a flag` };
  }
  if (value.includes("::")) {
    return { ok: false, reason: "git transport-helper remotes (scheme::command) are not accepted" };
  }

  const scheme = SCHEME_RE.exec(value)?.[1]?.toLowerCase();
  const isLocalPath = scheme === undefined && path.isAbsolute(value);
  if (scheme !== undefined && !(ALLOWED_GIT_SCHEMES as readonly string[]).includes(scheme)) {
    return { ok: false, reason: `unsupported git remote scheme "${scheme}"` };
  }
  if (scheme === undefined && !isLocalPath && !SCP_LIKE_RE.test(value)) {
    return {
      ok: false,
      reason: `unrecognized git remote "${value}": expected ${ALLOWED_GIT_SCHEMES.join("://, ")}://, a user@host:path remote, or an absolute local path`,
    };
  }

  // Every `@`-separated piece, so both `-Fnope@example.com` (the userinfo
  // begins the ssh argument) and `user@-oHost` (the host does) are refused.
  if (!isLocalPath) {
    const authority = authorityOf(value, scheme);
    const offender = authority.split("@").find((part) => part.startsWith("-"));
    if (offender !== undefined) {
      return {
        ok: false,
        reason: `git remote host may not start with a dash: "${offender}" would be read as an option`,
      };
    }
  }
  return { ok: true, value };
}

export function checkGitRef(ref: string): Checked<string> {
  const value = ref.trim();
  if (value === "") return { ok: false, reason: "git ref is empty" };
  if (!REF_RE.test(value) || value.includes("..") || value.endsWith(".lock")) {
    return { ok: false, reason: `unusable git ref "${value}": expected a branch or tag name` };
  }
  return { ok: true, value };
}

/**
 * Resolve `subdir` inside the clone root, refusing anything that leaves it.
 *
 * Lexical containment (the `isPathWithinVault` technique) is necessary but NOT
 * sufficient, and assuming otherwise was a real hole: a hostile repository can
 * commit `hop -> /outside` (git stores a symlink verbatim, mode 120000), and
 * `subdir: "hop/victim"` then resolves lexically to a path inside the clone
 * while physically pointing anywhere on the box. The skill folder validator
 * cannot catch it either: it lstats the scan ROOT and each dirent inside it, so
 * a symlink in an INTERMEDIATE component of the subdir path is above its
 * horizon entirely. Since the pipeline RENAMES the resolved directory into the
 * store, the consequence is not merely reading outside the clone, it is moving
 * an outside directory into the store and out of its original location.
 *
 * So both paths are resolved with `realpathSync` and the containment check is
 * re-run on the real paths. `realpathSync` is also what makes this correct on
 * macOS, where `os.tmpdir()` sits under the `/var -> /private/var` symlink and
 * the lexical and real roots differ for entirely innocent reasons. A realpath
 * that throws (a dangling link, a component removed underneath us) is a
 * refusal, never an exception.
 */
export function resolveSubdir(root: string, subdir: string | undefined): Checked<string> {
  const resolvedRoot = path.resolve(root);
  let target = resolvedRoot;

  if (subdir !== undefined) {
    const value = subdir.trim();
    if (value === "") return { ok: false, reason: "subdir is empty" };
    if (CONTROL_RE.test(value)) return { ok: false, reason: "subdir contains control characters" };
    if (path.isAbsolute(value) || path.win32.isAbsolute(value)) {
      return { ok: false, reason: `subdir path traversal: "${subdir}" is an absolute path` };
    }
    target = path.resolve(resolvedRoot, value);
    const rel = path.relative(resolvedRoot, target);
    if (rel.startsWith("..") || path.isAbsolute(rel)) {
      return { ok: false, reason: `subdir path traversal: "${subdir}" resolves outside the clone` };
    }
    if (isDotGitSegment(rel)) {
      return { ok: false, reason: `subdir "${subdir}" points into the repository's .git directory` };
    }
  }

  const label = subdir ?? ".";
  const realRoot = realpathOrNull(resolvedRoot);
  const realTarget = realpathOrNull(target);
  if (realRoot === null || realTarget === null) {
    return { ok: false, reason: `subdir "${label}" is not a real directory inside the clone` };
  }
  const realRel = path.relative(realRoot, realTarget);
  if (realRel.startsWith("..") || path.isAbsolute(realRel)) {
    return { ok: false, reason: `subdir path traversal: "${label}" escapes the clone through a symlink` };
  }
  if (isDotGitSegment(realRel)) {
    return { ok: false, reason: `subdir "${label}" points into the repository's .git directory` };
  }
  return { ok: true, value: realTarget };
}

function isDotGitSegment(rel: string): boolean {
  return rel.split(path.sep)[0] === ".git";
}

function realpathOrNull(target: string): string | null {
  try {
    return realpathSync(target);
  } catch {
    return null;
  }
}
