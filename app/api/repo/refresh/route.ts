import { constantTimeEquals } from "@/lib/auth/identity";
import { refreshRepo } from "@/lib/repo";
import { reconcileInReviewArtifacts } from "@/lib/artifacts/reconcile";
import { getDb } from "@/lib/db/client";
import { rebuildIndex } from "@/lib/index/cache";
import { isIndexEnabled } from "@/lib/index/config";
import { clearKbGraphCache } from "@/lib/kb/graph-cache";
import { log } from "@/lib/log";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const WEBHOOK_TOKEN_HEADER = "x-gitlab-token";

/**
 * GitLab push-webhook target for the write path's `mr`-mode view freshness
 * (spec 10 D13): `/data/repo` (the read-serving checkout) is otherwise only
 * refreshed at boot, so a Merge Request merged on GitLab would sit
 * unreflected in the portal's own view until the next restart. Configure
 * this URL as a GitLab project webhook (Settings → Webhooks, "Push events",
 * secret token = `REPO_REFRESH_WEBHOOK_SECRET`) once that secret is
 * provisioned — see `helm/README.md`.
 *
 * Not identity-gated (SSO headers won't be present on a GitLab-originated
 * call) — the shared-secret `X-Gitlab-Token` header IS the auth here, the
 * same constant-time comparison `lib/auth/identity.ts` uses for its own
 * proxy-assertion header. Fails closed by absence: if
 * `REPO_REFRESH_WEBHOOK_SECRET` is unset, this route always 501s rather than
 * ever accepting an unauthenticated trigger.
 *
 * `direct`-mode `kb_submit` (see `lib/kb-mcp/write-tools.ts`) does NOT depend
 * on this webhook — it calls `refreshRepo()` directly after a successful
 * push, so that mode's freshness works even before this webhook exists.
 * `instrumentation.ts` also polls `refreshRepo()` on a `REPO_REFRESH_INTERVAL_MS`
 * timer (when write mode is on) as a fallback for `mr` mode.
 */
export async function POST(request: Request): Promise<Response> {
  const secret = process.env.REPO_REFRESH_WEBHOOK_SECRET?.trim();
  if (!secret) {
    log.warn("repo refresh webhook rejected", {
      route: "POST /api/repo/refresh",
      status: 501,
      reason: "REPO_REFRESH_WEBHOOK_SECRET not configured",
    });
    // Body-less on purpose. This endpoint answers GitLab, not a person, and
    // the reason (which secret is missing) belongs in the log, not on the wire.
    return new Response(null, { status: 501 });
  }

  const provided = request.headers.get(WEBHOOK_TOKEN_HEADER);
  if (!provided || !constantTimeEquals(provided, secret)) {
    log.warn("repo refresh webhook rejected", {
      route: "POST /api/repo/refresh",
      status: 401,
      reason: "missing or invalid webhook token",
      hasToken: Boolean(provided),
    });
    return new Response(null, { status: 401 });
  }

  await refreshRepo();
  if (isIndexEnabled()) {
    rebuildIndex();
  }
  // Same reason as the index rebuild above, for the link graph and the backlink
  // map: both are cached per clearance root on a TTL, and this hook exists so a
  // merge shows up now rather than within an interval. Dropping the entries is
  // enough, they rebuild on the next read.
  clearKbGraphCache();
  // "main may have moved" is also the signal that a merge request may have been
  // merged or closed, so this is where an artifact waiting on review finds out.
  // After the refresh on purpose: an artifact is only called published once the
  // merged note is actually in the checkout the knowledge base reads from.
  // Never throws (see reconcileInReviewArtifacts), so it cannot fail the hook.
  const reconciled = await reconcileInReviewArtifacts(getDb());
  log.info("repo refresh webhook triggered", { route: "POST /api/repo/refresh", ...reconciled });
  return Response.json({ ok: true });
}
