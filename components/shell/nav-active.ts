/**
 * One rule for "is this entry the current route", shared by the leaf items and
 * by the sections that decide whether to open themselves.
 *
 * Home matches the exact root only; every other entry also matches its nested
 * routes, so /kb stays lit on /kb/01-product. Kept in its own module because a
 * section and its children must agree: if they drifted, a deep link could
 * highlight an item inside a section that stayed collapsed.
 */
export function isRouteActive(href: string, pathname: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}
