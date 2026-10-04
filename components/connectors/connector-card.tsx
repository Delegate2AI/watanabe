"use client";

import { useState } from "react";
import Link from "next/link";
import { messageForBody } from "@/lib/errors/messages";
import type { ConnectorIcon } from "@/lib/connectors/types";

export interface ConnectorOption {
  slug: string;
  title: string;
  transport: string;
  description?: string;
  icon?: ConnectorIcon;
  auth?: "oauth";
  connected?: boolean;
}

const ICON_GLYPHS: Record<ConnectorIcon, string> = {
  plug: "🔌",
  chart: "📊",
  chat: "💬",
  calendar: "📅",
  doc: "📄",
  code: "💻",
  cloud: "☁️",
  search: "🔍",
};

function glyphFor(icon: ConnectorIcon | undefined): string {
  return icon ? (ICON_GLYPHS[icon] ?? ICON_GLYPHS.plug) : ICON_GLYPHS.plug;
}

function ConnectorAuthControl({
  connector,
  busy,
  onConnect,
  onDisconnect,
}: {
  connector: ConnectorOption;
  busy: boolean;
  onConnect: () => void;
  onDisconnect: () => void;
}) {
  if (connector.connected === undefined) {
    return <span className="text-xs text-ink-faint">Not available yet</span>;
  }

  if (connector.connected) {
    return (
      <div className="flex items-center gap-2">
        <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[11px] font-medium text-ink">Connected</span>
        <button
          type="button"
          onClick={onDisconnect}
          disabled={busy}
          className="text-xs font-medium text-warn underline disabled:opacity-60"
        >
          Disconnect
        </button>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={onConnect}
      disabled={busy}
      className="rounded-md bg-accent px-3 py-1 text-xs font-medium text-white hover:opacity-90 disabled:opacity-60"
    >
      {busy ? "Connecting..." : "Connect"}
    </button>
  );
}

export function ConnectorCard({
  connector,
  onChanged,
}: {
  connector: ConnectorOption;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function connect(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/connectors/${connector.slug}/oauth`, { method: "POST" });
      if (!response.ok) {
        setError(messageForBody(await response.json().catch(() => null)));
        return;
      }
      const body = (await response.json()) as { redirect?: string };
      if (body.redirect) window.location.assign(body.redirect);
    } catch {
      setError("The connection could not be started.");
    } finally {
      setBusy(false);
    }
  }

  async function disconnect(): Promise<void> {
    if (!window.confirm(`Disconnect ${connector.title}?`)) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/connectors/${connector.slug}/oauth`, { method: "DELETE" });
      if (!response.ok) {
        setError(messageForBody(await response.json().catch(() => null)));
        return;
      }
      onChanged();
    } catch {
      setError("The connector could not be disconnected.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <article className="flex flex-col gap-3 rounded-card border border-line bg-surface p-4">
      <div className="flex items-center gap-3">
        <span aria-hidden className="grid size-9 shrink-0 place-items-center rounded-full bg-surface-2 text-lg">
          {glyphFor(connector.icon)}
        </span>
        <div className="min-w-0">
          <h3 className="truncate text-sm font-semibold text-ink">{connector.title}</h3>
          <p className="text-xs text-ink-faint">{connector.transport}</p>
        </div>
      </div>
      {connector.description && (
        <p className="text-sm text-ink-muted text-pretty">{connector.description}</p>
      )}
      <div className="mt-auto flex items-center justify-between gap-3">
        <Link
          href={`/?connector=${encodeURIComponent(connector.slug)}`}
          className="text-sm font-medium text-accent underline"
        >
          Use in a new chat
        </Link>
        {connector.auth === "oauth" && (
          <ConnectorAuthControl
            connector={connector}
            busy={busy}
            onConnect={() => void connect()}
            onDisconnect={() => void disconnect()}
          />
        )}
      </div>
      {error && (
        <p role="alert" className="text-xs text-warn">
          {error}
        </p>
      )}
    </article>
  );
}
