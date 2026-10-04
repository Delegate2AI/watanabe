"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { messageForBody } from "@/lib/errors/messages";

/**
 * The "New project" action for the `/projects` grid (spec 26). Opens a minimal
 * inline form (name + optional description), POSTs to `/api/projects`, and on
 * success navigates to the new project's detail. Clearance defaults to the
 * caller's own server-side, so this form does not (and must not) set it.
 */
export function NewProjectButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function create() {
    setError(null);
    startTransition(async () => {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, description: description || undefined }),
      });
      const body = (await res.json().catch(() => null)) as { project?: { id: string } } | null;
      if (!res.ok || !body?.project) {
        setError(messageForBody(body));
        return;
      }
      router.push(`/projects/${body.project.id}`);
      router.refresh();
    });
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-control border border-line bg-surface px-3 py-1.5 text-sm font-medium text-ink hover:bg-surface-2"
      >
        <Plus className="size-4" aria-hidden />
        New project
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-line bg-surface p-4">
      <input
        aria-label="Project name"
        placeholder="Project name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        className="rounded-md border border-line bg-surface-2 px-3 py-1.5 text-sm text-ink"
      />
      <input
        aria-label="Project description"
        placeholder="Description (optional)"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        className="rounded-md border border-line bg-surface-2 px-3 py-1.5 text-sm text-ink"
      />
      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={pending || name.trim().length === 0}
          onClick={create}
          className="rounded-md bg-accent px-3 py-1.5 text-sm text-white hover:bg-accent-ink disabled:opacity-50"
        >
          Create
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => setOpen(false)}
          className="rounded-md border border-line px-3 py-1.5 text-sm text-ink hover:bg-surface-2"
        >
          Cancel
        </button>
      </div>
      {error ? <p role="alert" className="text-sm text-warn">{error}</p> : null}
    </div>
  );
}
