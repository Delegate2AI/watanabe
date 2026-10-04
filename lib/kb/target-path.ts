/**
 * Client-safe helpers for composing a KB publish target out of a folder and a
 * note name (spec 2026-08-11 follow-up). No node imports: the destination
 * picker is a client island. The server's `normalizeTargetInput` stays the
 * authority on what a target may be; these only assemble and split the string
 * the form sends it.
 */

/** Trim, collapse separators, and drop a `docs/` prefix: the vault root already IS `docs/`. */
export function normalizeFolderInput(raw: string): string {
  return raw
    .trim()
    .replace(/\\/g, "/")
    .replace(/\/+/g, "/")
    .replace(/^\/+|\/+$/g, "")
    .replace(/^docs\//, "");
}

/** A single note name: no separators, no extension. Typing `foo.md` means `foo`. */
export function normalizeNameInput(raw: string): string {
  return raw.trim().replace(/[\\/]+/g, "-").replace(/\.md$/i, "");
}

/** `handbook/onboarding.md` -> folder `handbook`, name `onboarding`. */
export function splitTargetPath(target: string): { folder: string; name: string } {
  const clean = normalizeFolderInput(target).replace(/\.md$/i, "");
  const at = clean.lastIndexOf("/");
  if (at < 0) return { folder: "", name: clean };
  return { folder: clean.slice(0, at), name: clean.slice(at + 1) };
}

/** The vault-relative target the publish route accepts, or `""` while the name is empty. */
export function joinTargetPath(folder: string, name: string): string {
  const dir = normalizeFolderInput(folder);
  const file = normalizeNameInput(name);
  if (file === "") return "";
  return dir === "" ? `${file}.md` : `${dir}/${file}.md`;
}

/**
 * Whether a typed folder is offerable as "create new": every segment non-empty
 * and none a traversal step. Deliberately shallow; `resolveWritableInRoot` on
 * the server remains the containment authority.
 */
export function isCreatableFolder(folder: string): boolean {
  const dir = normalizeFolderInput(folder);
  if (dir === "") return false;
  return dir.split("/").every((seg) => seg !== "" && seg !== "." && seg !== "..");
}
