"use client";

import { useState } from "react";
import { Markdown } from "@/components/ui/markdown";
import { HtmlDocument } from "@/components/ui/html-document";
import { BodyEditor } from "@/components/ui/body-editor";
import { cn } from "@/lib/utils";

/**
 * The body surface of the artifact editor, in the two shapes the rich-editor
 * flag selects between.
 *
 * Flag OFF is the original edit/preview pair, unchanged: a raw markdown
 * textarea and a rendered preview, so every existing byte-path is identical.
 *
 * Flag ON hands authoring to `BodyEditor` (rich or markdown), whose rich mode
 * already renders the body, so a separate preview tab would be a third way to
 * look at the same thing. A locked artifact (published, or frozen behind an
 * open merge request) keeps the read-only render: it is the highest-fidelity
 * view, and there is nothing to author.
 */
export function ArtifactBody({
  body,
  onChange,
  locked,
  busy,
  richEditorEnabled,
  format = "md",
}: {
  body: string;
  onChange: (next: string) => void;
  /** What the body IS. A designed page is shown, never edited as markdown. */
  format?: "md" | "html";
  locked: boolean;
  busy: boolean;
  richEditorEnabled: boolean;
}) {
  // A designed page is read-only here whatever the flags say. Its body is a
  // whole HTML document; a markdown textarea or a rich editor would let somebody
  // half-edit it into something neither renderer can read, and the markdown
  // renderer discards raw HTML rather than printing it, so this surface showed a
  // promoted designed document as blank.
  if (format === "html") {
    return (
      <div className="h-[70vh] min-h-96 overflow-hidden rounded-chip border border-line bg-surface-2">
        <HtmlDocument html={body} title="Document preview" />
      </div>
    );
  }
  if (richEditorEnabled) {
    return locked ? (
      <ReadOnlyBody body={body} />
    ) : (
      <BodyEditor value={body} onChange={onChange} disabled={busy} label="Artifact body" />
    );
  }
  return <LegacyBody body={body} onChange={onChange} disabled={locked || busy} />;
}

function ReadOnlyBody({ body }: { body: string }) {
  return (
    <div className="min-h-24 rounded-chip border border-line bg-surface-2 p-3 text-sm text-ink">
      <Markdown>{body}</Markdown>
    </div>
  );
}

/** The pre-flag edit/preview pair, kept intact so flag-off changes nothing. */
function LegacyBody({
  body,
  onChange,
  disabled,
}: {
  body: string;
  onChange: (next: string) => void;
  disabled: boolean;
}) {
  // Open on the rendered preview (reading is the common case); the owner clicks
  // Edit to author.
  const [mode, setMode] = useState<"edit" | "preview">("preview");
  return (
    <>
      <div className="flex items-center gap-1 self-start rounded-md border border-line p-0.5 text-xs">
        {(["edit", "preview"] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMode(m)}
            aria-pressed={mode === m}
            className={cn(
              "rounded px-2 py-0.5 font-medium capitalize transition-colors",
              mode === m ? "bg-surface-2 text-ink" : "text-ink-muted hover:text-ink",
            )}
          >
            {m}
          </button>
        ))}
      </div>

      {mode === "edit" ? (
        <textarea
          value={body}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          aria-label="Artifact body"
          rows={16}
          className="w-full rounded-chip border border-line bg-surface-2 p-3 font-mono text-sm text-ink disabled:opacity-60"
        />
      ) : (
        <ReadOnlyBody body={body} />
      )}
    </>
  );
}
