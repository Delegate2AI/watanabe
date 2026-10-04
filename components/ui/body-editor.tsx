"use client";

import { Suspense, lazy, useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { richEditorBlocker, RICH_BLOCKER_LABELS } from "@/lib/markdown/rich-fidelity";

// TipTap and its ProseMirror tree are the heaviest client code in the app and
// only the rich half needs them, so they load on demand rather than riding
// along in the chunk of every screen that can edit a body.
const RichEditor = lazy(async () => ({
  default: (await import("./rich-editor")).RichEditor,
}));

type Mode = "rich" | "markdown";

/**
 * A document body, editable two ways: `rich` is a WYSIWYG surface, `markdown`
 * is the raw source. Both read and write the same markdown string, so the mode
 * is a view preference and never changes what gets saved.
 *
 * Rich mode is offered only for a body the editor can represent losslessly.
 * `richEditorBlocker` decides that from the source (tables, images, checklists,
 * raw HTML, frontmatter and footnotes do not survive the round trip), and a
 * blocked body opens in markdown mode with the rich option disabled and the
 * reason shown. Silently mangling someone's table would be far worse than
 * asking them to edit its source.
 */
export function BodyEditor({
  value,
  onChange,
  disabled = false,
  label,
}: {
  value: string;
  onChange: (next: string) => void;
  disabled?: boolean;
  label: string;
}) {
  // Re-measured on every change, not captured at mount. The author can switch
  // to markdown, paste a table, and switch back, and a verdict frozen at open
  // would have waved that through and let the next rich keystroke eat it.
  // Rich mode cannot itself produce a blocked construct (nothing in the schema
  // holds one), so this only ever closes the door while markdown mode is open.
  const blocker = useMemo(() => richEditorBlocker(value), [value]);
  const [mode, setMode] = useState<Mode>(() => (richEditorBlocker(value) ? "markdown" : "rich"));
  const reason = blocker ? RICH_BLOCKER_LABELS[blocker] : null;
  // A blocked body is shown as source no matter which mode was chosen, so the
  // rich surface can never be the one holding a construct it would destroy.
  const shown: Mode = blocker ? "markdown" : mode;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1 self-start rounded-md border border-line p-0.5 text-xs">
          {(["rich", "markdown"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              disabled={m === "rich" && blocker !== null}
              aria-pressed={shown === m}
              className={cn(
                "rounded px-2 py-0.5 font-medium capitalize transition-colors",
                shown === m ? "bg-surface-2 text-ink" : "text-ink-muted hover:text-ink",
                "disabled:cursor-not-allowed disabled:text-ink-faint disabled:hover:text-ink-faint",
              )}
            >
              {m}
            </button>
          ))}
        </div>
        {reason ? (
          <p className="text-xs text-ink-muted">
            This document contains {reason}, which the rich editor cannot edit without losing it.
          </p>
        ) : null}
      </div>

      {shown === "rich" ? (
        <Suspense
          fallback={
            <div className="min-h-40 rounded-chip border border-line bg-surface-2 p-3 text-sm text-ink-muted">
              Loading the editor...
            </div>
          }
        >
          <RichEditor value={value} onChange={onChange} disabled={disabled} label={label} />
        </Suspense>
      ) : (
        <textarea
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          aria-label={label}
          rows={16}
          className="w-full rounded-chip border border-line bg-surface-2 p-3 font-mono text-sm text-ink disabled:opacity-60"
        />
      )}
    </div>
  );
}
