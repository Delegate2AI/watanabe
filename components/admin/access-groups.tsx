"use client";

import { useState, type FormEvent } from "react";
import { PersonChip, personFor } from "@/components/person-chip";
import type { AccessChange, AccessState } from "@/lib/authority/access";
import type { Person } from "@/lib/people/types";
import { buttonClass, inputClass } from "./access-ui";
import { PersonPicker } from "./person-picker";

/**
 * The Groups tab.
 *
 * Each group carries its own "Add member" control. Removing someone was always
 * possible from here, adding was not: it lived on the Members tab behind a
 * group picker, so putting one person into one group meant leaving the group
 * you were looking at.
 */

function GroupCard({
  group,
  members,
  people,
  candidates,
  groupsEnabled,
  pending,
  mutate,
  onNotice,
}: {
  group: string;
  members: string[];
  people: Record<string, Person>;
  candidates: readonly Person[];
  groupsEnabled: boolean;
  pending: boolean;
  mutate: (change: AccessChange) => Promise<boolean>;
  /** Reported through the shared status line the other tabs write to. */
  onNotice: (message: string) => void;
}) {
  const [adding, setAdding] = useState(false);

  function addMember(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const form = event.currentTarget;
    const email = String(new FormData(form).get("email") ?? "").trim();
    // The picker's field is hidden, so it cannot carry `required`, and an
    // unresolved query (nothing picked, no complete address typed) yields an
    // empty value here. The old `<input type="email" required>` blocked this
    // submit with a visible browser bubble; a silent no-op is a real defect on
    // an access-administration surface, so report it the same way a failed
    // mutation would be.
    if (!email) {
      onNotice("Choose a person from the list, or type a full email address.");
      return;
    }
    void mutate({ verb: "addToGroup", group, email }).then((ok) => {
      if (ok) {
        form.reset();
        setAdding(false);
      }
    });
  }

  return (
    <article className="rounded-xl bg-surface p-4 shadow-[0_0_0_1px_rgba(0,0,0,0.06)]">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="font-semibold text-ink text-balance">{group}</h3>
        <div className="flex items-center gap-1">
          <button
            type="button"
            className={`${buttonClass} text-accent hover:bg-surface-hover`}
            disabled={!groupsEnabled || pending || adding}
            onClick={() => setAdding(true)}
          >
            Add member
          </button>
          <button
            className={`${buttonClass} text-danger hover:bg-surface-hover`}
            disabled={!groupsEnabled || pending}
            onClick={() => void mutate({ verb: "deleteGroup", group })}
          >
            Delete
          </button>
        </div>
      </div>
      {adding && (
        <form onSubmit={addMember} className="mt-3 flex flex-wrap gap-2">
          <PersonPicker
            candidates={candidates}
            exclude={members}
            name="email"
            label={`Email to add to ${group}`}
            disabled={pending}
          />
          <button className={`${buttonClass} bg-accent text-white`} disabled={pending}>Add</button>
          <button
            type="button"
            className={`${buttonClass} text-ink-muted hover:bg-surface-hover`}
            onClick={() => setAdding(false)}
          >
            Cancel
          </button>
        </form>
      )}
      <ul className="divide-y divide-line">
        {members.map((email) => (
          <li key={email} className="flex min-h-11 items-center justify-between gap-3 text-sm">
            <PersonChip person={personFor(people, email)} />
            <button
              className={`${buttonClass} text-ink-muted hover:bg-surface-hover`}
              disabled={!groupsEnabled || pending}
              onClick={() => void mutate({ verb: "removeFromGroup", group, email })}
            >
              Remove
            </button>
          </li>
        ))}
      </ul>
    </article>
  );
}

export function AccessGroups({
  access,
  people,
  candidates = [],
  groupsEnabled,
  pending,
  mutate,
  onNotice,
}: {
  access: AccessState;
  people: Record<string, Person>;
  candidates?: readonly Person[];
  groupsEnabled: boolean;
  pending: boolean;
  mutate: (change: AccessChange) => Promise<boolean>;
  /** Reported through the shared status line the other tabs write to. */
  onNotice: (message: string) => void;
}) {
  function createGroup(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    // The API only accepts a lowercase slug (/^[a-z0-9][a-z0-9-]*$/); a raw
    // "Marketing" or "Sales & Marketing" would 400 with the opaque "invalid
    // access change". Normalize to that slug here so the typed name just works,
    // and guard the empty case with a readable message instead of a failed POST.
    const raw = String(new FormData(event.currentTarget).get("group"));
    const slug = raw.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
    if (!slug) {
      onNotice("Enter a group name using letters, numbers, or hyphens.");
      return;
    }
    void mutate({ verb: "createGroup", group: slug });
  }

  return (
    <section className="space-y-3">
      {groupsEnabled && (
        <form onSubmit={createGroup} className="flex gap-2 rounded-xl bg-surface p-4 shadow-[0_0_0_1px_rgba(0,0,0,0.06)]">
          <input className={`${inputClass} min-w-0 flex-1`} name="group" placeholder="New group" required />
          <button className={`${buttonClass} bg-accent text-white`} disabled={pending}>Create group</button>
        </form>
      )}
      {Object.entries(access.groups).sort(([a], [b]) => a.localeCompare(b)).map(([group, members]) => (
        <GroupCard
          key={group}
          group={group}
          members={members}
          people={people}
          candidates={candidates}
          groupsEnabled={groupsEnabled}
          pending={pending}
          mutate={mutate}
          onNotice={onNotice}
        />
      ))}
    </section>
  );
}
