import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { Plug } from "lucide-react";
import { PageHeader } from "@/components/kit/page-header";
import { McpSettings } from "@/components/settings/mcp-settings";
import { requireIdentity } from "@/lib/auth/identity";
import { getDb } from "@/lib/db/client";
import { isMcpEnabled } from "@/lib/mcp-auth/config";
import { listTokens } from "@/lib/mcp-auth/tokens";
import { authorizationServerConfig } from "@/lib/mcp-auth/server-config";

/**
 * Connecting an MCP client (spec 2026-09-05, D7).
 *
 * The surface that finally makes the MCP endpoint reachable by somebody who is
 * not an admin. It carries no credential of any kind: the authorization server
 * registers clients dynamically and issues no secret, so the whole instruction
 * is one address.
 *
 * Visible to every member, with no capability check. Which tools a connected
 * client actually gets is decided by that person's own roles and clearance at
 * call time, so this page grants nothing by existing.
 *
 * Identity is resolved once in the `(app)` layout and inherited here, like the
 * sibling content routes.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function McpSettingsPage() {
  if (!isMcpEnabled()) notFound();

  // Null when the deployment has not been configured. The page still renders
  // and says so, rather than showing an address that resolves nowhere.
  const endpoint = authorizationServerConfig()?.resource ?? null;

  // Read here rather than fetched after hydration, like the admin token panel:
  // the list paints with the page and the client component owns no effect.
  const auth = await requireIdentity(await headers());
  const tokens = "response" in auth ? [] : listTokens(getDb(), auth.identity.email);

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-5">
      <PageHeader
        eyebrow="Settings"
        title="MCP access"
        description="Use Watanabe from Claude, or any other client that speaks MCP."
        icon={Plug}
      />
      <McpSettings endpoint={endpoint} initialTokens={tokens} />
    </div>
  );
}
