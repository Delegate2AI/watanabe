import { z } from "zod";
import { getDb } from "@/lib/db/client";
import { touchLlmKeys } from "@/lib/db/llm-keys";
import { applyUsageBatch } from "@/lib/db/llm-usage";
import { fail } from "@/lib/errors/codes";
import { isLlmKeysEnabled } from "@/lib/llm/config";
import { checkGateSecret } from "@/lib/llm/internal-auth";
import { log } from "@/lib/log";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const count = z.number().int().nonnegative();
const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
/** Bounded so one malformed or hostile request cannot hold the database for long. */
const MAX_ITEMS = 5000;

const Batch = z.object({
  batchId: z.string().min(1).max(100),
  deltas: z.array(
    z.object({
      ownerEmail: z.string().min(1),
      groupSlug: z.string().min(1),
      model: z.string().min(1),
      periodStart: isoDay,
      day: isoDay,
      inputTokens: count,
      outputTokens: count,
      cacheReadTokens: count,
      requests: count,
    }),
  ).max(MAX_ITEMS),
  touched: z.array(z.object({ id: z.string().min(1), at: z.iso.datetime() })).max(MAX_ITEMS).optional(),
});

/**
 * Usage deltas pushed by llm-gate every 5 seconds. A repeated batch id is
 * acknowledged and its deltas ignored. Touches only ever move `last_used_at`
 * forward, so they are applied either way: a retry after a failed touch must
 * not lose them. Times are normalized because the column compares as text.
 */
export async function POST(request: Request): Promise<Response> {
  if (!isLlmKeysEnabled()) return new Response(null, { status: 404 });
  const denied = checkGateSecret(request);
  if (denied) return denied;

  const parsed = Batch.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return fail("invalid_request");
  const { batchId, deltas, touched } = parsed.data;

  try {
    const db = getDb();
    const outcome = applyUsageBatch(db, batchId, deltas);
    if (touched?.length) touchLlmKeys(db, touched.map((t) => ({ id: t.id, at: new Date(t.at).toISOString() })));
    return Response.json({ ok: true, duplicate: outcome === "duplicate" });
  } catch (e) {
    log.error("llm usage batch failed", { batchId, error: (e as Error).message });
    return fail("internal");
  }
}
