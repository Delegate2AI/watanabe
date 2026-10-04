/**
 * Link-building for the web `/map` page (spec 14, subsystem A3). Pure, no I/O,
 * so it is unit-tested directly and shared between the server-rendered map and
 * any client island.
 *
 * A generated `IndexMap` doc carries a vault-relative path (e.g.
 * `04-economy/tokenomics.md`). The spec-18 shell renders vault docs under the
 * `/kb` catch-all route (`app/(app)/kb/[[...slug]]`), NOT the root-relative
 * `/<slug>` that `lib/vault-links.ts` still targets from spec 09's superseded
 * native root view. So the map links to `/kb/<slug>`: drop the `.md`
 * extension, percent-encode each path segment (spaces and reserved characters
 * are legal in vault filenames), and rejoin under the `/kb` prefix.
 */
export function vaultDocHref(relPath: string): string {
  const withoutExt = relPath.replace(/\.md$/i, "");
  const slug = withoutExt
    .split("/")
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  return `/kb/${slug}`;
}
