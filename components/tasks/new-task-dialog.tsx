"use client";

import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Plus, X } from "lucide-react";
import { messageForBody } from "@/lib/errors/messages";
import { AssigneePicker } from "./assignee-picker";
import type { Person } from "@/lib/people/types";

const FIELD = "mt-1.5 w-full rounded-lg border border-line bg-surface-2 px-3 py-2 text-sm text-ink";
const LABEL = "block text-sm font-medium text-ink";

/**
 * New task trigger + centered modal form. Posts to POST /api/tasks (manual
 * origin). The visibility select is restricted to the caller's own groups
 * (myGroups); the assignee select is the full roster. The form opens as a modal
 * centered over a backdrop scrim; it closes on Cancel, the close button, a
 * backdrop click, or Escape. On success it closes and refreshes so the server
 * page re-reads the board.
 */
export function NewTaskDialog({
  members,
  people,
  myGroups,
}: {
  members: string[];
  /**
   * Resolved people for the assignee labels. Every other task surface renders a
   * person by name through `MemberOptions`; this dialog listed raw email
   * addresses, which is the one place the directory's "names, not addresses"
   * promise broke.
   */
  people: Record<string, Person>;
  myGroups: string[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [assignees, setAssignees] = useState<string[]>([]);
  const [due, setDue] = useState("");
  const [clearance, setClearance] = useState(myGroups[0] ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  // Close the modal on Escape while it is open.
  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  function reset() {
    setTitle(""); setDescription(""); setAssignees([]); setDue(""); setError(null);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (title.trim().length === 0) {
      setError("Title is required");
      return;
    }
    setPending(true);
    const response = await fetch("/api/tasks", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: title.trim(),
        description: description.trim(),
        ...(assignees.length > 0 ? { assignees } : {}),
        ...(due ? { due } : {}),
        clearance,
      }),
    });
    setPending(false);
    if (!response.ok) {
      const result = await response.json().catch(() => null);
      setError(messageForBody(result));
      return;
    }
    setOpen(false);
    reset();
    router.refresh();
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white hover:bg-accent-ink"
      >
        <Plus className="size-4" aria-hidden />
        New task
      </button>
      {open ? (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4"
          role="presentation"
          onClick={(event) => {
            if (event.target === event.currentTarget) setOpen(false);
          }}
        >
          <form
            onSubmit={submit}
            role="dialog"
            aria-modal="true"
            aria-label="New task"
            className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-line bg-surface p-6 shadow-xl"
          >
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-ink">New task</h2>
              <button
                type="button"
                aria-label="Close"
                onClick={() => setOpen(false)}
                className="grid size-8 place-items-center rounded-md text-ink-muted hover:bg-surface-2 hover:text-ink"
              >
                <X className="size-4" aria-hidden />
              </button>
            </div>

            <div className="mt-5 space-y-4">
              <label className={LABEL}>
                Title
                <input value={title} onChange={(event) => setTitle(event.target.value)} className={FIELD} />
              </label>
              <label className={LABEL}>
                Description
                <textarea value={description} rows={3} onChange={(event) => setDescription(event.target.value)} className={FIELD} />
              </label>
              <div className={LABEL}>
                Assignee
                <AssigneePicker
                  id="new-task-assignee"
                  label="Assignee"
                  members={members}
                  people={people}
                  value={assignees}
                  onChange={setAssignees}
                />
              </div>
              <label className={LABEL}>
                Due
                <input type="date" value={due} onChange={(event) => setDue(event.target.value)} className={FIELD} />
              </label>
              <label className={LABEL}>
                Visibility
                <select value={clearance} onChange={(event) => setClearance(event.target.value)} className={FIELD}>
                  {myGroups.map((group) => (
                    <option key={group} value={group}>{group}</option>
                  ))}
                </select>
              </label>
            </div>

            {error ? <p role="alert" className="mt-4 text-sm text-warn">{error}</p> : null}
            <div className="mt-6 flex justify-end gap-2">
              <button type="button" onClick={() => setOpen(false)} className="rounded-md border border-line px-4 py-2 text-sm text-ink hover:bg-surface-2">Cancel</button>
              <button type="submit" disabled={pending} className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-ink disabled:opacity-50">Create</button>
            </div>
          </form>
        </div>
      ) : null}
    </>
  );
}
