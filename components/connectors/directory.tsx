"use client";

import { useEffect, useState } from "react";
import { messageForBody } from "@/lib/errors/messages";
import { ConnectorCard, type ConnectorOption } from "./connector-card";
import { ConnectorOauthBanner } from "./oauth-banner";

function RequestForm() {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send(): Promise<void> {
    const trimmed = text.trim();
    if (!trimmed) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/connectors/requests", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: trimmed }),
      });
      if (!response.ok) {
        setError(messageForBody(await response.json().catch(() => null)));
        return;
      }
      setSent(true);
      setText("");
    } catch {
      setError("The request could not be sent.");
    } finally {
      setBusy(false);
    }
  }

  if (sent) {
    return (
      <p className="rounded-card border border-line bg-surface-2 px-4 py-3 text-sm text-ink">
        Thanks, we passed your request along.
        <button
          type="button"
          onClick={() => setSent(false)}
          className="ml-2 font-medium text-accent underline"
        >
          Ask for another
        </button>
      </p>
    );
  }

  return (
    <div className="rounded-card border border-line bg-surface p-4">
      <label className="block text-xs font-medium text-ink-muted" htmlFor="connector-request">
        Ask for a connector we do not have yet
      </label>
      <textarea
        id="connector-request"
        value={text}
        rows={3}
        maxLength={2000}
        disabled={busy}
        onChange={(e) => setText(e.target.value)}
        placeholder="What service, and what would you use it for?"
        className="mt-1 w-full rounded-md border border-line bg-surface px-2 py-1 text-sm text-ink disabled:opacity-60"
      />
      <button
        type="button"
        onClick={() => void send()}
        disabled={busy || text.trim().length === 0}
        className="mt-2 rounded-md bg-accent px-4 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-60"
      >
        {busy ? "Sending..." : "Request a connector"}
      </button>
      {error && (
        <p role="alert" className="mt-2 text-xs text-warn">
          {error}
        </p>
      )}
    </div>
  );
}

export function ConnectorDirectory() {
  const [connectors, setConnectors] = useState<ConnectorOption[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch("/api/connectors");
        if (!response.ok) return;
        const body = (await response.json()) as { connectors?: ConnectorOption[] };
        if (!cancelled && Array.isArray(body.connectors)) setConnectors(body.connectors);
      } catch {
        if (!cancelled) setConnectors([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function refetch(): Promise<void> {
    try {
      const response = await fetch("/api/connectors");
      if (!response.ok) return;
      const body = (await response.json()) as { connectors?: ConnectorOption[] };
      if (Array.isArray(body.connectors)) setConnectors(body.connectors);
    } catch {
      return;
    }
  }

  return (
    <div className="space-y-6">
      <ConnectorOauthBanner />
      <RequestForm />
      {connectors !== null &&
        (connectors.length === 0 ? (
          <p className="rounded-card border border-dashed border-line bg-surface-2 px-5 py-8 text-center text-sm text-ink-muted">
            No connectors are available to you yet.
          </p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {connectors.map((connector) => (
              <ConnectorCard key={connector.slug} connector={connector} onChanged={() => void refetch()} />
            ))}
          </div>
        ))}
    </div>
  );
}
