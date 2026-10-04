"use client";

import { useState } from "react";

/**
 * The destructive footer of the artifact detail view (spec 27): a two-step
 * delete for an artifact and its version history.
 *
 * Split out of `artifact-editor.tsx` purely to keep that file under the
 * file-size limit; it owns nothing but its own confirm/cancel toggle, and the
 * actual deletion stays with the editor, which knows how to leave the page
 * afterwards. Rendered only for an artifact that is not yet published: a
 * published note lives in the KB and is retracted there, not here.
 */
export function DeleteArtifact({
  noun,
  busy,
  onDelete,
}: {
  noun: string;
  busy: boolean;
  onDelete: () => void;
}) {
  const [confirming, setConfirming] = useState(false);

  return (
    <div className="mt-2 border-t border-line pt-4">
      {confirming ? (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-ink-muted">
            Delete this {noun} and its version history? This cannot be undone.
          </span>
          <button
            type="button"
            onClick={onDelete}
            disabled={busy}
            className="rounded-md bg-warn px-3 py-1 font-medium text-white hover:opacity-90 disabled:opacity-60"
          >
            Delete
          </button>
          <button
            type="button"
            onClick={() => setConfirming(false)}
            disabled={busy}
            className="rounded-md border border-line px-3 py-1 font-medium text-ink-muted hover:text-ink disabled:opacity-60"
          >
            Cancel
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          disabled={busy}
          className="text-sm font-medium text-warn hover:underline disabled:opacity-60"
        >
          Delete {noun}
        </button>
      )}
    </div>
  );
}
