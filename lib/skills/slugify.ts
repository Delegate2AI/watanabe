/**
 * Frontmatter name to registry slug, and nothing else.
 *
 * Split out of `validate.ts` on purpose: this function is now needed on the
 * PreToolUse path (`lib/skills/permissions.ts` maps the name the model was
 * shown back to the slug the plugin directory is keyed by), and `validate.ts`
 * pulls `node:fs`, `yaml`, and the scanner, none of which belong on a per
 * tool call import. Zero imports here, like `store-input.ts`.
 *
 * It stays ONE function, re-exported by `validate.ts` rather than copied. The
 * gate compares against slugs this function produced at install time, so a
 * second implementation that drifted would silently split that namespace: a
 * skill would be installed under one slug and refused under another.
 *
 * Guaranteed to return either "" (callers reject) or a string matching
 * `SLUG_RE`: diacritics are folded, every other non-`[a-z0-9]` run becomes a
 * single hyphen, leading and trailing hyphens go, and the result is cut to the
 * 32-character shape without ever ending on the hyphen the cut may have
 * exposed. A leading digit is fine; `SLUG_RE` allows it.
 */
export function slugifySkillName(name: string): string {
  const folded = name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  const hyphenated = folded.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return hyphenated.slice(0, 32).replace(/-+$/, "");
}
