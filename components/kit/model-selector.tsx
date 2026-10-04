"use client";

import { useState } from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { EFFORT_LEVELS, type EffortLevel, type ModelOption } from "@/lib/agent/model-options";

function titleCase(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * The composer's per-thread model + reasoning-level switch (spec 24).
 *
 * DORMANT by default: the server resolves the allowlist and whether switching
 * is enabled (`AGENT_CHAT_MODELS`) and passes them down. When disabled, or when
 * there is no thread yet, this renders an inert label ("Opus 4.8 · High") with
 * no menu and no writes, matching the pre-spec-24 shape. Server env is never
 * read here: the allowlist arrives as a prop, so the browser can never silently
 * mis-resolve the feature.
 *
 * When enabled, choosing writes the override onto the thread via
 * `PATCH /api/threads/[id]`. The write is bounded: only allow-listed entries are
 * offered, and the route re-validates.
 */
export function ModelSelector({
  threadId,
  model,
  level,
  options = [],
  enabled = false,
  onChange,
}: {
  threadId?: string;
  /** Initial display label for the model, e.g. "Opus 4.8". */
  model: string;
  /** Initial display label for the effort, e.g. "High". */
  level: string;
  /** Server-resolved allow-listed models. Empty when switching is disabled. */
  options?: ModelOption[];
  /** Whether model switching is enabled server-side (AGENT_CHAT_MODELS set). */
  enabled?: boolean;
  onChange?: (choice: { model?: string; effort?: EffortLevel }) => void;
}) {
  const [open, setOpen] = useState(false);
  const [modelLabel, setModelLabel] = useState(model);
  const [effortLabel, setEffortLabel] = useState(level);
  const [lastProps, setLastProps] = useState({ model, level });
  if (lastProps.model !== model || lastProps.level !== level) {
    setLastProps({ model, level });
    if (lastProps.model !== model) setModelLabel(model);
    if (lastProps.level !== level) setEffortLabel(level);
  }

  const interactive = enabled && options.length > 0 && (Boolean(threadId) || Boolean(onChange));

  async function persist(body: { model?: string; effort?: EffortLevel }) {
    if (!threadId) return;
    try {
      await fetch(`/api/threads/${threadId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    } catch {
      /* best-effort: the display already reflects the choice */
    }
  }

  function chooseModel(id: string, label: string) {
    setModelLabel(label);
    setOpen(false);
    onChange?.({ model: id });
    void persist({ model: id });
  }
  function chooseEffort(effort: EffortLevel) {
    setEffortLabel(titleCase(effort));
    setOpen(false);
    onChange?.({ effort });
    void persist({ effort });
  }

  const label = (
    <>
      <b className="font-semibold text-ink">{modelLabel}</b>{" "}
      <span aria-hidden>·</span>{" "}
      <span className="font-semibold text-accent-ink">{effortLabel}</span>
    </>
  );

  if (!interactive) {
    const why = !enabled
      ? "Model switching is not enabled for this workspace."
      : "No models are available to switch to.";
    return (
      <span className="text-xs text-ink-muted" title={why}>
        {label}
      </span>
    );
  }

  return (
    <div className="relative">
      <button
        type="button"
        aria-label="Model and reasoning level"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="text-xs text-ink-muted hover:text-ink"
      >
        {label}
      </button>
      {open && (
        <div
          role="menu"
          className="absolute bottom-full right-0 z-20 mb-2 w-64 rounded-menu border border-line bg-surface p-1.5 shadow-elevated"
        >
          <div className="px-2 py-1 text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
            Model
          </div>
          {options.map((m) => (
            <MenuRow
              key={m.id}
              label={m.label}
              hint={m.hint}
              tier={m.tier}
              active={m.label === modelLabel}
              onClick={() => chooseModel(m.id, m.label)}
            />
          ))}
          <div className="mt-1 px-2 py-1 text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
            Reasoning
          </div>
          {EFFORT_LEVELS.map((e) => (
            <MenuRow
              key={e}
              label={titleCase(e)}
              active={titleCase(e) === effortLabel}
              onClick={() => chooseEffort(e)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function MenuRow({
  label,
  hint,
  tier,
  active,
  onClick,
}: {
  label: string;
  hint?: string;
  tier?: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={active}
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2 rounded-control px-2 py-1.5 text-left text-[13px] text-ink hover:bg-surface-2",
      )}
    >
      <Check className={cn("size-3.5 shrink-0", active ? "text-accent" : "invisible")} aria-hidden />
      <span className="min-w-0 flex-1 truncate">
        {label}
        {hint ? <span className="ml-1.5 text-[11px] text-ink-faint">{hint}</span> : null}
      </span>
      {tier !== undefined ? <TierDots tier={tier} /> : null}
    </button>
  );
}

function TierDots({ tier }: { tier: number }) {
  return (
    <span className="flex shrink-0 gap-0.5" aria-label={`Cost tier ${tier} of 3`}>
      {[0, 1, 2, 3].map((step) => (
        <span
          key={step}
          className={cn("size-1 rounded-full", step <= tier ? "bg-ink-muted" : "bg-line")}
          aria-hidden
        />
      ))}
    </span>
  );
}
