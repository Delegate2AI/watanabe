"use client";

import { useState } from "react";
import { ChevronRight, Loader2, Check, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ToolSegment } from "@/lib/agent/conversation";

function preview(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

/** Strip an `mcp__<server>__` prefix so in-process tools read as plain names. */
function displayName(name: string): string {
  return name.replace(/^mcp__[^_]+__/, "");
}

/** One-line summary of a tool call (the most useful field, by tool). */
function summary(input: unknown): string {
  const i = (input ?? {}) as Record<string, unknown>;
  if (typeof i.pattern === "string") return i.pattern;
  if (typeof i.file_path === "string") return i.file_path;
  if (typeof i.path === "string") return i.path;
  if (typeof i.query === "string") return i.query;
  const keys = Object.keys(i);
  return keys.length ? keys.join(", ") : "";
}

export function ToolPill({ tool }: { tool: ToolSegment }) {
  const [open, setOpen] = useState(false);
  const dot =
    tool.status === "running"
      ? "text-amber-500"
      : tool.status === "error"
        ? "text-red-500"
        : "text-emerald-500";

  return (
    <div className="my-1.5 overflow-hidden rounded-lg border border-[var(--color-line)] bg-[var(--color-surface-2)]/40 text-xs">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        // No scale-on-press: this is a full-width row, and scaling the whole
        // strip reads as a glitch rather than as tactile feedback.
        className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-[var(--color-surface-2)]/70"
      >
        <ChevronRight className={cn("h-3.5 w-3.5 shrink-0 transition-transform", open && "rotate-90")} />
        <span className={cn("shrink-0", dot)}>
          {tool.status === "running" ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : tool.status === "error" ? (
            <X className="h-3.5 w-3.5" />
          ) : (
            <Check className="h-3.5 w-3.5" />
          )}
        </span>
        <span className="font-mono font-medium text-[var(--color-ink-strong)]">{displayName(tool.name)}</span>
        <span className="truncate font-mono text-[var(--color-ink-muted)]">{summary(tool.input)}</span>
      </button>
      {open && (
        <div className="message-in space-y-2 border-t border-[var(--color-line)] px-3 py-2">
          <div>
            <div className="mb-1 text-[10px] uppercase tracking-widest text-[var(--color-ink-faint)]">input</div>
            <pre className="overflow-x-auto whitespace-pre-wrap break-words font-mono text-[11px] text-[var(--color-ink)]">
              {preview(tool.input)}
            </pre>
          </div>
          {tool.result != null && (
            <div>
              <div className="mb-1 text-[10px] uppercase tracking-widest text-[var(--color-ink-faint)]">output</div>
              <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] text-[var(--color-ink-muted)]">
                {preview(tool.result)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
