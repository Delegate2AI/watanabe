"use client";

import { useState, type FormEvent } from "react";
import { PersonChip, personFor } from "@/components/person-chip";
import type { AccessChange, AccessState } from "@/lib/authority/access";
import type { Role } from "@/lib/authority/roles";
import type { Person } from "@/lib/people/types";
import { AccessAliases } from "./access-aliases";
import { buttonClass, inputClass, ROLE_NAMES } from "./access-ui";
import { PersonPicker } from "./person-picker";

/**
 * The Members tab: one row per person in the access data, with their groups,
 * their role, (behind PEOPLE_ENABLED) an inline display-name edit, and (behind
 * ALIASES_ADMIN_ENABLED) the other addresses that resolve to them.
 *
 * Names arrive already resolved from the server page. With the people flag off
 * every chip renders the bare email, exactly as this tab did before the
 * directory existed, and the name edit is not offered at all.
 */
export function AccessMembers({
  access,
  people,
  roster,
  candidates = [],
  aliases = {},
  peopleEnabled,
  groupsEnabled,
  rolesEnabled,
  aliasesEnabled = false,
  pending,
  mutate,
  renamePerson,
  mutateAlias,
  onNotice,
}: {
  access: AccessState;
  people: Record<string, Person>;
  roster: string[];
  /** Everyone the portal knows about, resolved and sorted on the server. */
  candidates?: readonly Person[];
  /** canonical email -> the other addresses that resolve to it. */
  aliases?: Record<string, string[]>;
  peopleEnabled: boolean;
  groupsEnabled: boolean;
  rolesEnabled: boolean;
  aliasesEnabled?: boolean;
  pending: boolean;
  mutate: (change: AccessChange) => Promise<boolean>;
  renamePerson: (email: string, name: string) => Promise<boolean>;
  mutateAlias?: (verb: "addAlias" | "removeAlias", email: string, alias: string) => Promise<boolean>;
  /** Reported through the shared status line the other tabs write to. */
  onNotice: (message: string) => void;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  // Which row has its alias panel open. One at a time, like `editing`: an alias
  // is read against the person it belongs to, and several open panels of bare
  // addresses stop being attributable at a glance.
  const [aliasRow, setAliasRow] = useState<string | null>(null);
  // The picker owns its query text, so `form.reset()` cannot clear it.
  // Remounting on a new key is what returns it to empty after a success.
  const [addKey, setAddKey] = useState(0);

  function addMember(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    // The picker's field is hidden, so it cannot carry `required`, and an
    // unresolved query (nothing picked, no complete address typed) yields an
    // empty value here. The old `<input type="email" required>` blocked this
    // submit with a visible browser bubble; report it the same way a failed
    // mutation would be rather than doing nothing.
    const email = String(data.get("email") ?? "").trim();
    if (!email) {
      onNotice("Choose a person from the list, or type a full email address.");
      return;
    }
    void mutate({ verb: "addToGroup", email, group: String(data.get("group")) }).then((ok) => {
      if (ok) setAddKey((key) => key + 1);
    });
  }

  function saveName(event: FormEvent<HTMLFormElement>, email: string): void {
    event.preventDefault();
    const name = String(new FormData(event.currentTarget).get("name") ?? "").trim();
    if (!name) return;
    void renamePerson(email, name).then((ok) => {
      if (ok) setEditing(null);
    });
  }

  return (
    <section className="space-y-3">
      {groupsEnabled && (
        <form onSubmit={addMember} className="grid gap-2 rounded-xl bg-surface p-4 shadow-[0_0_0_1px_rgba(0,0,0,0.06)] sm:grid-cols-[1fr_180px_auto]">
          <PersonPicker
            key={addKey}
            candidates={candidates}
            name="email"
            label="Member email"
            disabled={pending}
          />
          <select className={inputClass} name="group" aria-label="Group">{Object.keys(access.groups).sort().map((group) => <option key={group}>{group}</option>)}</select>
          <button className={`${buttonClass} bg-accent text-white`} disabled={pending}>Add member</button>
        </form>
      )}
      {roster.map((email) => {
        const person = personFor(people, email);
        const groups = Object.entries(access.groups).filter(([, members]) => members.includes(email)).map(([group]) => group);
        const role = ROLE_NAMES.find((name) => access.roles[name]?.includes(email)) ?? access.default;
        return (
          <div key={email} className="grid gap-3 rounded-xl bg-surface p-4 shadow-[0_0_0_1px_rgba(0,0,0,0.06),0_1px_2px_-1px_rgba(0,0,0,0.06)] sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
            <div>
              {editing === email ? (
                <form onSubmit={(event) => saveName(event, email)} className="flex flex-wrap gap-2">
                  <input className={`${inputClass} min-w-0 flex-1`} name="name" defaultValue={person.name} aria-label={`Name for ${email}`} maxLength={120} required />
                  <button className={`${buttonClass} bg-accent text-white`} disabled={pending}>Save name</button>
                  <button type="button" className={`${buttonClass} text-ink-muted hover:bg-surface-hover`} onClick={() => setEditing(null)}>Cancel</button>
                </form>
              ) : (
                <p className="flex items-center gap-2 font-medium text-ink">
                  {/* `named`, not the default: this row is where a name is
                      edited, so collapsing the admin's own row to "You" hid the
                      result of their own edit. */}
                  <PersonChip person={person} variant="named" />
                  {peopleEnabled && (
                    <button type="button" className={`${buttonClass} px-2 text-xs font-normal text-ink-muted hover:bg-surface-hover`} disabled={pending} onClick={() => setEditing(email)}>
                      Edit name
                    </button>
                  )}
                  {aliasesEnabled && mutateAlias && (
                    <button
                      type="button"
                      className={`${buttonClass} px-2 text-xs font-normal text-ink-muted hover:bg-surface-hover`}
                      aria-expanded={aliasRow === email}
                      onClick={() => setAliasRow((open) => (open === email ? null : email))}
                    >
                      Aliases ({(aliases[email] ?? []).length})
                    </button>
                  )}
                </p>
              )}
              {/* The address, printed rather than left in a hover title.
                  Everywhere else a name is enough and the address is a detail;
                  here the address IS the row, it is what every control on it
                  edits, and one person can legitimately hold several. Three
                  rows reading "Nick" with the address one hover away made a
                  page about identities unable to tell identities apart.
                  Suppressed when the name IS the address (people directory off,
                  or nobody has named this person yet), which would otherwise
                  print the same string twice. */}
              {person.name !== email && (
                <p className="mt-0.5 font-mono text-xs text-ink-faint">{email}</p>
              )}
              <div className="mt-2 flex flex-wrap gap-1.5">{groups.map((group) => <span key={group} className="rounded-full bg-surface-2 px-2.5 py-1 text-xs text-ink-muted">{group}</span>)}</div>
              {aliasesEnabled && mutateAlias && aliasRow === email && (
                <AccessAliases
                  email={email}
                  name={person.name}
                  aliases={aliases[email] ?? []}
                  groups={groups}
                  pending={pending}
                  mutateAlias={mutateAlias}
                  onNotice={onNotice}
                />
              )}
            </div>
            <select aria-label={`Role for ${email}`} className={inputClass} value={role} disabled={!rolesEnabled || pending} onChange={(event) => void mutate({ verb: "setRole", email, role: event.target.value as Role })}>
              {ROLE_NAMES.map((name) => <option key={name}>{name}</option>)}
            </select>
          </div>
        );
      })}
    </section>
  );
}
