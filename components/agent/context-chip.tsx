"use client";

import type { DisplayContextChip } from "@/lib/agent/context-block";

/**
 * One selection chip (spec 11) — rendered both above the composer (pending,
 * removable) and inside a sent user turn's transcript entry (fixed, no
 * remove button). See DisplayContextChip's own doc comment for why pre-send
 * and post-send/resumed chips carry slightly different information.
 */
export function ContextChip({ chip, onRemove }: { chip: DisplayContextChip; onRemove?: () => void }) {
  const location = chip.startLine === chip.endLine ? `L${chip.startLine}` : `L${chip.startLine}-${chip.endLine}`;
  const label = [chip.path, chip.headingTrail.join(" > "), location].filter(Boolean).join(" · ");

  return (
    <span
      title={chip.preview}
      className="inline-flex max-w-full items-center gap-1 rounded-full border border-[var(--color-line)] bg-[var(--color-surface-2)] px-2 py-0.5 text-[11px] text-[var(--color-ink-muted)]"
    >
      <span className="truncate">{label}</span>
      {chip.truncated && <span className="shrink-0 text-[var(--color-ink-faint)]">(truncated)</span>}
      {chip.provenance === "client" && (
        <span
          className="shrink-0 font-medium text-amber-600"
          title="Could not verify this selection against current vault content"
        >
          !
        </span>
      )}
      {onRemove && (
        // The chip is a ~20px-tall inline element in a 6px-gap wrap row, so a
        // full 40x40 target would overlap its neighbours. Negative margin buys
        // back the padding, growing the target to ~24px without shifting layout.
        <button
          type="button"
          onClick={onRemove}
          aria-label="Remove attached context"
          className="-my-1 -mr-1 flex shrink-0 items-center justify-center rounded-full p-1 leading-none text-[var(--color-ink-faint)] transition hover:bg-[var(--color-line)] hover:text-[var(--color-ink)] active:scale-[0.96]"
        >
          ×
        </button>
      )}
    </span>
  );
}
