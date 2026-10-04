"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { BudgetRow, LlmPeriod, ModelGroup } from "@/lib/llm/types";
import { adminCall, button, card, input } from "./api";
import { BudgetEditor, describeBudget } from "./budget-editor";

type Key = { subjectKind: "user" | "team"; subject: string; groupSlug: string };

function useBudgetActions() {
  const router = useRouter();
  return {
    async save(key: Key, value: { tokens: number | null; period: LlmPeriod; allowed: boolean }) {
      if (await adminCall("PUT", "/api/admin/llm/budgets", { ...key, ...value }, "Budget saved.")) router.refresh();
    },
    async clear(key: Key) {
      if (await adminCall("DELETE", "/api/admin/llm/budgets", key, "Budget cleared.")) router.refresh();
    },
  };
}

/**
 * Team defaults as a grid of teams by model groups, then per-person overrides.
 * Resolution: a person's own row, else their most generous team, else the
 * group's default (shown in the column header).
 */
export function BudgetsPanel({ teams, groups, budgets }: { teams: string[]; groups: ModelGroup[]; budgets: BudgetRow[] }) {
  const actions = useBudgetActions();
  const [editing, setEditing] = useState<string | null>(null);
  const [person, setPerson] = useState({ email: "", groupSlug: groups[0]?.slug ?? "" });
  const find = (k: Key) =>
    budgets.find((b) => b.subjectKind === k.subjectKind && b.subject === k.subject && b.groupSlug === k.groupSlug);
  const users = budgets.filter((b) => b.subjectKind === "user");

  if (groups.length === 0) {
    return (
      <div className={card}>
        <p className="text-sm text-ink-muted">Create a model group first; budgets are set per group.</p>
      </div>
    );
  }

  function editor(key: Key, id: string) {
    const row = find(key);
    return (
      <BudgetEditor
        row={row}
        onSave={async (v) => {
          await actions.save(key, v);
          setEditing(null);
        }}
        onClear={row ? async () => { await actions.clear(key); setEditing(null); } : null}
        onCancel={() => setEditing(null)}
        key={id}
      />
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <div className={card}>
        <h2 className="text-sm font-semibold text-ink">Team budgets</h2>
        <p className="mt-1 text-xs text-ink-faint">Teams come from groups.yaml. all-hands is everyone.</p>
        <div className="mt-4 overflow-x-auto rounded-menu border border-line">
          <table className="w-full min-w-[42rem] text-left text-[13px]">
            <thead className="text-ink-faint">
              <tr>
                <th className="px-3 py-2 font-medium">Team</th>
                {groups.map((g) => (
                  <th key={g.slug} className="px-3 py-2 font-medium">
                    {g.label}
                    <div className="font-normal">default {describeBudget({ tokens: g.defaultTokens, period: g.period, allowed: true })}</div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {teams.map((team) => (
                <tr key={team} className="border-t border-line-soft align-top">
                  <td className="px-3 py-2 text-ink">{team}</td>
                  {groups.map((g) => {
                    const key: Key = { subjectKind: "team", subject: team, groupSlug: g.slug };
                    const id = `team|${team}|${g.slug}`;
                    return (
                      <td key={g.slug} className="px-3 py-2">
                        {editing === id ? (
                          editor(key, id)
                        ) : (
                          <button type="button" onClick={() => setEditing(id)} className="text-ink-muted hover:text-accent hover:underline">
                            {describeBudget(find(key))}
                          </button>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className={card}>
        <h2 className="text-sm font-semibold text-ink">Per-person overrides</h2>
        <ul className="mt-3 flex flex-col gap-2 text-sm">
          {users.length === 0 ? <li className="text-ink-faint">None.</li> : null}
          {users.map((b) => {
            const id = `user|${b.subject}|${b.groupSlug}`;
            const label = groups.find((g) => g.slug === b.groupSlug)?.label ?? b.groupSlug;
            return (
              <li key={id} className="flex flex-col gap-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-ink">{b.subject}</span>
                  <span className="text-ink-muted">{label}</span>
                  <button type="button" onClick={() => setEditing(id)} className="text-ink-muted hover:text-accent hover:underline">
                    {describeBudget(b)}
                  </button>
                </div>
                {editing === id ? editor({ subjectKind: "user", subject: b.subject, groupSlug: b.groupSlug }, id) : null}
              </li>
            );
          })}
        </ul>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <input
            value={person.email}
            onChange={(e) => setPerson({ ...person, email: e.target.value })}
            placeholder="person@company.com"
            className={`${input} min-w-0 flex-1`}
          />
          <select value={person.groupSlug} onChange={(e) => setPerson({ ...person, groupSlug: e.target.value })} className={input} aria-label="Model group">
            {groups.map((g) => (
              <option key={g.slug} value={g.slug}>
                {g.label}
              </option>
            ))}
          </select>
          <button type="button" className={button} disabled={!person.email.includes("@")} onClick={() => setEditing("new-person")}>
            Add override
          </button>
        </div>
        {editing === "new-person"
          ? editor({ subjectKind: "user", subject: person.email.trim(), groupSlug: person.groupSlug }, "new-person")
          : null}
      </div>
    </div>
  );
}
