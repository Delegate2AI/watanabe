"use client";

/**
 * The floating Comment/Suggest action shown above an active text selection
 * (spec 2026-07-22). Positioned by the caller via absolute viewport coords.
 */
export function SelectionBubble({
  x, y, onComment, onSuggest, onAskCopilot = null,
}: {
  x: number;
  y: number;
  onComment: () => void;
  onSuggest: (() => void) | null;
  /** Spec 2026-08-27: hands the selection to the copilot tab. Null (the default) renders nothing. */
  onAskCopilot?: (() => void) | null;
}) {
  return (
    <div
      className="fixed z-50 flex -translate-x-1/2 -translate-y-full gap-1 rounded-chip border border-line bg-surface px-1 py-1 shadow-md"
      style={{ left: x, top: y }}
      role="menu"
    >
      <button type="button" onClick={onComment} className="rounded px-2 py-1 text-xs text-ink hover:bg-surface-2">
        Comment
      </button>
      {onSuggest && (
        <button type="button" onClick={onSuggest} className="rounded px-2 py-1 text-xs text-ink hover:bg-surface-2">
          Suggest
        </button>
      )}
      {onAskCopilot && (
        <button type="button" onClick={onAskCopilot} className="rounded px-2 py-1 text-xs text-ink hover:bg-surface-2">
          Ask copilot
        </button>
      )}
    </div>
  );
}
