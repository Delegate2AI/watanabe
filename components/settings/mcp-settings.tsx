"use client";

import { useCallback, useState } from "react";
import { Check, Copy, Plug, Trash2 } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { messageForBody } from "@/lib/errors/messages";
import { notifyFailure, notifySuccess } from "@/lib/ui/toast";

/**
 * Connecting an MCP client, and the grants already given (spec 2026-09-05, D7).
 *
 * The Connect tab is one URL. There is no client id and no secret on this page
 * because none exists: the authorization server registers clients dynamically
 * and issues no secret, which is the whole reason this surface could be built
 * for everybody rather than handed out by an admin.
 */

interface TokenSummary {
  id: string;
  name: string;
  clientId: string | null;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

function day(iso: string | null): string {
  return iso ? iso.slice(0, 10) : "never";
}

function CopyRow({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <div className="flex items-center gap-2 rounded-lg bg-surface-2 p-2">
      <code className="min-w-0 flex-1 truncate px-1 text-xs text-ink">{value}</code>
      <button
        type="button"
        onClick={() => {
          void navigator.clipboard
            ?.writeText(value)
            .then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            })
            .catch(() => notifyFailure("Could not copy. Select the address and copy it by hand."));
        }}
        className="flex shrink-0 items-center gap-1 rounded-md border border-line px-2 py-1 text-xs font-medium text-ink-muted hover:bg-surface-hover hover:text-ink"
      >
        {copied ? <Check className="size-3.5 text-accent" aria-hidden /> : <Copy className="size-3.5" aria-hidden />}
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}

export function McpSettings({
  endpoint,
  initialTokens = [],
}: {
  endpoint: string | null;
  /** Read on the server, like the admin token panel, so nothing is fetched on mount. */
  initialTokens?: TokenSummary[];
}) {
  const [tokens, setTokens] = useState<TokenSummary[]>(initialTokens);
  const [pending, setPending] = useState(false);

  const load = useCallback(async () => {
    const response = await fetch("/api/settings/mcp-tokens");
    if (!response.ok) return;
    const body = await response.json() as { tokens: TokenSummary[] };
    setTokens(body.tokens);
  }, []);

  async function revoke(id: string): Promise<void> {
    setPending(true);
    try {
      const response = await fetch(`/api/settings/mcp-tokens?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      if (!response.ok) {
        notifyFailure(messageForBody(await response.json().catch(() => null)));
        return;
      }
      notifySuccess("Access revoked.");
      await load();
    } catch {
      notifyFailure("Access could not be revoked.");
    } finally {
      setPending(false);
    }
  }

  const live = tokens.filter((token) => token.revokedAt === null);

  return (
    <Tabs defaultValue="connect">
      <TabsList>
        <TabsTrigger value="connect">Connect</TabsTrigger>
        <TabsTrigger value="access">Connected apps</TabsTrigger>
      </TabsList>

      <TabsContent value="connect">
        <div className="rounded-xl bg-surface p-6 shadow-[0_0_0_1px_rgba(0,0,0,0.06)]">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-ink">
            <Plug className="size-4 text-accent" aria-hidden />
            Connect an MCP client
          </h2>

          {endpoint === null ? (
            <p className="mt-2 text-sm text-ink-muted">
              MCP is not available on this deployment. Ask an admin to turn it on.
            </p>
          ) : (
            <>
              <p className="mt-2 text-sm text-ink-muted">
                Add this address as a custom connector in Claude, or any other MCP client. It will
                ask you to sign in here and approve the connection.
              </p>
              <div className="mt-3">
                <CopyRow value={endpoint} />
              </div>
              <ol className="mt-4 flex list-decimal flex-col gap-1.5 pl-4 text-sm text-ink-muted">
                <li>Open your client&apos;s connector settings and add a custom connector.</li>
                <li>Paste the address above. There is no client ID or secret to enter.</li>
                <li>Approve the connection on the page that opens.</li>
              </ol>
              <p className="mt-4 text-xs text-ink-faint">
                The client sees exactly what you can already see. Your groups and your role decide
                which tools it gets, checked every time it calls one, so this never gives an
                application more access than you have.
              </p>
            </>
          )}
        </div>
      </TabsContent>

      <TabsContent value="access">
        <div className="rounded-xl bg-surface p-6 shadow-[0_0_0_1px_rgba(0,0,0,0.06)]">
          <h2 className="text-sm font-semibold text-ink">Connected apps</h2>
          {live.length === 0 ? (
            <p className="mt-2 text-sm text-ink-muted">Nothing is connected yet.</p>
          ) : (
            <ul className="mt-3 flex flex-col gap-2">
              {live.map((token) => (
                <li key={token.id} className="flex flex-wrap items-center gap-3 text-sm">
                  <span className="font-medium text-ink">{token.name}</span>
                  <span className="rounded-chip bg-surface-2 px-2 py-0.5 text-xs text-ink-muted">
                    {token.clientId === null ? "Portal token" : "Connected app"}
                  </span>
                  <span className="text-xs text-ink-faint">
                    added {day(token.createdAt)}, last used {day(token.lastUsedAt)}
                  </span>
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => void revoke(token.id)}
                    className="ml-auto flex items-center gap-1 rounded-md border border-line px-2 py-1 text-xs font-medium text-ink-muted hover:bg-surface-hover hover:text-ink disabled:opacity-60"
                  >
                    <Trash2 className="size-3.5" aria-hidden />
                    Revoke
                  </button>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-4 text-xs text-ink-faint">
            Revoking takes effect immediately. The application will ask to connect again the next
            time it is used.
          </p>
        </div>
      </TabsContent>
    </Tabs>
  );
}
