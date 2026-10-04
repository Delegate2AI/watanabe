"use client";

import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { personLabel } from "@/components/person-view";
import type { Person } from "@/lib/people/types";
import { inputClass } from "./access-ui";

/**
 * A combobox over the people the portal already knows about.
 *
 * It is a combobox and not a dropdown on purpose: the directory only holds
 * people who have signed in at least once, and pre-authorizing somebody before
 * their first login is a normal administrative act. A valid address that
 * matches nobody is offered as an explicit "as typed" row rather than accepted
 * silently, so that stays a deliberate choice instead of a typo.
 *
 * The chosen email leaves through a hidden input, which is what lets both
 * calling forms keep their existing `<form onSubmit>` + `FormData` shape. The
 * component is presentation only: `/api/access` remains the authority on
 * whether an address is acceptable.
 */

/** Enough rows to scan without turning the form into a scroll region. */
const MAX_VISIBLE = 8;

function normalize(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Deliberately duplicated from the address-resolution helper rather than
 * imported: that helper reaches `node:fs` through the directory loader, and a
 * `"use client"` module that pulls it in fails Turbopack code generation.
 */
function isEmail(value: string): boolean {
  const at = value.indexOf("@");
  return at > 0 && at === value.lastIndexOf("@") && at < value.length - 1 && !/\s/.test(value);
}

export function PersonPicker({
  candidates,
  exclude = [],
  name,
  label,
  placeholder = "person@example.com",
  disabled = false,
}: {
  candidates: readonly Person[];
  exclude?: readonly string[];
  name: string;
  label: string;
  placeholder?: string;
  disabled?: boolean;
}): ReactNode {
  const listId = useId();
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState("");
  const [open, setOpen] = useState(false);
  // `null` means nothing is highlighted. Typing must never imply a selection:
  // only ArrowDown/ArrowUp (or hovering a row) create a highlight, so Enter
  // never commits a candidate the admin did not explicitly navigate to.
  const [active, setActive] = useState<number | null>(null);
  const blurTimeout = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (blurTimeout.current !== null) window.clearTimeout(blurTimeout.current);
    };
  }, []);

  const excluded = useMemo(() => new Set(exclude.map(normalize)), [exclude]);
  const matches = useMemo(() => {
    const needle = normalize(query);
    return candidates
      .filter((person) => !excluded.has(person.email))
      .filter((person) => !needle
        || person.email.includes(needle)
        || person.name.toLowerCase().includes(needle))
      .slice(0, MAX_VISIBLE);
  }, [candidates, excluded, query]);

  const typed = normalize(query);
  // Only offered when nothing in the directory already matches: a partial hit
  // (e.g. typing an existing person's address one character short) means the
  // right move is to pick that row, not add a near-duplicate "as typed" one.
  const asTyped = isEmail(typed) && matches.length === 0 ? typed : "";
  const rows = asTyped ? [...matches.map((person) => person.email), asTyped] : matches.map((person) => person.email);
  // A typed-but-unpicked address still submits, so typing a full address and
  // pressing Add works exactly as it did before this control existed.
  const value = picked || (isEmail(typed) ? typed : "");

  function choose(email: string): void {
    setPicked(email);
    // The address, not the label: the label collapses to just the name for
    // anyone but the viewer, which stops being a confirmation of which
    // address was granted the moment two directory rows share a name. It also
    // keeps the field re-filterable, since choosing yourself would otherwise
    // set the query to "You (address)", which matches no candidate.
    setQuery(email);
    setOpen(false);
    // A highlight only exists once an arrow key creates one, so a completed
    // selection must not leave one behind for the next open to inherit.
    setActive(null);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!open) {
        setOpen(true);
        // The list may have been closed by a blur rather than a choice, which
        // does not clear the highlight on its own. Start fresh rather than
        // reopening onto whatever row was last active.
        setActive(null);
        return;
      }
      if (rows.length === 0) return;
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActive((current) => {
        if (current === null) return event.key === "ArrowDown" ? 0 : rows.length - 1;
        return (current + step + rows.length) % rows.length;
      });
      return;
    }
    // Enter picks the highlighted row instead of submitting the form: the Add
    // button is the only thing that commits a membership change, so a stray
    // Enter must not post whatever was half-typed. But when nothing is
    // highlighted, Enter must fall through to the form's own submit instead
    // of guessing a candidate: a typed, complete address is what the admin
    // meant, not whichever row happens to contain it as a substring.
    if (event.key === "Enter" && open && active !== null && rows[active]) {
      event.preventDefault();
      choose(rows[active]);
      return;
    }
    if (event.key === "Escape") {
      setOpen(false);
      setActive(null);
    }
  }

  const listRendered = open && rows.length > 0;

  return (
    <div className="relative min-w-0 flex-1">
      <input type="hidden" name={name} value={value} />
      <input
        className={`${inputClass} w-full`}
        role="combobox"
        aria-expanded={listRendered}
        aria-controls={listRendered ? listId : undefined}
        aria-autocomplete="list"
        aria-activedescendant={active !== null && rows[active] ? `${listId}-${active}` : undefined}
        aria-label={label}
        placeholder={placeholder}
        disabled={disabled}
        autoComplete="off"
        inputMode="email"
        spellCheck={false}
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setPicked("");
          setActive(null);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        // Deferred: a blur that lands on an option must not close the list
        // before the click on it registers. Clear any pending timeout first
        // so a rapid blur/focus/blur sequence cannot pile up callbacks, and
        // clear it on unmount so a fast unmount after blur never schedules a
        // state update on a gone component.
        onBlur={() => {
          if (blurTimeout.current !== null) window.clearTimeout(blurTimeout.current);
          blurTimeout.current = window.setTimeout(() => {
            setOpen(false);
            // Clearing the highlight where the list actually closes covers the
            // hover case too: a row hovered before blurring must not still be
            // highlighted on the next focus, where Enter would commit a row the
            // admin never navigated to in this session.
            setActive(null);
          }, 120);
        }}
        onKeyDown={onKeyDown}
      />
      {listRendered && (
        <ul
          id={listId}
          role="listbox"
          aria-label={label}
          className="absolute z-20 mt-1 max-h-72 w-full overflow-y-auto rounded-lg bg-surface py-1 shadow-[0_0_0_1px_rgba(0,0,0,0.06),0_8px_24px_-8px_rgba(0,0,0,0.25)]"
        >
          {rows.map((email, index) => {
            const person = candidates.find((candidate) => candidate.email === email);
            return (
              <li
                key={email}
                id={`${listId}-${index}`}
                role="option"
                aria-selected={index === active}
                className={`cursor-pointer px-3 py-2 text-sm ${index === active ? "bg-surface-hover" : ""}`}
                onMouseEnter={() => setActive(index)}
                // Keeps focus on the input, so the deferred blur close does not
                // race the click handler.
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => choose(email)}
              >
                {person ? (
                  <>
                    <span className="block truncate text-ink">{personLabel(person, "option")}</span>
                    <span className="block truncate text-xs text-ink-muted">{person.email}</span>
                  </>
                ) : (
                  <span className="block truncate text-ink">Use &quot;{email}&quot; as typed</span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
