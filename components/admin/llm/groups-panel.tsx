"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { matchReport } from "@/lib/llm/preview";
import { LLM_PERIODS, type LlmPeriod, type ModelGroup } from "@/lib/llm/types";
import { adminCall, button, card, danger, input, primary } from "./api";
import { describeBudget } from "./budget-editor";

const EMPTY: ModelGroup = { slug: "", label: "", models: [], defaultTokens: null, period: "month" };

function GroupForm({ initial, isNew, onDone }: { initial: ModelGroup; isNew: boolean; onDone: () => void }) {
  const router = useRouter();
  const [group, setGroup] = useState(initial);
  const [patterns, setPatterns] = useState(initial.models.join("\n"));
  const [limit, setLimit] = useState(initial.defaultTokens === null ? "" : String(initial.defaultTokens));
  const [pending, setPending] = useState(false);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    const models = patterns.split("\n").map((p) => p.trim()).filter(Boolean);
    const defaultTokens = limit.trim() === "" ? null : Math.max(0, Math.floor(Number(limit) || 0));
    const ok = await adminCall("PUT", "/api/admin/llm/groups", { ...group, models, defaultTokens }, "Model group saved.");
    setPending(false);
    if (ok) {
      onDone();
      router.refresh();
    }
  }

  return (
    <form onSubmit={save} className="flex flex-col gap-2 rounded-lg bg-surface-2 p-3 text-sm">
      <div className="flex flex-wrap gap-2">
        <input
          value={group.slug}
          disabled={!isNew}
          onChange={(e) => setGroup({ ...group, slug: e.target.value.toLowerCase() })}
          placeholder="slug, e.g. frontier"
          className={`${input} w-44`}
          aria-label="Slug"
        />
        <input value={group.label} onChange={(e) => setGroup({ ...group, label: e.target.value })} placeholder="Label" className={`${input} min-w-0 flex-1`} aria-label="Label" />
      </div>
      <textarea
        value={patterns}
        onChange={(e) => setPatterns(e.target.value)}
        rows={3}
        placeholder={"One model or pattern per line, e.g.\nanthropic/claude-opus-*\nollama/*"}
        className="rounded-control border border-line bg-surface px-2 py-1 font-mono text-xs text-ink"
        aria-label="Model patterns"
      />
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-ink-muted">Default</span>
        <input value={limit} onChange={(e) => setLimit(e.target.value)} inputMode="numeric" placeholder="tokens (blank = unlimited)" className={`${input} w-52`} aria-label="Default tokens" />
        <select value={group.period} onChange={(e) => setGroup({ ...group, period: e.target.value as LlmPeriod })} className={input} aria-label="Period">
          {LLM_PERIODS.map((p) => (
            <option key={p} value={p}>
              per {p}
            </option>
          ))}
        </select>
        <button type="submit" disabled={pending || !group.slug || !group.label.trim()} className={primary}>
          Save
        </button>
        <button type="button" onClick={onDone} className={button}>
          Cancel
        </button>
      </div>
    </form>
  );
}

/** Model groups, and which known models each one catches. A model in no group is blocked for everyone. */
export function GroupsPanel({ groups, seenModels }: { groups: ModelGroup[]; seenModels: string[] }) {
  const router = useRouter();
  const [editing, setEditing] = useState<string | null>(null);
  const report = useMemo(() => matchReport(groups, seenModels), [groups, seenModels]);

  async function remove(slug: string) {
    if (!confirm(`Delete the ${slug} group and every budget set for it?`)) return;
    if (await adminCall("DELETE", `/api/admin/llm/groups?slug=${encodeURIComponent(slug)}`, undefined, "Model group deleted.")) router.refresh();
  }

  return (
    <div className="flex flex-col gap-5">
      <div className={card}>
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold text-ink">Model groups</h2>
          <button type="button" onClick={() => setEditing("__new")} className={`ml-auto ${button}`}>
            New group
          </button>
        </div>
        <p className="mt-1 text-xs text-ink-faint">Patterns match 9router model ids; * is the only wildcard. A model in two groups goes to the first by slug.</p>
        {editing === "__new" ? <div className="mt-3"><GroupForm initial={EMPTY} isNew onDone={() => setEditing(null)} /></div> : null}
        <ul className="mt-4 flex flex-col gap-3">
          {groups.map((g) => (
            <li key={g.slug} className="flex flex-col gap-2 border-t border-line-soft pt-3 first:border-t-0 first:pt-0">
              <div className="flex flex-wrap items-baseline gap-2 text-sm">
                <span className="font-medium text-ink">{g.label}</span>
                <span className="text-xs text-ink-faint">{g.slug}</span>
                <span className="text-xs text-ink-muted">default {describeBudget({ tokens: g.defaultTokens, period: g.period, allowed: true })}</span>
                <span className="ml-auto flex gap-2">
                  <button type="button" onClick={() => setEditing(g.slug)} className={button}>Edit</button>
                  <button type="button" onClick={() => remove(g.slug)} className={danger}>Delete</button>
                </span>
              </div>
              <code className="text-xs text-ink-muted">{g.models.join("  ") || "no patterns"}</code>
              {editing === g.slug ? <GroupForm initial={g} isNew={false} onDone={() => setEditing(null)} /> : null}
            </li>
          ))}
        </ul>
      </div>

      <div className={card}>
        <h2 className="text-sm font-semibold text-ink">Models seen in the last two months</h2>
        {report.length === 0 ? (
          <p className="mt-2 text-sm text-ink-muted">No traffic yet.</p>
        ) : (
          <ul className="mt-3 flex flex-col gap-1 text-sm">
            {report.map((m) => (
              <li key={m.model} className="flex flex-wrap gap-2">
                <code className="text-ink">{m.model}</code>
                {m.slugs.length === 0 ? <span className="text-xs text-danger">in no group: blocked</span> : null}
                {m.slugs.length > 1 ? <span className="text-xs text-warn">in {m.slugs.join(", ")}: {m.slugs[0]} wins</span> : null}
                {m.slugs.length === 1 ? <span className="text-xs text-ink-faint">{m.slugs[0]}</span> : null}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
