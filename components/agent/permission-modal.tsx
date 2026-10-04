"use client";

import { KeyRound, AlertTriangle, Info } from "lucide-react";
import type { PermissionDecision } from "@/lib/agent/events";
import type { AdvisoryFinding } from "@/lib/quality/agents";

export interface PendingPermission {
  requestId: string;
  toolName: string;
  input: unknown;
  advisoryFindings?: AdvisoryFinding[];
}

/** `mcp__kb__search` → "kb search". */
function pretty(toolName: string): string {
  return toolName.replace(/^mcp__[^_]+__/, "").replace(/_/g, " ");
}

/** `citation-checker` → "citation checker". */
function prettyAgent(agent: AdvisoryFinding["agent"]): string {
  return agent.replace(/-/g, " ");
}

function inputPreview(input: unknown): string {
  try {
    return JSON.stringify(input, null, 2);
  } catch {
    return String(input);
  }
}

/** For a Bash confirm, the raw command string — un-JSON-escaped so shell quoting stays legible. */
function bashCommandPreview(input: unknown): string | undefined {
  if (typeof input !== "object" || input === null) return undefined;
  const command = (input as Record<string, unknown>).command;
  return typeof command === "string" ? command : undefined;
}

/**
 * Confirmation gate for a pending tool call — today, `kb_submit` (see
 * lib/agent/permissions.ts) and most non-allowlisted Bash calls (see
 * lib/agent/bash-policy.ts) route here via the PreToolUse gate's `"confirm"`
 * verdict, surfaced to the SDK as `"ask"`.
 */
export function PermissionModal({
  pending,
  onDecide,
}: {
  pending: PendingPermission;
  onDecide: (decision: PermissionDecision) => void;
}) {
  const bashCommand = pending.toolName === "Bash" ? bashCommandPreview(pending.input) : undefined;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center">
      {/* `message-in` (app/globals.css) — a 4px rise + fade, once on mount.
          Softer than a scale-in, and it no-ops under prefers-reduced-motion. */}
      <div className="message-in w-full max-w-lg overflow-hidden rounded-2xl border border-[var(--color-line)] bg-[var(--color-surface)] shadow-xl">
        <div className="flex items-start gap-3 border-b border-[var(--color-line)] px-5 py-4">
          <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-amber-500/15 text-amber-500">
            <KeyRound className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <div className="text-sm font-semibold text-[var(--color-ink-strong)]">Confirm tool call</div>
            <div className="mt-0.5 text-xs text-[var(--color-ink-muted)]">
              The assistant wants to run {pretty(pending.toolName)}.
            </div>
          </div>
        </div>

        <pre className="max-h-56 overflow-auto whitespace-pre-wrap break-words bg-[var(--color-surface-2)]/40 px-5 py-3 font-mono text-[11px] text-[var(--color-ink)]">
          {bashCommand ?? inputPreview(pending.input)}
        </pre>

        {pending.advisoryFindings && pending.advisoryFindings.length > 0 && (
          <div className="border-t border-[var(--color-line)] px-5 py-3">
            <div className="mb-2 text-[10px] uppercase tracking-widest text-[var(--color-ink-faint)]">
              Quality checks
            </div>
            <ul className="space-y-1.5">
              {pending.advisoryFindings.map((finding, i) => (
                <li
                  key={i}
                  className={
                    finding.severity === "warn"
                      ? "flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/5 px-3 py-2 text-xs text-red-500"
                      : "flex items-start gap-2 rounded-lg border border-[var(--color-line)] px-3 py-2 text-xs text-[var(--color-ink-muted)]"
                  }
                >
                  {finding.severity === "warn" ? (
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  ) : (
                    <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  )}
                  <span>
                    <span className="font-medium">{prettyAgent(finding.agent)}:</span> {finding.message}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-[var(--color-line)] px-5 py-3">
          <button
            type="button"
            onClick={() => onDecide("deny")}
            className="rounded-lg px-3 py-2 text-sm text-[var(--color-ink-muted)] transition hover:bg-[var(--color-surface-2)] hover:text-[var(--color-ink)] active:scale-[0.96]"
          >
            Deny
          </button>
          <button
            type="button"
            onClick={() => onDecide("allow_always")}
            className="rounded-lg border border-[var(--color-line)] px-3 py-2 text-sm text-[var(--color-ink)] transition hover:bg-[var(--color-surface-2)] active:scale-[0.96]"
          >
            Allow all this chat
          </button>
          <button
            type="button"
            onClick={() => onDecide("allow")}
            className="rounded-lg bg-[var(--color-accent)] px-4 py-2 text-sm font-medium text-[var(--color-accent-fg)] transition hover:opacity-90 active:scale-[0.96]"
          >
            Allow
          </button>
        </div>
      </div>
    </div>
  );
}
