"use client";

import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Folder, FolderPlus } from "lucide-react";
import type { KbTargetOptions } from "@/lib/kb/target-options";
import { isCreatableFolder, joinTargetPath, normalizeFolderInput, normalizeNameInput } from "@/lib/kb/target-path";

/**
 * The publish destination, composed instead of typed (spec 2026-08-11
 * follow-up): a folder combobox over the folders that actually exist in the
 * requester's clearance-scoped vault, and a note name pre-suggested from the
 * document title. A folder that matches nothing is offered as an explicit
 * "New folder" row, so creating one stays a deliberate choice instead of a
 * typo. Combobox mechanics follow `components/admin/person-picker.tsx`:
 * typing never implies a selection, only arrows or hover highlight a row.
 */

const MAX_VISIBLE = 12;

function folderOf(path: string): string {
  const at = path.lastIndexOf("/");
  return at < 0 ? "" : path.slice(0, at);
}

function basenameOf(path: string): string {
  return (path.split("/").pop() ?? path).replace(/\.md$/i, "");
}

export function KbPathPicker({
  options,
  folder,
  name,
  disabled = false,
  onFolderChange,
  onNameChange,
}: {
  options: KbTargetOptions;
  folder: string;
  /** Extensionless: the field renders a fixed `.md` suffix. */
  name: string;
  disabled?: boolean;
  onFolderChange: (folder: string) => void;
  onNameChange: (name: string) => void;
}) {
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState<number | null>(null);
  const blurTimeout = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (blurTimeout.current !== null) window.clearTimeout(blurTimeout.current);
    };
  }, []);

  const typed = normalizeFolderInput(folder);
  const matches = useMemo(() => {
    const needle = typed.toLowerCase();
    return options.dirs.filter((dir) => !needle || dir.toLowerCase().includes(needle)).slice(0, MAX_VISIBLE);
  }, [options.dirs, typed]);
  // Offered only when nothing existing is an exact hit: picking an existing
  // folder must stay one keystroke cheaper than minting a near-duplicate.
  const creatable = typed !== "" && !options.dirs.includes(typed) && isCreatableFolder(typed);
  const rows = creatable ? [...matches, typed] : matches;

  const target = joinTargetPath(folder, name);
  const existing = target === "" ? undefined : options.notes.find((note) => note.path === target);
  // Deliberately not filtered by the typed name: these are context ("what is
  // already filed here"), and the prefilled slug would hide them all.
  const siblings = useMemo(() => {
    const current = normalizeNameInput(name);
    return options.notes
      .filter((note) => folderOf(note.path) === typed)
      .filter((note) => basenameOf(note.path) !== current)
      .slice(0, 5);
  }, [options.notes, typed, name]);

  function choose(dir: string): void {
    onFolderChange(dir);
    setOpen(false);
    setActive(null);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!open) {
        setOpen(true);
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
    if (event.key === "Enter" && open && active !== null && rows[active] !== undefined) {
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
    <div>
      <div className="flex flex-col gap-2 sm:flex-row">
        <label className="block min-w-0 flex-1 text-xs font-medium text-ink-muted">
          Folder
          <div className="relative mt-1">
            <input
              role="combobox"
              // Explicit: the wrapping label's computed name would swallow the
              // option texts whenever the list is open.
              aria-label="Folder"
              aria-expanded={listRendered}
              aria-controls={listRendered ? listId : undefined}
              aria-autocomplete="list"
              aria-activedescendant={active !== null && rows[active] !== undefined ? `${listId}-${active}` : undefined}
              placeholder="Top level (docs/)"
              disabled={disabled}
              autoComplete="off"
              spellCheck={false}
              value={folder}
              onChange={(event) => {
                onFolderChange(event.target.value);
                setActive(null);
                setOpen(true);
              }}
              onFocus={() => setOpen(true)}
              // Deferred close, so a blur landing on an option row does not
              // dismiss the list before its click registers.
              onBlur={() => {
                if (blurTimeout.current !== null) window.clearTimeout(blurTimeout.current);
                blurTimeout.current = window.setTimeout(() => {
                  setOpen(false);
                  setActive(null);
                }, 120);
              }}
              onKeyDown={onKeyDown}
              className="w-full rounded-md border border-line bg-surface px-2 py-1 text-sm text-ink disabled:opacity-60"
            />
            {listRendered && (
              <ul
                id={listId}
                role="listbox"
                aria-label="Knowledge base folders"
                className="absolute z-20 mt-1 max-h-64 w-full overflow-y-auto rounded-lg bg-surface py-1 shadow-[0_0_0_1px_rgba(0,0,0,0.06),0_8px_24px_-8px_rgba(0,0,0,0.25)]"
              >
                {rows.map((dir, index) => {
                  const isCreate = creatable && index === rows.length - 1;
                  return (
                    <li
                      key={isCreate ? `create:${dir}` : dir}
                      id={`${listId}-${index}`}
                      role="option"
                      aria-selected={index === active}
                      className={`flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm text-ink ${index === active ? "bg-surface-hover" : ""}`}
                      onMouseEnter={() => setActive(index)}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => choose(dir)}
                    >
                      {isCreate ? (
                        <FolderPlus className="size-3.5 shrink-0 text-ink-faint" aria-hidden />
                      ) : (
                        <Folder className="size-3.5 shrink-0 text-ink-faint" aria-hidden />
                      )}
                      <span className="truncate">{isCreate ? `New folder "${dir}/"` : `${dir}/`}</span>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </label>

        <label className="block min-w-0 flex-1 text-xs font-medium text-ink-muted">
          Note name
          <div className="mt-1 flex items-center rounded-md border border-line bg-surface focus-within:border-accent">
            <input
              value={name}
              disabled={disabled}
              autoComplete="off"
              spellCheck={false}
              onChange={(event) => onNameChange(event.target.value)}
              aria-label="Note name"
              className="w-full min-w-0 flex-1 rounded-md bg-transparent px-2 py-1 text-sm text-ink outline-none disabled:opacity-60"
            />
            <span className="pr-2 text-xs text-ink-faint" aria-hidden>
              .md
            </span>
          </div>
        </label>
      </div>

      {siblings.length > 0 ? (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-ink-faint">In this folder:</span>
          {siblings.map((note) => (
            <button
              key={note.path}
              type="button"
              disabled={disabled}
              onClick={() => onNameChange(basenameOf(note.path))}
              title={note.title}
              className="rounded-full bg-surface px-2.5 py-0.5 text-xs font-medium text-ink hover:bg-surface-hover disabled:opacity-50"
            >
              {basenameOf(note.path)}
            </button>
          ))}
        </div>
      ) : null}

      <p className="mt-2 text-xs text-ink-muted">
        <span className="font-mono text-ink">docs/{target === "" ? "…" : target}</span>{" "}
        {target === "" ? (
          "Give the note a name."
        ) : existing ? (
          <>Proposes an update to the existing note &quot;{existing.title}&quot;.</>
        ) : creatable ? (
          <>Creates a new note in the new folder &quot;{typed}/&quot;.</>
        ) : (
          "Creates a new note."
        )}
      </p>
    </div>
  );
}
