/**
 * Display-name helpers for the KB view.
 *
 * Every function here is presentation only. Route slugs, vault-relative paths,
 * wikilink targets, and backlink keys are all derived from the on-disk name and
 * must never be routed through this module: changing a display name must never
 * move a URL.
 */

/**
 * Capitalize one word for display. A word that is entirely uppercase and longer
 * than an acronym (OVERVIEW, REFERENCE) is a shouted folder name, not a name in
 * its own right, so it is lowercased before capitalizing. Short all-caps tokens
 * (KPI, API, OKR) are left as authored.
 */
function capitalize(word: string): string {
  const base = word.length > 3 && word === word.toUpperCase() ? word.toLowerCase() : word;
  return base.charAt(0).toUpperCase() + base.slice(1);
}

/** "onboarding handbook" -> "Onboarding Handbook". Empty input comes back unchanged. */
export function titleCase(text: string): string {
  const words = text.split(/[-_\s]+/).filter(Boolean);
  return words.length === 0 ? text : words.map(capitalize).join(" ");
}

/**
 * The display fallback for a note that carries no title of its own:
 * `misc/onboarding-handbook.md` becomes "Onboarding Handbook".
 */
export function humanizeStem(relPath: string): string {
  const base = relPath.split("/").pop() ?? relPath;
  return titleCase(base.replace(/\.md$/i, ""));
}

/**
 * The display name of a vault directory. A leading `NN-` sort prefix orders the
 * vault on disk and is not part of the name, so it is dropped: `00-overview`
 * renders "Overview", `meetings` renders "Meetings". The on-disk name, the
 * slug, and every path are untouched.
 */
export function displayFolderName(name: string): string {
  return titleCase(name.replace(/^\d+-/, ""));
}
