"use client";

import { useCallback, useState } from "react";
import { KeyRound } from "lucide-react";
import { messageForBody } from "@/lib/errors/messages";
import { notifyFailure, notifySuccess } from "@/lib/ui/toast";
import { buttonClass } from "./access-ui";
import { useChangeRequestTerms } from "@/components/app-config-provider";

/**
 * The admin's own MCP client credentials (spec 2026-08-21-admin-kb-mcp).
 *
 * The plaintext is shown once, at creation, and never again: the list route
 * carries the summary only. Revoking is immediate.
 */

interface TokenSummary {
  id: string;
  name: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

function day(iso: string | null): string {
  return iso ? iso.slice(0, 10) : "never";
}

export function McpTokensPanel({
  enabled,
  initialTokens = [],
}: {
  enabled: boolean;
  /** Read on the server, like every other list on this page. */
  initialTokens?: TokenSummary[];
}) {
  const terms = useChangeRequestTerms();
  const [tokens, setTokens] = useState<TokenSummary[]>(initialTokens);
  const [name, setName] = useState("");
  const [minted, setMinted] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const load = useCallback(async () => {
    const response = await fetch("/api/admin/mcp-tokens");
    if (!response.ok) return;
    const body = await response.json() as { tokens: TokenSummary[] };
    setTokens(body.tokens);
  }, []);

  if (!enabled) {
    return (
      <div className="rounded-xl bg-surface p-6 text-sm text-ink-muted shadow-[0_0_0_1px_rgba(0,0,0,0.06)]">
        MCP client access is turned off. Ask an admin to enable it.
      </div>
    );
  }

  async function mint(): Promise<void> {
    if (!name.trim()) return;
    setPending(true);
    setMinted(null);
    try {
      const response = await fetch("/api/admin/mcp-tokens", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: name.trim() }),
      });
      const body = await response.json() as { token?: string; error?: unknown };
      if (!response.ok || !body.token) {
        notifyFailure(messageForBody(body));
        return;
      }
      setMinted(body.token);
      setName("");
      notifySuccess("Token created.");
      await load();
    } catch {
      notifyFailure("Token could not be created.");
    } finally {
      setPending(false);
    }
  }

  async function revoke(id: string): Promise<void> {
    setPending(true);
    try {
      const response = await fetch(`/api/admin/mcp-tokens?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      if (!response.ok) {
        notifyFailure(messageForBody(await response.json().catch(() => null)));
        return;
      }
      notifySuccess("Token revoked.");
      await load();
    } catch {
      notifyFailure("Token could not be revoked.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="rounded-xl bg-surface p-6 shadow-[0_0_0_1px_rgba(0,0,0,0.06)]">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-ink">
          <KeyRound className="size-4 text-accent" aria-hidden />
          MCP client tokens
        </h2>
        <p className="mt-1 text-sm text-ink-muted">
          Point an MCP client at <code>/api/mcp</code> with this token as a bearer credential to read and
          propose knowledge-base changes. Every change still lands as a {terms.long}.
        </p>

        <div className="mt-4 flex flex-wrap gap-2">
          <label className="sr-only" htmlFor="mcp-token-name">Token name</label>
          <input
            id="mcp-token-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="What is it for? e.g. laptop"
            className="min-w-56 flex-1 rounded-lg bg-surface-2 px-3 py-2 text-sm text-ink shadow-[0_0_0_1px_rgba(0,0,0,0.06)]"
          />
          <button type="button" disabled={pending || !name.trim()} onClick={() => void mint()} className={buttonClass}>
            Create token
          </button>
        </div>

        {minted && (
          <div className="mt-4 rounded-lg bg-surface-2 p-3">
            <p className="text-xs font-medium text-ink">
              Copy this now. It is not shown again, and it cannot be recovered.
            </p>
            <code className="mt-2 block break-all rounded bg-surface px-3 py-2 text-xs text-ink">{minted}</code>
          </div>
        )}
      </div>

      <div className="rounded-xl bg-surface p-6 shadow-[0_0_0_1px_rgba(0,0,0,0.06)]">
        {tokens.length === 0 ? (
          <p className="text-sm text-ink-muted">No tokens yet.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {tokens.map((token) => (
              <li key={token.id} className="flex flex-wrap items-center gap-3 text-sm">
                <span className="font-medium text-ink">{token.name}</span>
                <span className="text-xs text-ink-faint">
                  created {day(token.createdAt)}, last used {day(token.lastUsedAt)}
                </span>
                {token.revokedAt ? (
                  <span className="rounded-chip bg-surface-2 px-2 py-0.5 text-xs text-ink-muted">revoked</span>
                ) : (
                  <button type="button" disabled={pending} onClick={() => void revoke(token.id)} className={buttonClass}>
                    Revoke
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
