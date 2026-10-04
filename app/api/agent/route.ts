import { createFreshSession, isLiveSession, resumeOrGetSession } from "@/lib/agent/session";
import type { AgentEvent } from "@/lib/agent/events";
import type { DocBinding } from "@/lib/agent/copilot-prompt";
import { resolveDocBinding } from "@/lib/copilot-mcp/binding";
import { isDocCopilotEnabled } from "@/lib/shared-docs/config";
import { requireIdentity } from "@/lib/auth/identity";
import { makePendingPersister, refusePendingConnectors } from "@/lib/connectors/pending";
import { resolveOauthBearerForRequest } from "@/lib/connectors/oauth-headers";
import { resolveClearanceForEmail } from "@/lib/identity/resolve";
import { getDb } from "@/lib/db/client";
import { setThreadModelChoice } from "@/lib/db/threads";
import { docForThread } from "@/lib/db/doc-threads";
import { isOwnedBy } from "@/lib/db/ownership";
import { fail } from "@/lib/errors/codes";
import { log } from "@/lib/log";
import { renderContextBlock, type AttachmentContext } from "@/lib/agent/context-resolve";
import { appliedModelChoice, Body, resolveChips, type AgentRequestBody } from "./request";
import { analyticsIdFor } from "@/lib/analytics/config";
import { captureServerEvent } from "@/lib/analytics/server";
import { isAttachmentsEnabled } from "@/lib/attachments/store";
import { listAttachments } from "@/lib/attachments/read";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// The agent can run multi-step turns; give the route generous headroom.
export const maxDuration = 800;

const encoder = new TextEncoder();

/**
 * Send a user message to a KB chat session and stream that turn's events as
 * NDJSON. Creates a fresh session when `sessionId` is absent. Resuming an
 * existing `sessionId` requires it to belong to the caller (see
 * lib/db/ownership.ts), otherwise the request is refused with 403, never
 * silently turned into a fresh session and never resumed on someone else's
 * behalf. The first line (once known) is a `session` event carrying the
 * (possibly new) id.
 *
 * There is no `confirm`/mode field here: this portal has no write tools in
 * Phase 1, so the session's PreToolUse gate (see lib/agent/permissions.ts) is
 * a hard allow/deny boundary with no "ask the operator" tier to carry.
 */
export async function POST(request: Request): Promise<Response> {
  const auth = await requireIdentity(request.headers);
  if ("response" in auth) {
    log.warn("agent request rejected", { route: "POST /api/agent", status: 401, reason: "unauthorized" });
    return auth.response;
  }
  const { identity } = auth;

  let parsed: AgentRequestBody;
  try {
    parsed = Body.parse(await request.json());
  } catch (e) {
    log.warn("agent request rejected", {
      route: "POST /api/agent",
      status: 400,
      reason: "invalid body",
      owner: identity.email,
      err: String(e),
    });
    return fail("invalid_request", { detail: "body" });
  }

  if (parsed.sessionId && !isOwnedBy(getDb(), parsed.sessionId, identity.email)) {
    log.warn("agent request rejected", {
      route: "POST /api/agent",
      status: 403,
      reason: "ownership mismatch",
      owner: identity.email,
      sessionId: parsed.sessionId,
    });
    return fail("not_cleared");
  }

  const resumingForConnectors =
    parsed.connectors && parsed.sessionId ? await isLiveSession(parsed.sessionId, identity.email) : false;
  const connectorRefusal = parsed.connectors
    ? refusePendingConnectors(parsed.connectors, resumingForConnectors, resolveClearanceForEmail(identity.email))
    : null;
  if (connectorRefusal) {
    log.warn("agent request rejected", { route: "POST /api/agent", status: 400, reason: connectorRefusal, owner: identity.email });
    return fail("invalid_request", { detail: "connectors" });
  }

  // Spec 2026-08-27: resolve the doc-copilot binding before chips or session.
  // A refused binding (flag off, unknown doc, below comment tier) is one
  // uniform 404; a resume whose STORED binding names a different doc is a 400
  // (the client is confused, not the user). A resume without `docId` whose
  // thread was bound re-derives the binding server-side, so a copilot thread
  // opened from /chat/[id] keeps its tools, with the flag re-checked inside
  // `resolveDocBinding`.
  let docBinding: DocBinding | null = null;
  if (parsed.docId) {
    docBinding = resolveDocBinding(getDb(), parsed.docId, identity.email);
    if (!docBinding) {
      log.warn("agent request rejected", {
        route: "POST /api/agent",
        status: 404,
        reason: "doc binding refused",
        owner: identity.email,
      });
      return fail("not_found");
    }
    if (parsed.sessionId) {
      const bound = docForThread(getDb(), parsed.sessionId);
      if (bound && bound.docId !== parsed.docId) {
        return fail("invalid_request", { detail: "docId" });
      }
    }
  } else if (parsed.sessionId && isDocCopilotEnabled()) {
    // Flag-off skips the lookup entirely, keeping the byte-path identical.
    const bound = docForThread(getDb(), parsed.sessionId);
    if (bound) docBinding = resolveDocBinding(getDb(), bound.docId, identity.email);
  }

  const chipResult = resolveChips(parsed, identity.email);
  if (!chipResult.ok) return chipResult.response;
  const resolvedChips = chipResult.chips;

  let attachments: AttachmentContext[] = [];
  if (isAttachmentsEnabled() && parsed.sessionId) {
    try {
      attachments = listAttachments(identity.email, parsed.sessionId);
    } catch (e) {
      log.warn("attachment grounding skipped", {
        route: "POST /api/agent",
        owner: identity.email,
        sessionId: parsed.sessionId,
        err: String(e),
      });
      attachments = [];
    }
  }

  let contextBlock: string | undefined;
  if (resolvedChips.length > 0 || attachments.length > 0) {
    contextBlock =
      attachments.length > 0
        ? renderContextBlock(resolvedChips, attachments)
        : renderContextBlock(resolvedChips);
  }

  const appliedChoice = appliedModelChoice(parsed, identity.email);

  const oauthBearer = await resolveOauthBearerForRequest(identity.email, parsed.sessionId, parsed.connectors);
  const session = parsed.sessionId
    ? await resumeOrGetSession(parsed.sessionId, identity.email, identity.name, docBinding, oauthBearer, { modelChoice: appliedChoice, adoptSessionId: parsed.sessionId, pendingConnectorSlugs: parsed.connectors })
    : createFreshSession(identity.email, identity.name, docBinding, parsed.connectors, oauthBearer, appliedChoice);
  const persistPendingConnectors: (threadId: string) => void = parsed.connectors?.length ? makePendingPersister(getDb(), parsed.connectors) : () => {};
  const persistModelChoice: (threadId: string) => void = appliedChoice
    ? (threadId) => {
        try {
          setThreadModelChoice(getDb(), threadId, identity.email, {
            ...(appliedChoice.model ? { model: appliedChoice.model } : {}),
            ...(appliedChoice.effort ? { effort: appliedChoice.effort } : {}),
          });
        } catch (e) {
          log.warn("model choice persist failed", { route: "POST /api/agent", owner: identity.email, threadId, err: String(e) });
        }
      }
    : () => {};

  const distinctId = analyticsIdFor(identity.email);

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      const write = (event: AgentEvent) => {
        if (closed) return;
        controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
      };
      const finish = () => {
        if (closed) return;
        closed = true;
        unsubscribe();
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };

      const unsubscribe = session.subscribe((event) => {
        write(event);
        if (event.type === "session") {
          persistPendingConnectors(event.sessionId);
          persistModelChoice(event.sessionId);
        }
        // A turn ends on its result; a fatal stream error also ends it.
        if (event.type === "turn_result") {
          captureServerEvent("agent_turn_completed", {
            distinctId,
            properties: {
              ok: event.ok,
              costUsd: event.costUsd,
              durationMs: event.durationMs,
              ...(event.error ? { error: event.error } : {}),
            },
          });
        }
        if (event.type === "error") {
          captureServerEvent("agent_turn_completed", {
            distinctId,
            properties: { ok: false, error: event.message },
          });
        }
        if (event.type === "turn_result" || event.type === "error") finish();
      });

      // Detach (but keep the session warm) if the browser disconnects.
      request.signal.addEventListener("abort", () => {
        if (!closed) {
          closed = true;
          unsubscribe();
          try {
            controller.close();
          } catch {
            /* already closed */
          }
        }
      });

      if (session.sdkId) write({ type: "session", sessionId: session.sdkId });
      session.send(parsed.message, contextBlock);
    },
  });

  captureServerEvent("chat_message_sent", {
    distinctId,
    properties: {
      resumed: Boolean(parsed.sessionId),
      messageLength: parsed.message.length,
      contextChipCount: parsed.context?.length ?? 0,
    },
  });

  log.info("agent turn started", {
    route: "POST /api/agent",
    owner: identity.email,
    sessionId: session.sdkId,
    resumed: Boolean(parsed.sessionId),
    messageLength: parsed.message.length,
    hasContext: Boolean(parsed.context?.length),
    contextChipCount: parsed.context?.length ?? 0,
    model: appliedChoice?.model,
    effort: appliedChoice?.effort,
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
