"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil } from "lucide-react";
import { useMutation } from "@/lib/ui/use-mutation";

/**
 * The project's description and working context (spec 26, surface-polish P-11).
 *
 * The page used to be a permanent edit form: two raw inputs and an always
 * enabled Save, for owner and non-owner alike, with no signal about who may
 * change anything. It now READS by default, in prose, and an owner opts into
 * editing. Save is enabled only when the form is actually dirty, and it reports
 * through the toast path rather than an inline "Saved" that nobody sees.
 *
 * The context is instructions the agent loads for threads in this project. It
 * never widens KB clearance (enforced server-side in buildOptions).
 */
export function ProjectContextEditor({
  projectId,
  description,
  context,
  canEdit,
}: {
  projectId: string;
  description: string | null;
  context: string | null;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [saved, setSaved] = useState({ description: description ?? "", context: context ?? "" });
  const [desc, setDesc] = useState(saved.description);
  const [ctx, setCtx] = useState(saved.context);

  const dirty = desc !== saved.description || ctx !== saved.context;

  const save = useMutation({
    success: "Project updated.",
    onSuccess: () => {
      setSaved({ description: desc, context: ctx });
      setEditing(false);
      router.refresh();
    },
  });

  // The unsaved-changes guard. A half-typed working context is real work, and
  // before this there was nothing between it and a stray reload.
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  function cancel() {
    setDesc(saved.description);
    setCtx(saved.context);
    setEditing(false);
  }

  if (!editing) {
    return (
      <div className="flex flex-col gap-3">
        <div className="flex items-start justify-between gap-4">
          {saved.description ? (
            <p className="text-ink-muted">{saved.description}</p>
          ) : (
            <p className="text-sm text-ink-faint">No description yet.</p>
          )}
          {canEdit ? (
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-line px-3 py-1.5 text-sm text-ink hover:border-accent"
            >
              <Pencil className="size-4" aria-hidden />
              Edit
            </button>
          ) : null}
        </div>
        {saved.context ? (
          <div className="rounded-xl border border-line bg-surface-2 p-4">
            <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-muted">Working context</h3>
            <p className="whitespace-pre-wrap text-sm text-ink">{saved.context}</p>
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-xs font-semibold uppercase tracking-wide text-ink-muted">Description</span>
        <input
          aria-label="Description"
          value={desc}
          onChange={(e) => setDesc(e.target.value)}
          className="rounded-md border border-line bg-surface px-3 py-1.5 text-ink"
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-xs font-semibold uppercase tracking-wide text-ink-muted">Working context</span>
        <textarea
          aria-label="Working context"
          value={ctx}
          onChange={(e) => setCtx(e.target.value)}
          rows={5}
          className="rounded-md border border-line bg-surface px-3 py-1.5 text-ink"
        />
      </label>
      <div className="flex items-center gap-3">
        <button
          type="button"
          disabled={!dirty || save.pending}
          onClick={() =>
            void save.run({
              url: `/api/projects/${encodeURIComponent(projectId)}`,
              method: "PATCH",
              body: { action: "update", description: desc || null, context: ctx || null },
            })
          }
          className="rounded-md bg-accent px-3 py-1.5 text-sm text-white hover:bg-accent-ink disabled:opacity-50"
        >
          Save
        </button>
        <button type="button" onClick={cancel} className="text-sm text-ink-muted hover:text-ink">
          Cancel
        </button>
      </div>
    </div>
  );
}
