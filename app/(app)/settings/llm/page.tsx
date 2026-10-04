import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { KeyRound } from "lucide-react";
import { PageHeader } from "@/components/kit/page-header";
import { LlmSettings } from "@/components/settings/llm/llm-settings";
import { requireIdentity } from "@/lib/auth/identity";
import { aliasIndex, canonicalEmail } from "@/lib/authority/aliases";
import { loadGroups } from "@/lib/authority/groups";
import { getDb } from "@/lib/db/client";
import { listLlmKeys } from "@/lib/db/llm-keys";
import { listBudgetRequests } from "@/lib/db/llm-requests";
import { isLlmKeysEnabled, llmEnv } from "@/lib/llm/config";
import { createBudgetResolver } from "@/lib/llm/snapshot";
import type { UserBudgetView } from "@/lib/llm/view-types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Personal LLM keys (spec 2026-10-03): the viewer's keys, what each model group
 * they may use has left this period, and harness setup. Blocked groups are not
 * shown. The figures come from the same resolver the gate's snapshot uses.
 */
export default async function LlmSettingsPage() {
  if (!isLlmKeysEnabled()) notFound();
  const auth = await requireIdentity(await headers());
  if ("response" in auth) notFound();
  const email = canonicalEmail(auth.identity.email, aliasIndex());
  const db = getDb();

  const resolver = createBudgetResolver(db, loadGroups());
  const groupsBySlug = new Map(resolver.modelGroups.map((g) => [g.slug, g]));
  const budgets: UserBudgetView[] = resolver
    .budgetsFor(email)
    .filter((b) => b.allowed)
    .map((b) => ({
      groupSlug: b.groupSlug,
      label: groupsBySlug.get(b.groupSlug)?.label ?? b.groupSlug,
      models: groupsBySlug.get(b.groupSlug)?.models ?? [],
      tokens: b.tokens,
      period: b.period,
      resetAt: b.resetAt,
      used: b.used,
      bonus: b.bonus,
    }));

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-5">
      <PageHeader
        eyebrow="Settings"
        title="LLM keys"
        description="Your own keys for Claude Code, Cursor, Cline, Codex and Continue: local and paid models through one endpoint, within budgets your admins set."
        icon={KeyRound}
      />
      <LlmSettings
        keys={listLlmKeys(db, email)}
        budgets={budgets}
        requests={listBudgetRequests(db, { requesterEmail: email })}
        publicUrl={llmEnv().publicUrl}
      />
    </div>
  );
}
