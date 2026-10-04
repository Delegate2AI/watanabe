import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { Coins } from "lucide-react";
import { LlmAdmin } from "@/components/admin/llm/llm-admin";
import { PageHeader } from "@/components/kit/page-header";
import { loadGroups } from "@/lib/authority/groups";
import { can } from "@/lib/authority/roles";
import { getDb } from "@/lib/db/client";
import { resolveIdentity } from "@/lib/identity/resolve";
import { loadAdminData } from "@/lib/llm/admin-view";
import { isLlmKeysEnabled } from "@/lib/llm/config";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Budget requests, team and personal budgets, model groups, usage and keys (spec 2026-10-03). */
export default async function LlmAdminPage() {
  if (!isLlmKeysEnabled()) notFound();
  const identity = await resolveIdentity(await headers());
  if (!identity || !can(identity.email, "manageAccess")) notFound();

  return (
    <div className="mx-auto max-w-5xl px-8 pb-14 pt-16">
      <PageHeader
        icon={Coins}
        eyebrow="Administration"
        title="LLM budgets"
        description="Who may use which models through personal keys, how many tokens per period, and requests for more. Changes reach the gateway within seconds."
      />
      <div className="mt-6">
        <LlmAdmin data={loadAdminData(getDb(), loadGroups())} />
      </div>
    </div>
  );
}
