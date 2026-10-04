"use client";

import { HtmlDocument } from "@/components/ui/html-document";

/**
 * The "Try it" panel: one sample document written against the guide currently
 * in the editor.
 *
 * Rendered through the same `HtmlDocument` the canvas uses, which means the same
 * sandbox and the same policy. An admin preview is not a reason for a second,
 * looser way of putting model-authored markup on a page.
 */

export type PreviewState =
  | { status: "idle" }
  | { status: "running" }
  | { status: "ready"; html: string }
  | { status: "failed"; message: string };

export function DesignGuidePreview({ state }: { state: PreviewState }) {
  if (state.status === "idle") return null;

  return (
    <section className="mt-6" aria-label="Sample document">
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-semibold text-ink">Sample document</h2>
        <p className="text-xs text-ink-muted">
          Written against the guide in the editor above, saved or not. The ferry and its figures are invented.
        </p>
      </div>

      {state.status === "running" && (
        <p className="rounded-lg border border-line bg-surface p-4 text-sm text-ink-muted" role="status">
          Writing the sample document. A designed page takes a while.
        </p>
      )}

      {state.status === "failed" && (
        <p className="rounded-lg border border-line bg-surface p-4 text-sm text-ink-muted" role="status">
          {state.message}
        </p>
      )}

      {state.status === "ready" && (
        <div className="h-[70vh] overflow-hidden rounded-lg border border-line">
          <HtmlDocument html={state.html} title="Sample document" />
        </div>
      )}
    </section>
  );
}
