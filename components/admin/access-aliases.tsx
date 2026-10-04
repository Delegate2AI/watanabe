"use client";

import { useState, type FormEvent } from "react";
import { buttonClass, inputClass } from "./access-ui";

/**
 * The alias panel for one member row: the other addresses that resolve to this
 * person, with an add field and a remove control per address.
 *
 * Its own file rather than more of access-members.tsx, which is already the
 * longest of the access tabs, and because the add flow carries a confirm state
 * that has nothing to do with the row around it.
 *
 * An alias is clearance-granting: a session authenticated under it resolves to
 * this person and reads everything their groups can see. So adding one is two
 * steps, and the second names the clearance being handed over. Removing is one
 * step, because removing only ever narrows.
 */
export function AccessAliases({
  email,
  name,
  aliases,
  groups,
  pending,
  mutateAlias,
  onNotice,
}: {
  /** The canonical portal address the aliases resolve to. */
  email: string;
  /** How the row names this person, so the warning reads as the row does. */
  name: string;
  aliases: readonly string[];
  /** This person's clearance, already resolved by the row for its group chips. */
  groups: readonly string[];
  pending: boolean;
  mutateAlias: (verb: "addAlias" | "removeAlias", email: string, alias: string) => Promise<boolean>;
  onNotice: (message: string) => void;
}) {
  // The address awaiting confirmation. Held here rather than read back off the
  // input at confirm time, so what the admin agreed to is what gets sent.
  const [confirming, setConfirming] = useState<string | null>(null);
  // Remounts the add field to clear it after a success, the same trick the
  // member picker above uses: form.reset() cannot reach a controlled child.
  const [addKey, setAddKey] = useState(0);

  function requestAdd(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const alias = String(new FormData(event.currentTarget).get("alias") ?? "").trim().toLowerCase();
    if (!alias) {
      onNotice("Type the address to add as an alias.");
      return;
    }
    if (alias === email.toLowerCase() || aliases.includes(alias)) {
      onNotice(`${alias} already resolves to ${email}.`);
      return;
    }
    setConfirming(alias);
  }

  function confirmAdd(): void {
    const alias = confirming;
    if (!alias) return;
    void mutateAlias("addAlias", email, alias).then((ok) => {
      if (!ok) return;
      setConfirming(null);
      setAddKey((key) => key + 1);
    });
  }

  return (
    <div className="mt-3 rounded-lg bg-surface-2 p-3" data-testid={`aliases-${email}`}>
      {aliases.length === 0 ? (
        <p className="text-xs text-ink-muted">No other addresses resolve to {email}.</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {aliases.map((alias) => (
            <li key={alias} className="flex items-center justify-between gap-2 text-sm text-ink">
              <span className="min-w-0 truncate font-mono text-xs">{alias}</span>
              <button
                type="button"
                className={`${buttonClass} px-2 text-xs font-normal text-ink-muted hover:bg-surface-hover`}
                disabled={pending}
                onClick={() => void mutateAlias("removeAlias", email, alias)}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}

      {confirming ? (
        <div className="mt-3 rounded-lg bg-surface p-3" role="group" aria-label={`Confirm alias for ${email}`}>
          <p className="text-sm text-ink">
            Add <span className="font-mono text-xs">{confirming}</span> as an alias of {name}?
          </p>
          <p className="mt-1 text-xs text-ink-muted">
            {/* Clearance AND role: an alias is one identity claim, and both
                halves of authority honour it. Naming only the groups would
                understate what the button grants. */}
            Anyone signing in as that address will have {name}&apos;s role, and their clearance:{" "}
            <span className="text-ink">{groups.length > 0 ? groups.join(", ") : "all-hands"}</span>.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" className={`${buttonClass} bg-accent text-white`} disabled={pending} onClick={confirmAdd}>
              Add alias
            </button>
            <button
              type="button"
              className={`${buttonClass} text-ink-muted hover:bg-surface-hover`}
              onClick={() => setConfirming(null)}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <form key={addKey} onSubmit={requestAdd} className="mt-3 flex flex-wrap gap-2">
          <input
            className={`${inputClass} min-w-0 flex-1`}
            name="alias"
            type="email"
            placeholder="another address for this person"
            aria-label={`Add an alias for ${email}`}
            maxLength={254}
            disabled={pending}
          />
          <button className={`${buttonClass} text-ink hover:bg-surface-hover`} disabled={pending}>
            Add alias
          </button>
        </form>
      )}
    </div>
  );
}
