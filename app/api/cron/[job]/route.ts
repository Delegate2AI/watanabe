import { checkCronSecret } from "@/lib/jobs/config";
import { dispatch } from "@/lib/jobs/dispatch";
import { fail } from "@/lib/errors/codes";
import { log } from "@/lib/log";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteContext = { params: Promise<{ job: string }> };

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  if (!checkCronSecret(request.headers.get("x-cron-secret"))) {
    // Body-less: the caller is a scheduler, and naming the missing secret on
    // the wire would tell an unauthenticated prober what to look for.
    return new Response(null, { status: 401 });
  }

  const { job } = await context.params;
  // dispatch reads the run-state DB (schema ensure + select). Job execution itself
  // never throws, but a DB open or lock failure can throw out of dispatch. Contain
  // it as a recorded 500 so an infra fault degrades instead of crashing the route.
  let result;
  try {
    result = dispatch(job);
  } catch (err) {
    log.error("cron dispatch failed", { job, error: String(err) });
    return fail("internal");
  }
  if (result.status === "unknown") {
    return fail("not_found");
  }
  if (result.status === "disabled") {
    return new Response(null, { status: 204 });
  }
  return Response.json(result, { status: 202 });
}
