"use client";

import { useEffect, useState } from "react";
import { formatRelative } from "@/lib/ui/date";
import { messageForBody } from "@/lib/errors/messages";
import { notifyFailure } from "@/lib/ui/toast";
import { buttonClass } from "./access-ui";

interface ConnectorRequestRow {
  id: string;
  requesterEmail: string;
  text: string;
  createdAt: string;
}

export function ConnectorRequestsSection() {
  const [requests, setRequests] = useState<ConnectorRequestRow[]>([]);
  const [openCount, setOpenCount] = useState(0);
  const [resolvingId, setResolvingId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/admin/connectors/requests")
      .then((response) => (response.ok ? response.json() : null))
      .then((body: { requests?: ConnectorRequestRow[]; openCount?: number } | null) => {
        if (cancelled || !body) return;
        const rows = Array.isArray(body.requests) ? body.requests : [];
        setRequests(rows);
        setOpenCount(typeof body.openCount === "number" ? body.openCount : rows.length);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  async function resolve(id: string): Promise<void> {
    setResolvingId(id);
    try {
      const response = await fetch("/api/admin/connectors/requests", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id }),
      });
      if (!response.ok) {
        notifyFailure(messageForBody(await response.json().catch(() => null)));
        return;
      }
      setRequests((current) => current.filter((row) => row.id !== id));
      setOpenCount((current) => Math.max(0, current - 1));
    } catch {
      notifyFailure("The request could not be resolved.");
    } finally {
      setResolvingId(null);
    }
  }

  if (requests.length === 0) return null;

  return (
    <section className="space-y-3 rounded-xl bg-surface p-4 shadow-[0_0_0_1px_rgba(0,0,0,0.06)]">
      <h2 className="flex items-center gap-2 text-sm font-semibold text-ink">
        Connector requests
        <span className="rounded-full bg-accent/15 px-2 py-0.5 text-xs font-medium text-accent">{openCount}</span>
      </h2>
      <ul className="space-y-2">
        {requests.map((row) => (
          <li key={row.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-surface-2 px-3 py-2">
            <div className="text-sm text-ink">
              <span className="font-medium">{row.requesterEmail}</span>
              <span className="text-ink-faint"> · {formatRelative(row.createdAt)}</span>
              <p className="text-ink-muted text-pretty">{row.text}</p>
            </div>
            <button
              type="button"
              disabled={resolvingId === row.id}
              onClick={() => void resolve(row.id)}
              className={`${buttonClass} bg-surface text-ink`}
            >
              Resolve
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
