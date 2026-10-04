import { getDb } from "@/lib/db/client";
import { upsertMeetingPayload } from "@/lib/db/meeting-payloads";
import { insertMeetingJob } from "@/lib/db/meetings";
import { fail } from "@/lib/errors/codes";
import { log } from "@/lib/log";
import {
  circlebackWebhookSecret,
  isMeetingsEnabled,
  isMeetingsWebhookEnabled,
} from "@/lib/meetings/config";
import { enqueueMeeting } from "@/lib/meetings/queue";
import { meetingIdFromWebhookPayload, verifyWebhookSignature } from "@/lib/meetings/webhook";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/webhooks/circleback -> accept one signed Circleback meeting.
 *
 * This is the only route in the app that does NOT call `requireIdentity`. It is
 * called by Circleback, which holds no portal identity and never will, so the
 * HMAC signature IS the authentication: an unsigned or wrongly signed body is
 * refused before it can reach the database. Two consequences worth stating
 * plainly, because they are what make that safe:
 *
 * 1. Nothing here trusts the body's contents for access decisions. The stored
 *    payload only becomes a note through the ordinary runner, which derives
 *    visibility from attendees via `deriveMeetingVisibility` and fails closed.
 *    A forged body could therefore only ever produce a note whose clearance is
 *    computed the same way every other meeting's is.
 * 2. With `MEETINGS_WEBHOOK_ENABLED` off the route is a dark 404, so the
 *    externally reachable surface exists only where it has been switched on.
 *
 * Responds as soon as the payload is durable. Normalization, clearance, and the
 * vault commit all happen on the queue: a webhook sender deserves a fast ack,
 * and holding the connection open for an agent call would only invite retries.
 */
export async function POST(request: Request): Promise<Response> {
  if (!isMeetingsEnabled() || !isMeetingsWebhookEnabled()) return fail("not_found");

  const secret = circlebackWebhookSecret();
  if (!secret) {
    // Flag on with no secret is a misconfiguration, not an open door: refuse
    // every delivery rather than accept unsigned bodies.
    log.error("circleback webhook refused: no signing secret configured", {
      route: "POST /api/webhooks/circleback",
      status: 404,
    });
    return fail("not_found");
  }

  const rawBody = await request.text();
  if (!verifyWebhookSignature(rawBody, request.headers.get("x-signature"), secret)) {
    log.warn("circleback webhook rejected", {
      route: "POST /api/webhooks/circleback",
      status: 403,
      reason: "signature mismatch",
      bytes: rawBody.length,
    });
    return fail("not_cleared");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return fail("invalid_request");
  }

  const meetingId = meetingIdFromWebhookPayload(parsed);
  if (!meetingId) return fail("invalid_request");

  try {
    const db = getDb();
    // Payload first, then the job row: a crash between them leaves a stored
    // body with no job, which the next delivery repairs. The reverse order
    // would leave a job whose payload cannot be read and never will be.
    upsertMeetingPayload(db, meetingId, rawBody);
    insertMeetingJob(db, meetingId);
    enqueueMeeting(meetingId);
    log.info("circleback webhook accepted", {
      route: "POST /api/webhooks/circleback",
      meetingId,
      bytes: rawBody.length,
    });
    return Response.json({ accepted: true, meetingId });
  } catch (e) {
    log.error("circleback webhook failed", {
      route: "POST /api/webhooks/circleback",
      status: 500,
      meetingId,
      err: String(e),
    });
    return fail("internal");
  }
}
