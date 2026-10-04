/**
 * Tier 0 of the Bash policy: the pattern set that decides, by command-string
 * matching alone, that a command is unambiguously dangerous.
 *
 * These live in their own module (rather than inline in `./bash-policy`)
 * because spec 34's skill-script carve-out in `lib/skills/script-policy.ts`
 * has to re-apply every one of them EXCEPT `INTERPRETER`, and a security
 * boundary re-implemented in a second file is a boundary that drifts. One
 * definition, two consumers, no copied literal to keep in sync.
 *
 * Every pattern is deliberately broad and substring-based: this is not an
 * OS-level sandbox, so it fails closed against cleverness rather than trying
 * to parse a shell grammar. See `./bash-policy`'s module comment for the full
 * residual-risk discussion. None of these carry the `g` flag, so `.test` is
 * stateless and safe to call repeatedly on the same literal.
 */

/** Shell metacharacters that could smuggle a second, unreviewed command through an otherwise-inspected one. */
export const SHELL_METACHARACTERS = /[;&|`]|\$\(|<\(|>\(|[<>]/;

/** Secret/credential/environment exfiltration. */
export const SECRET_ACCESS = /\b(env|printenv|export)\b|\/proc\/self\/environ|\.env\b|\bsecrets?\b|\bcredentials?\b/i;

/** Network egress of any kind. */
export const NETWORK_EGRESS = /\b(curl|wget|nc|ncat|netcat|ssh|scp|rsync|ftp|telnet|ping)\b/;

/** Destructive/mutating filesystem commands. */
export const DESTRUCTIVE = /\b(rm|mv|cp|chmod|chown|chgrp|dd|mkfs|shred|truncate)\b/;

/** Mutating git commands. */
export const MUTATING_GIT = /\bgit\b.*\b(push|commit|reset|clean|checkout|rebase|merge|add|worktree)\b/;

/** Privilege escalation / process control. */
export const PRIVILEGE_OR_PROCESS = /\b(sudo|su|doas|kill|pkill|killall)\b/;

/**
 * Interpreters that trivially bypass every pattern above via a script or a
 * one-liner. This is the ONE rule the skill-script carve-out relaxes, and only
 * for a script file that provably lives inside the admin-installed skill store.
 */
export const INTERPRETER = /\b(bash|sh|zsh|python3?|node|perl|ruby|eval|exec)\b/;

/**
 * Every Tier 0 rule EXCEPT `INTERPRETER`, case-insensitively.
 *
 * Two consumers need exactly this set: the skill-script carve-out, which has to
 * run before `isHardDenied` and therefore owes the rest of Tier 0 a re-check of
 * its own, and the compat report, which warns an admin at install time that a
 * script whose PATH trips one of these can never be run. One definition, so the
 * warning and the refusal can never disagree.
 *
 * Case-insensitive here and NOT in `isHardDenied`: Tier 0's exact behaviour is a
 * proven property of this branch and must not move, while the carve-out is new
 * surface that can afford to be stricter than its parent. It matters most on a
 * case-insensitive filesystem, where a script named `CURL.py` would slip a
 * case-sensitive name check and still be the file that runs.
 *
 * The originals are never mutated: a case-insensitive COPY is derived, except
 * for a pattern that already carries `i`, which is reused as-is. Safe only
 * because none of these carry `g`, so there is no `lastIndex` to share.
 */
const NON_INTERPRETER_TIER_0: readonly RegExp[] = [
  SHELL_METACHARACTERS,
  SECRET_ACCESS,
  NETWORK_EGRESS,
  DESTRUCTIVE,
  MUTATING_GIT,
  PRIVILEGE_OR_PROCESS,
].map((pattern) => (pattern.flags.includes("i") ? pattern : new RegExp(pattern.source, `${pattern.flags}i`)));

export function tripsNonInterpreterTierZero(text: string): boolean {
  return NON_INTERPRETER_TIER_0.some((pattern) => pattern.test(text));
}
