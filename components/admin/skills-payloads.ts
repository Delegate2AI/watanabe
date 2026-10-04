import type { InstallBody, ManageBody, MarketplaceItemRow } from "./skills-types";

/**
 * Every JSON body the `/admin/skills` surface can POST, built in ONE place.
 *
 * These were inline in the form and the container until a route schema change
 * broke one of them silently. The route's `actionSchema` is a `.strict()`
 * discriminated union, so a key it no longer accepts is a 400 rather than an
 * ignored field, and the two suites that looked like they covered this could not
 * see it: the client tests assert what is posted against a mocked fetch, and the
 * route tests assert what the route accepts. Neither crosses the seam.
 *
 * Pure and free of imports beyond a type, so `skills-payloads.contract.test.ts`
 * can feed exactly these bodies to the real route handler. Any new action, or
 * any change to an existing one, belongs here so that test keeps covering it.
 */

export function gitInstallBody(fields: {
  url: string;
  ref: string;
  subdir?: string;
  groups: string[];
}): InstallBody {
  return {
    action: "install-git",
    url: fields.url,
    ref: fields.ref,
    // Omitted rather than sent empty: the schema bounds `subdir` at `min(1)`,
    // so an empty string is a refusal rather than "no subdirectory".
    ...(fields.subdir === undefined || fields.subdir === "" ? {} : { subdir: fields.subdir }),
    groups: fields.groups,
  };
}

/**
 * A marketplace pick names WHICH item, and nothing about how to fetch it.
 *
 * The ref and the subdir are deliberately not sent even though the index entry
 * carries them: the route re-fetches the index itself and reads them from the
 * entry it finds, so that a compromised client cannot redirect a named pick at a
 * different tree. Sending them is now both redundant and rejected.
 */
export function marketplaceInstallBody(
  index: string,
  item: MarketplaceItemRow,
  groups: string[],
): InstallBody {
  return { action: "install-marketplace", index, name: item.name, url: item.url, groups };
}

export function updateBody(slug: string): ManageBody {
  return { action: "update", slug };
}

export function uninstallBody(slug: string): ManageBody {
  return { action: "uninstall", slug };
}

export function setGroupsBody(slug: string, groups: string[]): ManageBody {
  return { action: "set-groups", slug, groups };
}
