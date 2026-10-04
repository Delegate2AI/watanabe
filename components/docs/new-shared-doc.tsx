"use client";

import { useState } from "react";
import type { FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Plus, X } from "lucide-react";
import { messageForBody } from "@/lib/errors/messages";

const FIELD = "mt-1.5 w-full rounded-lg border border-line bg-surface-2 px-3 py-2 text-sm text-ink";
const LABEL = "block text-sm font-medium text-ink";

/**
 * Create a shared document (spec 28).
 *
 * The surface promised this and did not offer it: the empty state read "You are
 * not sharing any documents yet. Create one, then add people who can view,
 * comment, or edit", while the only control on the page was a filter box.
 * `POST /api/docs` already existed and was reachable only by sharing an
 * artifact, so a contributor who simply wanted a document had no route to one.
 *
 * Deliberately minimal: a title and an optional first paragraph. Sharing stays
 * where it already lives, on the document itself, so this dialog never has to
 * grow a recipient picker. On success we go straight to the new document, which
 * is where the share controls are.
 */
export function NewSharedDoc() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function close() {
    setOpen(false);
    setError(null);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy || title.trim() === "") return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/docs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        // The API requires a non-empty body, so a document created with no
        // opening paragraph is seeded with its own title rather than rejected.
        body: JSON.stringify({ title: title.trim(), body: body.trim() || `# ${title.trim()}\n` }),
      });
      if (!res.ok) {
        setError(messageForBody(await res.json().catch(() => null)));
        return;
      }
      const { id } = (await res.json()) as { id: string };
      close();
      router.push(`/docs/${id}`);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-white hover:opacity-90"
      >
        <Plus className="size-4" />
        New document
      </button>
    );
  }

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/30 p-4"
      onClick={close}
      onKeyDown={(event) => {
        if (event.key === "Escape") close();
      }}
      role="presentation"
    >
      <form
        onSubmit={submit}
        onClick={(event) => event.stopPropagation()}
        aria-label="New document"
        className="w-full max-w-md rounded-xl border border-line bg-surface p-5 shadow-elevated"
      >
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-ink">New document</h2>
          <button type="button" onClick={close} aria-label="Close" className="text-ink-muted hover:text-ink">
            <X className="size-4" />
          </button>
        </div>

        {error ? <p className="mt-3 text-sm text-warn" role="alert">{error}</p> : null}

        <div className="mt-4 space-y-4">
          <label className={LABEL}>
            Title
            <input value={title} onChange={(event) => setTitle(event.target.value)} className={FIELD} />
          </label>
          <label className={LABEL}>
            First paragraph (optional)
            <textarea value={body} rows={4} onChange={(event) => setBody(event.target.value)} className={FIELD} />
          </label>
        </div>

        <p className="mt-3 text-xs text-ink-faint">
          Private to you until you share it. Add people from the document itself.
        </p>

        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={close}
            className="rounded-lg border border-line px-3 py-1.5 text-sm font-medium text-ink-muted hover:text-ink"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy || title.trim() === ""}
            className="rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-60"
          >
            Create
          </button>
        </div>
      </form>
    </div>
  );
}
