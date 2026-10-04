import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { Plug } from "lucide-react";
import { ConnectorsAdmin } from "@/components/admin/connectors-admin";
import type { ConnectorRow } from "@/components/admin/connectors-form";
import { PageHeader } from "@/components/kit/page-header";
import { loadAccess } from "@/lib/authority/access";
import { ALL_HANDS } from "@/lib/authority/group-keys";
import { can } from "@/lib/authority/roles";
import { isConnectorsEnabled } from "@/lib/connectors/config";
import { loadConnectorRegistry } from "@/lib/connectors/registry";
import { connectorEnvVars, withoutOauthClientSecret } from "@/lib/connectors/store";
import { scrubReason } from "@/lib/errors/scrub-reason";
import { resolveIdentity } from "@/lib/identity/resolve";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Spec 33's admin surface: the curated external MCP connector registry.
 *
 * Gated exactly like `/admin/access` (`notFound()` for anyone without
 * `manageAccess`), plus the subsystem flag, so with `CONNECTORS_ENABLED` off
 * the page does not exist and the sidebar shows no link to it.
 *
 * The registry, the clearance group names, and the presence of every `${VAR}`
 * an entry references are all read HERE, on the server. All three reach
 * `node:fs`, and the admin surface below is a client island, so it receives
 * plain serializable rows and never imports a loader itself.
 */
export default async function ConnectorsAdminPage() {
  const identity = await resolveIdentity(await headers());
  if (!identity) notFound();
  if (!isConnectorsEnabled()) notFound();
  if (!can(identity.email, "manageAccess")) notFound();

  const registry = loadConnectorRegistry();
  // Same shape GET /api/admin/connectors returns, so a refreshed render and the
  // route agree on what a row looks like. Presence only for the variables: the
  // value never leaves the server.
  const entries: ConnectorRow[] = [
    ...registry.entries.map((entry) => ({
      ...withoutOauthClientSecret(entry),
      status: "ok" as const,
      envVars: connectorEnvVars(entry),
    })),
    ...registry.errors.map((error) => ({
      slug: error.slug,
      status: "disabled" as const,
      // Scrubbed, exactly as GET /api/admin/connectors scrubs it: a loader
      // reason can be a YAML or filesystem error carrying an absolute path.
      reason: scrubReason(error.reason),
      envVars: [],
    })),
  ].sort((a, b) => a.slug.localeCompare(b.slug));
  // `all-hands` is the universal clearance and is implicit rather than declared,
  // so it is absent from groups.yaml. Offered explicitly, otherwise a connector
  // could be given to any single team but never to the whole workspace.
  const groupNames = [ALL_HANDS, ...Object.keys(loadAccess().groups).filter((g) => g !== ALL_HANDS).sort()];

  return (
    <div className="mx-auto max-w-5xl px-8 pb-14 pt-16">
      <PageHeader
        icon={Plug}
        eyebrow="Administration"
        title="Connectors"
        description="Curate the external MCP servers this workspace can reach. Every change is recorded on the private access history, and a connector is offered only to the groups listed on it."
      />
      <ConnectorsAdmin entries={entries} groupNames={groupNames} />
    </div>
  );
}
