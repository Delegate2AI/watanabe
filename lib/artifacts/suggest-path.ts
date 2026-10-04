/**
 * Suggest a KB target path for an artifact from its title (spec 27 / spec 03).
 *
 * Deterministic and offline: it slugifies the title inside a server-selected
 * existing folder under `docs/`. This is a starting point the owner can
 * edit, never an auto-publish; the write path stays allow-listed at the tool
 * layer. A future enhancement can place the file topically near related docs by
 * consulting the index, but that must degrade to this slug when the index is
 * off or empty.
 */

/** Lowercase kebab slug: alphanumerics kept, everything else a single hyphen. */
export function slugifyTitle(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug.length > 0 ? slug : "untitled";
}

/** A suggested target path under `docs/` from the title and an existing folder. */
export function suggestTargetPath(title: string, folder = ""): string {
  const prefix = folder.trim().replace(/^\/+|\/+$/g, "");
  return `${prefix ? `${prefix}/` : ""}${slugifyTitle(title)}.md`;
}
