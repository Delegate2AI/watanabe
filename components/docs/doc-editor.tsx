"use client";

import { useState } from "react";
import { Markdown } from "@/components/ui/markdown";
import { HtmlDocument } from "@/components/ui/html-document";
import { BodyEditor } from "@/components/ui/body-editor";

/**
 * The shared-doc body view/editor (spec 28). Read-only markdown for anyone who
 * can read; when `canEdit`, an inline edit toggle appends a new version via
 * PATCH /api/docs/[id] (last-writer-wins). The edit affordance is rendered ONLY
 * when the server-resolved access allows it, never gated in the client alone.
 *
 * `initialEditing`/`onSaved`/`onCancel` are optional hooks for a caller that
 * embeds this component inside a larger flow (the annotated-doc surface,
 * spec 2026-07-22): they default to off/no-op, so the plain `<DocEditor id
 * initialBody canEdit />` call in the flag-off page path is unaffected.
 */
export function DocEditor({
  id, initialBody, canEdit, initialEditing = false, onSaved, onCancel, richEditorEnabled = false,
  format = "md",
}: {
  id: string;
  initialBody: string;
  /** What the body IS. A designed page is shown, never edited as markdown. */
  format?: "md" | "html";
  canEdit: boolean;
  initialEditing?: boolean;
  onSaved?: () => void;
  onCancel?: () => void;
  /** RICH_EDITOR_ENABLED, resolved on the server. Off keeps the raw textarea. */
  richEditorEnabled?: boolean;
}) {
  const [body, setBody] = useState(initialBody);
  const [draft, setDraft] = useState(initialBody);
  const [editing, setEditing] = useState(initialEditing);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/docs/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ body: draft }),
      });
      if (!res.ok) {
        setError("Could not save your changes.");
        return;
      }
      setBody(draft);
      setEditing(false);
      onSaved?.();
    } catch {
      setError("Could not save your changes.");
    } finally {
      setSaving(false);
    }
  }

  if (editing) {
    return (
      <div className="flex flex-col gap-3">
        {richEditorEnabled ? (
          <BodyEditor value={draft} onChange={setDraft} label="Document body" />
        ) : (
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            className="min-h-[320px] w-full rounded-card border border-line bg-surface-2 p-4 font-mono text-sm text-ink"
          />
        )}
        {error && <p className="text-sm text-warn">{error}</p>}
        <div className="flex gap-2">
          <button
            type="button"
            onClick={save}
            disabled={saving}
            className="rounded-chip bg-accent px-3 py-1.5 text-sm font-medium text-white disabled:opacity-60"
          >
            {saving ? "Saving..." : "Save version"}
          </button>
          <button
            type="button"
            onClick={() => {
              setDraft(body);
              setEditing(false);
              setError(null);
              onCancel?.();
            }}
            className="rounded-chip border border-line px-3 py-1.5 text-sm text-ink-muted"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  // A designed page is read-only here whatever the permissions say. Its body is
  // a whole HTML document; editing it as markdown would half-break it into
  // something neither renderer can read, and the markdown renderer discards raw
  // HTML rather than printing it, so a promoted designed document showed blank.
  if (format === "html") {
    return (
      <div className="h-[75vh] min-h-96 overflow-hidden rounded-card border border-line bg-surface-2">
        <HtmlDocument html={body} title="Document" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <article className="rounded-card border border-line bg-surface-2 p-6">
        <Markdown>{body}</Markdown>
      </article>
      {canEdit && (
        <div>
          <button
            type="button"
            onClick={() => {
              setDraft(body);
              setEditing(true);
            }}
            className="rounded-chip border border-line px-3 py-1.5 text-sm text-ink-muted hover:text-ink"
          >
            Edit
          </button>
        </div>
      )}
    </div>
  );
}
