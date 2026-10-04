import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { ShieldCheck } from "lucide-react";
import { AccessAdmin } from "@/components/admin/access-admin";
import { PageHeader } from "@/components/kit/page-header";
import { peopleOptions } from "@/components/person-view";
import { loadAccess, loadAccessHistory } from "@/lib/authority/access";
import { loadAliasMap } from "@/lib/authority/aliases-store";
import { isAliasAdminEnabled, isAuthorityEnabled } from "@/lib/authority/config";
import { getDb } from "@/lib/db/client";
import { isMcpEnabled } from "@/lib/mcp-auth/config";
import { listTokens } from "@/lib/mcp-auth/tokens";
import { can, isBootstrapAdmin, isRolesEnabled } from "@/lib/authority/roles";
import { FLAG_REGISTRY } from "@/lib/config/flag-registry";
import { isFlagEnabled } from "@/lib/config/flags";
import { resolveIdentity } from "@/lib/identity/resolve";
import { isPeopleEnabled } from "@/lib/people/config";
import { resolvePeople } from "@/lib/people/resolve";
import { loadPeople } from "@/lib/people/store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function AccessAdminPage() {
  const identity = await resolveIdentity(await headers());
  if (!identity || !can(identity.email, "manageAccess")) notFound();

  const [access, history] = await Promise.all([loadAccess(), loadAccessHistory()]);
  const flagStates = Object.fromEntries(FLAG_REGISTRY.map(({ envVar }) => [envVar, {
    enabled: isFlagEnabled(envVar, access.flags),
    envEnabled: process.env[envVar] === "1",
  }]));
  // Resolved here, on the server: the directory lives on disk, and the admin
  // tabs are a client component.
  const rosterEmails = [...new Set([
    ...Object.values(access.groups).flat(),
    ...Object.values(access.roles).flat(),
  ])];
  // The directory is the new source of candidates: everyone who has ever signed
  // in, not only those already carrying clearance. Read once here and handed to
  // resolvePeople, so the page still makes a single directory read.
  const directory = isPeopleEnabled() ? loadPeople() : {};
  // Gated at the source, not on the way out. Both forms that consume this list
  // only render under groupsEnabled, but resolving the directory into `people`
  // would still ship a name and initials for every signed-in address in the RSC
  // payload. Narrowing the emails keeps flag-off identical to the pre-picker
  // payload, not merely to the rendered output.
  const candidateEmails = isAuthorityEnabled()
    ? [...new Set([...rosterEmails, ...Object.keys(directory)])]
    : rosterEmails;
  // History actors get resolved too, which is how a history row names a person
  // rather than printing their address twice. They are not offered as
  // candidates: appearing in the audit log is not evidence anyone still exists.
  const known = [...new Set([...candidateEmails, ...history.map((entry) => entry.email)])];
  const people = resolvePeople(known, { viewerEmail: identity.email, directory });
  const candidates = peopleOptions(candidateEmails, people);
  // Read only while the panel can render it. Flag-off leaves the RSC payload
  // free of every alias address, not merely free of the rendered panel, the same
  // narrowing `candidateEmails` above does for the directory.
  const aliasesEnabled = isAliasAdminEnabled();
  const aliases = aliasesEnabled ? loadAliasMap() : {};
  // Same narrowing: flag-off leaves the RSC payload free of the token list too.
  const mcpTokensEnabled = isMcpEnabled();
  const mcpTokens = mcpTokensEnabled ? listTokens(getDb(), identity.email) : [];
  return (
    <div className="mx-auto max-w-5xl px-8 pb-14 pt-16">
      <PageHeader
        icon={ShieldCheck}
        eyebrow="Administration"
        title="Access administration"
        description="Manage group clearance, roles, and feature flags. Every accepted change is recorded on the private access history."
      />
      {/* The signed-in line lives in the tab bar inside AccessAdmin and nowhere
          else. It used to be printed here as well, so the page named the same
          person twice within a few lines. */}
      <AccessAdmin
        access={access}
        history={history}
        groupsEnabled={isAuthorityEnabled()}
        rolesEnabled={isRolesEnabled()}
        flagStates={flagStates}
        people={people}
        candidates={candidates}
        aliases={aliases}
        peopleEnabled={isPeopleEnabled()}
        aliasesEnabled={aliasesEnabled}
        mcpTokensEnabled={mcpTokensEnabled}
        mcpTokens={mcpTokens}
        viewerIsBootstrapAdmin={isBootstrapAdmin(identity.email)}
      />
    </div>
  );
}
