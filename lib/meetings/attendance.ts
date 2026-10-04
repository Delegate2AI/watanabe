import { aliasIndex, canonicalEmail, type AliasIndex } from "@/lib/authority/aliases";

export function attendedBy(
  attendees: string[],
  viewerEmail: string,
  aliases: AliasIndex = aliasIndex(),
): boolean {
  const viewer = canonicalEmail(viewerEmail, aliases);
  if (!viewer) return false;
  return attendees.some((attendee) => canonicalEmail(attendee, aliases) === viewer);
}
