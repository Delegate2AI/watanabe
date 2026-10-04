"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { KeyRound, Trash2 } from "lucide-react";
import type { LlmKey } from "@/lib/db/llm-keys";
import { messageForBody } from "@/lib/errors/messages";
import { notifyFailure, notifySuccess } from "@/lib/ui/toast";
import { formatDateTime } from "@/lib/ui/date";
import { CopyBlock } from "./copy-block";

const card = "rounded-xl bg-surface p-6 shadow-[0_0_0_1px_rgba(0,0,0,0.06)]";
const outlineButton =
  "flex items-center gap-1 rounded-md border border-line px-2 py-1 text-xs font-medium text-ink-muted hover:bg-surface-hover hover:text-ink disabled:opacity-60";

/** A label for a key generated without one: unique enough to tell keys apart in the list. */
function defaultLabel(now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `key ${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
}

function when(iso: string | null): string {
  return iso ? formatDateTime(iso) : "never";
}

/** Generate a key (shown once), list keys, revoke. */
export function KeysPanel({ keys }: { keys: LlmKey[] }) {
  const router = useRouter();
  const [label, setLabel] = useState("");
  const [pending, setPending] = useState(false);
  const [fresh, setFresh] = useState<string | null>(null);

  async function create(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    try {
      const response = await fetch("/api/settings/llm-keys", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ label: label.trim() || defaultLabel() }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) return notifyFailure(messageForBody(body));
      setFresh(body.key);
      setLabel("");
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  async function revoke(id: string) {
    if (!confirm("Revoke this key? Anything using it stops working at once.")) return;
    setPending(true);
    try {
      const response = await fetch(`/api/settings/llm-keys?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      if (!response.ok) return notifyFailure(messageForBody(await response.json().catch(() => null)));
      notifySuccess("Key revoked.");
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  const active = keys.filter((k) => k.status === "active");
  return (
    <div className={card}>
      <h2 className="flex items-center gap-2 text-sm font-semibold text-ink">
        <KeyRound className="size-4 text-accent" />
        Your keys
      </h2>
      <p className="mt-2 text-sm text-ink-muted">
        One key per machine or tool is easiest to revoke. All your keys share one budget.
      </p>

      <form onSubmit={create} className="mt-4 flex flex-wrap gap-2">
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="Label (optional), e.g. laptop or ci-runner"
          maxLength={60}
          className="h-9 min-w-0 flex-1 rounded-control border border-line bg-surface px-3 text-sm text-ink focus-visible:border-accent focus-visible:outline-none"
        />
        <button
          type="submit"
          disabled={pending}
          className="h-9 rounded-control bg-accent px-3 text-sm font-medium text-white hover:bg-accent-ink disabled:opacity-60"
        >
          Generate key
        </button>
      </form>

      {fresh ? (
        <div className="mt-4 flex flex-col gap-2 rounded-lg border border-warn bg-warn-soft p-3">
          <p className="text-sm font-medium text-warn">Copy this key now. It is shown once and cannot be recovered.</p>
          <CopyBlock value={fresh} />
          <button type="button" onClick={() => setFresh(null)} className="self-start text-xs text-ink-muted underline">
            I have saved it
          </button>
        </div>
      ) : null}

      {active.length === 0 ? (
        <p className="mt-4 text-xs text-ink-faint">No active keys yet.</p>
      ) : (
        <ul className="mt-4 flex flex-col gap-2">
          {active.map((key) => (
            <li key={key.id} className="flex flex-wrap items-center gap-3 text-sm">
              <span className="font-medium text-ink">{key.label}</span>
              <span className="rounded-chip bg-surface-2 px-2 py-0.5 text-xs text-ink-muted">…{key.keyHint}</span>
              <span className="text-xs text-ink-faint">created {when(key.createdAt)}, last used {when(key.lastUsedAt)}</span>
              <button type="button" disabled={pending} onClick={() => revoke(key.id)} className={`ml-auto ${outlineButton}`}>
                <Trash2 className="size-3.5" />
                Revoke
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
