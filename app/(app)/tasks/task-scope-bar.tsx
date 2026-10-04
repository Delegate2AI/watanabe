"use client";

import type { ReactNode } from "react";
import { isTeamScope, groupLabel, type Scope } from "@/lib/tasks/scope";

const SEGMENT = "rounded-md px-3 py-1.5 text-sm font-medium";
const SELECT = "rounded-md border border-line bg-surface px-2 py-1.5 text-sm text-ink";
const LAYOUT_BUTTON = "px-3 py-1.5 text-sm font-medium first:rounded-l-md last:rounded-r-md";

type Segment = { scope: Scope; label: string; count: number };

const LABELS: { scope: Scope; label: string; key: "mine" | "unassigned" | "team" }[] = [
  { scope: "mine", label: "Mine", key: "mine" },
  { scope: "unassigned", label: "Unassigned", key: "unassigned" },
  { scope: "team", label: "Team", key: "team" },
];

export function TaskScopeBar({
  scope,
  onScope,
  layout,
  onLayout,
  counts,
  myGroups,
  action,
}: {
  scope: Scope;
  onScope: (next: Scope) => void;
  layout: "list" | "board";
  onLayout: (next: "list" | "board") => void;
  /** open + in_progress within each scope. See D4. */
  counts: { mine: number; unassigned: number; team: number };
  myGroups: string[];
  /** Right-hand slot, where the page puts New task. */
  action?: ReactNode;
}) {
  // Unassigned stays hidden while it is empty, unless the viewer is standing on
  // it, which would otherwise strand them on an invisible selection.
  const segments: Segment[] = LABELS
    .map(({ scope: value, label, key }) => ({ scope: value, label, count: counts[key] }))
    .filter((segment) => segment.scope !== "unassigned" || counts.unassigned > 0 || scope === "unassigned");

  const teamScope = isTeamScope(scope);

  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex gap-1 rounded-lg bg-surface-2 p-1" role="tablist" aria-label="Task scope">
          {segments.map((segment) => {
            const selected = segment.scope === "team" ? teamScope : scope === segment.scope;
            return (
              <button
                key={segment.scope}
                type="button"
                role="tab"
                aria-selected={selected}
                onClick={() => onScope(segment.scope)}
                className={`${SEGMENT} ${selected ? "bg-surface text-ink shadow-sm" : "text-ink-muted hover:text-ink"}`}
              >
                {segment.label} {segment.count}
              </button>
            );
          })}
        </div>
        {teamScope && myGroups.length > 0 ? (
          <select
            aria-label="Group"
            value={scope.startsWith("group:") ? scope : ""}
            onChange={(event) => onScope(event.target.value ? (event.target.value as Scope) : "team")}
            className={SELECT}
          >
            <option value="">All groups</option>
            {myGroups.map((group) => (
              <option key={group} value={`group:${group}`}>
                {groupLabel(group)}
              </option>
            ))}
          </select>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex rounded-md border border-line" role="group" aria-label="Layout">
          <button
            type="button"
            aria-pressed={layout === "list"}
            onClick={() => onLayout("list")}
            className={`${LAYOUT_BUTTON} ${layout === "list" ? "bg-surface-2 text-ink" : "text-ink-muted hover:text-ink"}`}
          >
            List
          </button>
          <button
            type="button"
            aria-pressed={layout === "board"}
            onClick={() => onLayout("board")}
            className={`${LAYOUT_BUTTON} ${layout === "board" ? "bg-surface-2 text-ink" : "text-ink-muted hover:text-ink"}`}
          >
            Board
          </button>
        </div>
        {action}
      </div>
    </div>
  );
}
