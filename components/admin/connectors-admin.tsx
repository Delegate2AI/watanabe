"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { messageForBody } from "@/lib/errors/messages";
import { notifyFailure, notifySuccess } from "@/lib/ui/toast";
import { buttonClass } from "./access-ui";
import { ConnectorRequestsSection } from "./connector-requests-section";
import { ConnectorsForm, type ConnectorEntryInput, type ConnectorRow } from "./connectors-form";

/**
 * The `/admin/connectors` surface (spec 33).
 *
 * The list arrives already resolved from the server page, so nothing here
 * fetches it: mutations POST to `/api/admin/connectors` and then
 * `router.refresh()` re-runs the force-dynamic page, exactly like
 * `access-admin.tsx`. The connection test is the one read this component makes
 * on its own, because it is an action rather than page state.
 */

/** The loader reports a whole-file parse failure under this slug, not a connector. */
const FILE_ERROR_SLUG = "*";

type TestState = { ok: boolean; text: string };

function chip(tone: "ok" | "warn" | "muted"): string {
  const colors = {
    ok: "bg-emerald-500/15 text-emerald-700",
    warn: "bg-amber-500/20 text-amber-700",
    muted: "bg-surface-2 text-ink-muted",
  };
  return `rounded-full px-2.5 py-1 text-xs font-medium ${colors[tone]}`;
}

function ConnectorCard({
  row,
  test,
  pending,
  onEdit,
  onDelete,
  onTest,
}: {
  row: ConnectorRow;
  test: TestState | undefined;
  pending: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onTest: () => void;
}) {
  const healthy = row.status === "ok";
  return (
    <article className="grid gap-3 rounded-xl bg-surface p-4 shadow-[0_0_0_1px_rgba(0,0,0,0.06),0_1px_2px_-1px_rgba(0,0,0,0.06)]">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="font-semibold text-ink">{row.title ?? row.slug}</h3>
        <code className="text-xs text-ink-faint">{row.slug}</code>
        <span className={chip(healthy ? "ok" : "warn")}>{healthy ? "healthy" : "disabled"}</span>
        {row.transport && <span className={chip("muted")}>{row.transport}</span>}
      </div>

      {healthy ? (
        <p className="text-xs text-ink-muted text-pretty">
          {row.url ?? row.command}
          {row.groups && row.groups.length > 0 ? `, offered to ${row.groups.join(", ")}` : ", offered to nobody"}
          {`, ${row.tools ? `${row.tools.length} allowed tool(s)` : "every tool"}`}
        </p>
      ) : (
        <p className="text-sm text-amber-700 text-pretty">{row.reason}</p>
      )}

      {row.envVars.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {row.envVars.map((variable) => (
            <span key={variable.name} className={chip(variable.present ? "ok" : "warn")}>
              {variable.name}: {variable.present ? "set" : "not set"}
            </span>
          ))}
        </div>
      )}

      {test && (
        <p role="status" className={`text-sm text-pretty ${test.ok ? "text-emerald-700" : "text-amber-700"}`}>
          {test.text}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        {healthy && (
          <>
            <button type="button" disabled={pending} onClick={onEdit} className={`${buttonClass} bg-surface-2 text-ink`}>
              Edit
            </button>
            <button type="button" disabled={pending} onClick={onTest} className={`${buttonClass} bg-surface-2 text-ink`}>
              Test connection
            </button>
          </>
        )}
        <button type="button" disabled={pending} onClick={onDelete} className={`${buttonClass} bg-surface-2 text-red-600`}>
          Delete {row.slug}
        </button>
      </div>
    </article>
  );
}

export function ConnectorsAdmin({
  entries,
  groupNames,
}: {
  entries: ConnectorRow[];
  /** Clearance group keys, read from access/groups.yaml on the server. */
  groupNames: string[];
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [editing, setEditing] = useState<ConnectorRow | null>(null);
  const [adding, setAdding] = useState(false);
  const [tests, setTests] = useState<Record<string, TestState>>({});

  const fileErrors = entries.filter((row) => row.slug === FILE_ERROR_SLUG);
  const connectors = entries.filter((row) => row.slug !== FILE_ERROR_SLUG);

  async function mutate(body: unknown, success: string): Promise<boolean> {
    setPending(true);
    setMessage("");
    try {
      const response = await fetch("/api/admin/connectors", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        const failure = messageForBody(await response.json().catch(() => null));
        setMessage(failure);
        notifyFailure(failure);
        return false;
      }
      setMessage(success);
      notifySuccess(success);
      // The commit lands in the same dir the page reads, so the refreshed
      // server render shows the new registry without a manual reload.
      router.refresh();
      return true;
    } catch {
      const failure = "The connector change could not be submitted.";
      setMessage(failure);
      notifyFailure(failure);
      return false;
    } finally {
      setPending(false);
    }
  }

  async function upsert(slug: string, entry: ConnectorEntryInput): Promise<boolean> {
    const ok = await mutate({ verb: "upsert", slug, entry }, `Connector ${slug} saved.`);
    if (ok) {
      setEditing(null);
      setAdding(false);
    }
    return ok;
  }

  async function remove(slug: string): Promise<void> {
    if (!window.confirm(`Delete the ${slug} connector? Threads that enabled it lose it immediately.`)) return;
    await mutate({ verb: "remove", slug }, `Connector ${slug} deleted.`);
  }

  /**
   * The probe reply carries a raw server string on failure. It is admin
   * authored (an admin typed the URL) and this surface is admin gated, so it is
   * shown here and nowhere else in the app.
   */
  async function runTest(slug: string): Promise<void> {
    setPending(true);
    try {
      const response = await fetch("/api/admin/connectors/test", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ slug }),
      });
      const body = await response.json().catch(() => null);
      const result: TestState = !response.ok
        ? { ok: false, text: messageForBody(body) }
        : (body as { ok?: boolean; toolCount?: number; error?: string })?.ok
          ? { ok: true, text: `Connected, ${(body as { toolCount: number }).toolCount} tool(s) offered.` }
          : { ok: false, text: (body as { error?: string })?.error ?? "The connection failed." };
      setTests((current) => ({ ...current, [slug]: result }));
    } catch {
      setTests((current) => ({ ...current, [slug]: { ok: false, text: "The test could not be run." } }));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-4">
      <ConnectorRequestsSection />
      {fileErrors.map((row) => (
        <p key={row.reason} role="alert" className="rounded-xl bg-amber-500/15 px-4 py-3 text-sm text-amber-700 text-pretty">
          access/connectors.yaml could not be read, so every connector is off: {row.reason}
        </p>
      ))}
      {message && <p role="status" className="rounded-lg bg-surface-2 px-4 py-3 text-sm text-ink">{message}</p>}

      {editing === null && !adding && (
        <button type="button" onClick={() => setAdding(true)} className={`${buttonClass} bg-accent text-white`}>
          Add a connector
        </button>
      )}
      {(adding || editing !== null) && (
        <ConnectorsForm
          key={editing?.slug ?? "new"}
          row={editing}
          groupNames={groupNames}
          pending={pending}
          onSubmit={upsert}
          onCancel={() => {
            setEditing(null);
            setAdding(false);
          }}
        />
      )}

      {connectors.length === 0 && fileErrors.length === 0 && (
        <p className="rounded-xl bg-surface p-6 text-sm text-ink-muted shadow-[0_0_0_1px_rgba(0,0,0,0.06)]">
          No connectors are registered yet.
        </p>
      )}
      {connectors.map((row) => (
        <ConnectorCard
          key={row.slug}
          row={row}
          test={tests[row.slug]}
          pending={pending}
          onEdit={() => {
            setAdding(false);
            setEditing(row);
          }}
          onDelete={() => void remove(row.slug)}
          onTest={() => void runTest(row.slug)}
        />
      ))}
    </div>
  );
}
