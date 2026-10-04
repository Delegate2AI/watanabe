/**
 * The shape of one generated demo vault note, plus the author shorthands the
 * content modules share. Split out of `../vault.ts` so the content modules can
 * import the type without importing the writer (and its fs side effects).
 */

export interface VaultNote {
  /** Vault-relative path, e.g. `00-overview/glossary.md`. */
  path: string;
  title: string;
  owner: string;
  /** Date-only, `2026-07-12`. */
  updated: string;
  /**
   * Clearance groups. `null` omits the key entirely, which `readVisibility()`
   * reads as `all-hands` -- worth having, since that is what every note in the
   * real vault looks like today.
   */
  visibility: string[] | null;
  /** Extra frontmatter fields (meeting notes use type/date/attendees/duration). */
  extra?: Record<string, string | number | string[]>;
  body: string;
  /**
   * Write the body with NO frontmatter block. Exercises the access admin's
   * "skipped" path: `rewriteVisibility()` returns null without frontmatter.
   */
  noFrontmatter?: boolean;
}

export const MARIA = "maria.chen@example.com";
export const DEVON = "devon.brooks@example.com";
export const PRIYA = "priya.nair@example.com";
export const SAM = "sam.rivera@example.com";
export const ALEX = "alex.kim@example.com";
