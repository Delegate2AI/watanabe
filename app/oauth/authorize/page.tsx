import { ShieldCheck, TriangleAlert } from "lucide-react";
import { requireIdentity } from "@/lib/auth/identity";
import { isKnownMember, loadGroups } from "@/lib/authority/groups";
import { getDb } from "@/lib/db/client";
import { checkAuthorizeParams } from "@/lib/mcp-auth/authorize";
import { isMcpAuthServerReady } from "@/lib/mcp-auth/config";
import { notFound } from "next/navigation";
import { headers } from "next/headers";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * The consent screen (spec 2026-09-05, D5).
 *
 * Deliberately outside the `(app)` route group: no sidebar, no threads, nothing
 * to click but the two buttons. A person arrives here from another application
 * and the only question is whether they meant to.
 *
 * The client's name is **self-declared**. Registration is open, so anyone can
 * register a client called anything. It is rendered as text by JSX, never as
 * markup, and labelled as claimed rather than verified. The line a person can
 * actually judge is the address underneath it, which is checked against what
 * the client registered before this page renders at all.
 */

function Refusal({ reason }: { reason: string }) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-4 px-6">
      <div className="rounded-xl bg-surface p-6 shadow-[0_0_0_1px_rgba(0,0,0,0.06)]">
        <h1 className="flex items-center gap-2 text-sm font-semibold text-ink">
          <TriangleAlert className="size-4 text-accent" aria-hidden />
          This request cannot be approved
        </h1>
        <p className="mt-2 text-sm text-ink-muted">{reason}</p>
        <p className="mt-4 text-xs text-ink-faint">
          Nothing has been shared. You can close this page.
        </p>
      </div>
    </main>
  );
}

export default async function AuthorizePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (!isMcpAuthServerReady()) notFound();

  const auth = await requireIdentity(await headers());
  if ("response" in auth) notFound();
  if (!isKnownMember(auth.identity.email, loadGroups())) {
    return <Refusal reason="This workspace does not recognize your account." />;
  }

  const raw = await searchParams;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === "string") params.set(key, value);
  }

  const checked = checkAuthorizeParams(getDb(), params);
  if (!checked.ok) {
    // A protocol error is the client's to fix and is delivered to it by the
    // POST route; there is nothing useful to show a person here beyond the fact
    // that the link is wrong.
    if (checked.kind === "redirect") {
      return <Refusal reason="This link is malformed. Ask the application to try again." />;
    }
    return <Refusal reason={checked.reason} />;
  }

  const { client, request } = checked;
  const returnsTo = new URL(request.redirectUri).origin;

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-4 px-6">
      <div className="rounded-xl bg-surface p-6 shadow-[0_0_0_1px_rgba(0,0,0,0.06)]">
        <h1 className="flex items-center gap-2 text-sm font-semibold text-ink">
          <ShieldCheck className="size-4 text-accent" aria-hidden />
          Connect an application
        </h1>

        <p className="mt-3 text-sm text-ink-muted">
          An application calling itself{" "}
          <strong className="font-medium text-ink">{client.clientName}</strong> is asking to use
          Watanabe as <strong className="font-medium text-ink">{auth.identity.email}</strong>.
        </p>

        <dl className="mt-4 flex flex-col gap-2 rounded-lg bg-surface-2 p-3 text-xs">
          <div className="flex justify-between gap-3">
            <dt className="text-ink-faint">Returns you to</dt>
            <dd className="truncate font-medium text-ink">{returnsTo}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-ink-faint">It will be able to</dt>
            <dd className="text-right font-medium text-ink">
              read and act on what you can already reach
            </dd>
          </div>
        </dl>

        <p className="mt-3 text-xs text-ink-faint">
          The name above is what the application calls itself and has not been verified. The address
          is the one it registered. If you did not start this, deny it.
        </p>

        <form method="POST" action="/api/oauth/authorize" className="mt-5 flex gap-2">
          <input type="hidden" name="client_id" value={request.clientId} />
          <input type="hidden" name="redirect_uri" value={request.redirectUri} />
          <input type="hidden" name="response_type" value="code" />
          <input type="hidden" name="code_challenge" value={request.codeChallenge} />
          <input type="hidden" name="code_challenge_method" value="S256" />
          {request.state !== null && <input type="hidden" name="state" value={request.state} />}

          <button
            type="submit"
            name="decision"
            value="deny"
            className="flex-1 rounded-lg border border-line px-3 py-2 text-sm font-medium text-ink-muted hover:bg-surface-hover hover:text-ink"
          >
            Deny
          </button>
          <button
            type="submit"
            name="decision"
            value="approve"
            className="flex-1 rounded-lg bg-accent px-3 py-2 text-sm font-medium text-accent-fg hover:opacity-90"
          >
            Approve
          </button>
        </form>
      </div>

      <p className="text-center text-xs text-ink-faint">
        Approving does not give the application more than you have. Everything it does is checked
        against your own access, every time.
      </p>
    </main>
  );
}
