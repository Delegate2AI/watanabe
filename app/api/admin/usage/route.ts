import { requireIdentity } from "@/lib/auth/identity";
import { getDb } from "@/lib/db/client";
import { fail } from "@/lib/errors/codes";
import { log } from "@/lib/log";
import { actorFor } from "@/lib/service/actor";
import { respond } from "@/lib/service/http";
import { isUsageAuditEnabled } from "@/lib/usage/config";
import { exportUsage, listOwnerThreads, summarizeUsage } from "@/lib/usage/service/usage";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const VIEWS = new Set(["summary", "threads", "csv"]);

export async function GET(request: Request): Promise<Response> {
  if (!isUsageAuditEnabled()) return new Response(null, { status: 404 });
  const auth = await requireIdentity(request.headers);
  if ("response" in auth) return auth.response;

  const params = new URL(request.url).searchParams;
  const view = params.get("view") ?? "summary";
  if (!VIEWS.has(view)) return fail("invalid_request", { detail: "view" });
  const from = params.get("from");
  const to = params.get("to");
  const owner = params.get("owner");
  const raw = {
    ...(from === null ? {} : { from }),
    ...(to === null ? {} : { to }),
    ...(owner === null ? {} : { owner }),
  };

  try {
    const ctx = { db: getDb(), actor: actorFor(auth.identity.email) };
    if (view === "threads") return respond(listOwnerThreads(ctx, raw));
    if (view === "csv") {
      return respond(
        exportUsage(ctx, raw),
        (value) =>
          new Response(value.csv, {
            headers: {
              "content-type": "text/csv; charset=utf-8",
              "content-disposition": `attachment; filename="${value.filename}"`,
            },
          }),
      );
    }
    return respond(summarizeUsage(ctx, raw));
  } catch (error) {
    log.error("usage request failed", { route: "GET /api/admin/usage", error: String(error) });
    return fail("internal");
  }
}
