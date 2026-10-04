import { isFlagEnabled } from "@/lib/config/flags";

export function isMeetingsEnabled(): boolean {
  return isFlagEnabled("MEETINGS_ENABLED");
}

/**
 * Optional case-insensitive substring the poller requires in a meeting NAME
 * before ingesting it (e.g. MEETINGS_NAME_FILTER=atlas on a deployment that
 * must only watch its own meetings). Null means ingest every meeting.
 */
export function meetingNameFilter(): string | null {
  const raw = process.env.MEETINGS_NAME_FILTER?.trim();
  return raw ? raw : null;
}

/**
 * Gates the Circleback webhook receiver. Separate from MEETINGS_ENABLED because
 * it opens an externally reachable, identity-less route: the poll can stay on
 * without ever exposing one.
 */
export function isMeetingsWebhookEnabled(): boolean {
  return isFlagEnabled("MEETINGS_WEBHOOK_ENABLED");
}

/**
 * The `whsec_`-prefixed signing secret shown on the Circleback automation.
 * Null means unset, and the receiver refuses every delivery rather than
 * accepting unsigned ones: an ingestion route that trusts its caller would let
 * anyone who finds the URL write into the knowledge base.
 */
export function circlebackWebhookSecret(): string | null {
  const raw = process.env.CIRCLEBACK_WEBHOOK_SECRET?.trim();
  return raw ? raw : null;
}
