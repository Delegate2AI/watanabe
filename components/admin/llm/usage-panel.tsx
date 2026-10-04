"use client";

import { useRouter } from "next/navigation";
import type { LlmKey } from "@/lib/db/llm-keys";
import type { DailyUsageSummary } from "@/lib/db/llm-usage";
import { formatTokens } from "@/lib/llm/format";
import { formatDateTime } from "@/lib/ui/date";
import { adminCall, card, danger } from "./api";

const th = "px-3 py-2 font-medium";
const td = "px-3 py-2";

function UsageTable({ title, rows }: { title: string; rows: DailyUsageSummary[] }) {
  return (
    <section>
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-faint">{title}</h3>
      {rows.length === 0 ? (
        <p className="text-sm text-ink-muted">No usage.</p>
      ) : (
        <div className="overflow-x-auto rounded-menu border border-line">
          <table className="w-full min-w-[36rem] text-left text-[13px]">
            <thead className="text-ink-faint">
              <tr>
                <th className={th}>Person</th>
                <th className={th}>Model</th>
                <th className={th}>Input</th>
                <th className={th}>Output</th>
                <th className={th}>Cache reads</th>
                <th className={th}>Requests</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={`${r.ownerEmail}|${r.model}`} className="border-t border-line-soft">
                  <td className={td}>{r.ownerEmail}</td>
                  <td className={`${td} font-mono text-xs`}>{r.model}</td>
                  <td className={td}>{formatTokens(r.inputTokens)}</td>
                  <td className={td}>{formatTokens(r.outputTokens)}</td>
                  <td className={`${td} text-ink-faint`}>{formatTokens(r.cacheReadTokens)}</td>
                  <td className={td}>{r.requests}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/** Usage this and last month, and every key with revoke and revoke-all for leavers. */
export function UsagePanel({ thisMonth, lastMonth, keys }: { thisMonth: DailyUsageSummary[]; lastMonth: DailyUsageSummary[]; keys: LlmKey[] }) {
  const router = useRouter();
  const active = keys.filter((k) => k.status === "active");
  const owners = [...new Set(active.map((k) => k.ownerEmail))];

  async function revoke(id: string) {
    if (!confirm("Revoke this key now?")) return;
    if (await adminCall("DELETE", `/api/admin/llm/keys?id=${encodeURIComponent(id)}`, undefined, "Key revoked.")) router.refresh();
  }
  async function revokeAll(owner: string) {
    if (!confirm(`Revoke every key of ${owner}?`)) return;
    if (await adminCall("DELETE", `/api/admin/llm/keys?owner=${encodeURIComponent(owner)}`, undefined, `All keys of ${owner} revoked.`)) router.refresh();
  }

  return (
    <div className="flex flex-col gap-5">
      <div className={`${card} flex flex-col gap-5`}>
        <h2 className="text-sm font-semibold text-ink">Usage</h2>
        <UsageTable title="This month" rows={thisMonth} />
        <UsageTable title="Last month" rows={lastMonth} />
      </div>
      <div className={card}>
        <h2 className="text-sm font-semibold text-ink">Active keys</h2>
        {active.length === 0 ? <p className="mt-2 text-sm text-ink-muted">None.</p> : null}
        <ul className="mt-3 flex flex-col gap-3 text-sm">
          {owners.map((owner) => (
            <li key={owner} className="flex flex-col gap-1">
              <div className="flex items-center gap-2">
                <span className="font-medium text-ink">{owner}</span>
                <button type="button" onClick={() => revokeAll(owner)} className={`ml-auto ${danger}`}>
                  Revoke all
                </button>
              </div>
              {active
                .filter((k) => k.ownerEmail === owner)
                .map((k) => (
                  <div key={k.id} className="flex flex-wrap items-center gap-2 pl-3 text-xs text-ink-muted">
                    <span className="text-ink">{k.label}</span>
                    <span>…{k.keyHint}</span>
                    <span>last used {k.lastUsedAt ? formatDateTime(k.lastUsedAt) : "never"}</span>
                    <button type="button" onClick={() => revoke(k.id)} className="ml-auto text-danger hover:underline">
                      Revoke
                    </button>
                  </div>
                ))}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
