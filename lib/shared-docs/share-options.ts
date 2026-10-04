import { isAdmin, loadGroups } from "@/lib/authority/groups";
import { ALL_HANDS } from "@/lib/authority/group-keys";
import { visibilityOptionsFor } from "@/lib/authority/visibility-options";
import { resolveClearanceForEmail } from "@/lib/identity/resolve";
import { knownMemberEmails } from "@/lib/authority/known-people";
import { resolvePeople } from "@/lib/people/resolve";
import { isDocGroupSharingEnabled } from "./config";
import type { ShareOptions } from "./types";

/**
 * What the share picker may offer, resolved on the server.
 *
 * `<ShareManager>` is a client island, so it can render these but must never
 * look them up: the resolvers underneath reach `node:fs` for `groups.yaml` and
 * the people directory. Same reason `<VisibilityPicker>` takes its options as a
 * prop.
 *
 * The team list is deliberately the SAME set `visibilityOptionsFor` computes for
 * KB visibility, so "teams I can file something to" means one thing across the
 * app, and so the picker cannot offer a target the share route would then refuse
 * (`validateShareTarget` enforces the identical rule server-side).
 */

/**
 * Options for `sharerEmail`, with themselves removed from the people list
 * (sharing with yourself is refused by the API, so offering it is a dead end).
 *
 * Teams are empty when the flag is off, which is what collapses the picker back
 * to the person-only behaviour with no separate client-side branch.
 */
export function shareOptionsFor(sharerEmail: string): ShareOptions {
  const self = sharerEmail.trim().toLowerCase();
  const emails = knownMemberEmails().filter((member) => member.trim().toLowerCase() !== self);
  const resolved = resolvePeople(emails, { viewerEmail: sharerEmail });
  const people = emails.map((email) => ({
    email,
    person: resolved[email.trim().toLowerCase()] ?? {
      email,
      name: email,
      initials: "?",
      isSelf: false,
    },
  }));

  if (!isDocGroupSharingEnabled()) return { teams: [], people };

  const groups = loadGroups();
  const teams = visibilityOptionsFor(resolveClearanceForEmail(sharerEmail), sharerEmail, {
    isAdmin: isAdmin(sharerEmail, groups),
  }).groups.map((name) => ({
    name,
    memberCount: name === ALL_HANDS ? null : (groups[name]?.length ?? 0),
  }));

  return { teams, people };
}
