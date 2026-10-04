import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { getDb } from "@/lib/db/client";
import { resolveExternalView } from "@/lib/shared-docs/external-view";
import { ExternalDocView, ExternalThrottled } from "@/components/docs/external-doc-view";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * The external, token-authed shared-doc page (spec 28). This is the ONLY
 * unauthenticated read surface: it is reached with a link token instead of the
 * normal proxy-header identity, so it is strictly capability-limited. All policy
 * lives in `resolveExternalView` (flag gate, rate limit, token validation, no
 * oracle). Here we only map the resolved status to a render:
 *
 *  - unavailable (flag off) and not-found (unknown/revoked/expired token) both
 *    map to `notFound()`, the same 404 with no id/owner leak.
 *  - rate-limited renders a throttle notice identical for valid and invalid
 *    tokens, so a token cannot be brute-force walked.
 *  - ok renders a read-only view: no edit, no share manager, no owner details.
 */
export default async function ExternalSharedDocPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const h = await headers();
  const clientKey = h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "anonymous";

  const view = resolveExternalView(getDb(), token, clientKey);
  if (view.status === "unavailable" || view.status === "not-found") notFound();
  if (view.status === "rate-limited") return <ExternalThrottled />;

  return (
    <ExternalDocView
      title={view.title}
      body={view.body}
      format={view.format}
      access={view.access}
      comments={view.comments}
    />
  );
}
