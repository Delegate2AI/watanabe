import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { Gauge } from "lucide-react";
import { UsageAdmin } from "@/components/admin/usage-admin";
import { PageHeader } from "@/components/kit/page-header";
import { can } from "@/lib/authority/roles";
import { getDb } from "@/lib/db/client";
import { resolveIdentity } from "@/lib/identity/resolve";
import { resolvePeople } from "@/lib/people/resolve";
import { actorFor } from "@/lib/service/actor";
import { isUsageAuditEnabled } from "@/lib/usage/config";
import { summarizeUsage } from "@/lib/usage/service/usage";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function UsageAdminPage() {
  if (!isUsageAuditEnabled()) notFound();
  const identity = await resolveIdentity(await headers());
  if (!identity || !can(identity.email, "manageAccess")) notFound();

  const result = summarizeUsage({ db: getDb(), actor: actorFor(identity.email) }, {});
  if (!result.ok) notFound();
  const summary = result.value;
  const people = resolvePeople(
    summary.owners.map((owner) => owner.ownerEmail),
    { viewerEmail: identity.email },
  );

  return (
    <div className="mx-auto max-w-5xl px-8 pb-14 pt-16">
      <PageHeader
        icon={Gauge}
        eyebrow="Administration"
        title="Usage and cost"
        description="What the portal spent through the API key, by person, by system source, and by model."
      />
      <UsageAdmin initial={summary} people={people} viewerEmail={identity.email} />
    </div>
  );
}
