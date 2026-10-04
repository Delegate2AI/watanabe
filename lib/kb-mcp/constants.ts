export const IGNORED_PATTERNS: readonly string[] = [
  "private",
  "templates",
  ".obsidian",
  ".git",
  ".claude",
  ".harness",
  ".authority",
  "assets/source",
  "assets/data",
  "node_modules",
];

/**
 * Vault paths a subsystem owns: readable everywhere, writable by nobody.
 *
 * Separate from `IGNORED_PATTERNS`, which means "this is not knowledge-base
 * content" and hides a path from reads too. A system path IS content and has to
 * stay visible in chat, in search and on the KB view.
 *
 * A subsystem that starts owning a folder adds itself here in the same merge
 * request that starts writing it.
 */
export const SYSTEM_WRITE_DENY: readonly string[] = ["meetings"];

/** Why a given system path is off limits, shown to the caller. */
export const SYSTEM_WRITE_DENY_REASON: Readonly<Record<string, string>> = {
  meetings: "the meetings subsystem",
};
