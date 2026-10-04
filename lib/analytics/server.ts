import { PostHog } from "posthog-node";
import { isAnalyticsEnabled, posthogHost, posthogKey } from "./config";

/**
 * Server-side half of the analytics wiring: product events the browser cannot
 * observe, and the exceptions that never reach a browser at all.
 *
 * Never throws. Every entry point swallows its own failure, so a PostHog outage
 * degrades to missing telemetry rather than a failed request, and the error
 * sink below can be safely called from `log.error` on any code path.
 */

let client: PostHog | null = null;

function getClient(): PostHog | null {
  if (!isAnalyticsEnabled()) return null;
  if (client) return client;
  const key = posthogKey();
  const host = posthogHost();
  if (!key || !host) return null;
  try {
    client = new PostHog(key, {
      host,
      // The pods are long-lived, so the default batching applies; a small batch
      // keeps a low-traffic deploy from sitting on events for minutes.
      flushAt: 5,
      flushInterval: 10_000,
      // Exception autocapture would install process-wide `uncaughtException`
      // handlers. Next owns those; `onRequestError` and the log sink are the
      // paths we want.
      enableExceptionAutocapture: false,
    });
  } catch {
    return null;
  }
  return client;
}

/**
 * Marks server-sent events so they never read as browser traffic in a query.
 * Not `$lib`: posthog-node overwrites that with its own name on the way out.
 */
const SERVER_LIB = { service: "watanabe-server" };

const EMAIL_RE = /[^\s<>"'`,;:()[\]]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

/**
 * Takes addresses out of anything on its way to PostHog.
 *
 * People are identified there by the hash `analyticsIdFor` produces, and the
 * instance holds no staff directory. Server properties are the one path that
 * could undo that by accident: `log.error` calls already carry fields like
 * `owner: identity.email`, and an error string can name whoever it failed on.
 * Scrubbing at this boundary means no caller has to remember.
 */
function scrub(value: unknown, depth = 0): unknown {
  if (typeof value === "string") return value.replace(EMAIL_RE, "<email>");
  if (depth >= 3 || value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((item) => scrub(item, depth + 1));
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, scrub(v, depth + 1)]),
  );
}

function withScrubbed(given: Record<string, unknown> | undefined): Record<string, unknown> {
  return { ...(scrub(given ?? {}) as Record<string, unknown>), ...SERVER_LIB };
}

/** The distinct id used when a failure cannot be attributed to a person. */
const NO_PERSON = "server";

/** Long enough to identify the throw site, short enough not to bloat an event. */
const STACK_LIMIT = 2000;

/**
 * A copy of the thrown value with addresses taken out of its message and stack.
 *
 * `captureException` builds `$exception_list` from the Error itself, so the
 * scrubbing that `withScrubbed` does for properties never reaches it. The stack
 * is still parsed frame by frame downstream, which survives this: the pattern
 * only rewrites addresses, and a stack frame has none.
 */
function scrubbedError(error: unknown): Error {
  const thrown = error instanceof Error ? error : new Error(String(error));
  const clean = new Error(String(scrub(thrown.message)));
  clean.name = thrown.name;
  clean.stack = thrown.stack ? String(scrub(thrown.stack)).slice(0, STACK_LIMIT) : undefined;
  return clean;
}

export type ServerEvent = {
  distinctId: string;
  properties?: Record<string, unknown>;
};

export function captureServerEvent(event: string, { distinctId, properties }: ServerEvent): void {
  const posthog = getClient();
  if (!posthog) return;
  try {
    posthog.capture({ distinctId, event, properties: withScrubbed(properties) });
  } catch {
    // Telemetry never breaks the path it observes.
  }
}

/**
 * Reports a failure as PostHog's own `$exception`, so it lands in Error
 * tracking with its stack parsed and grouped into an issue rather than as a
 * loose event someone has to build an insight over.
 */
export function captureServerException(
  error: unknown,
  { distinctId, properties }: Partial<ServerEvent> = {},
): void {
  const posthog = getClient();
  if (!posthog) return;
  try {
    posthog.captureException(scrubbedError(error), distinctId ?? NO_PERSON, withScrubbed(properties));
  } catch {
    // As above.
  }
}

/** Drains the queue on shutdown, so a rolling pod does not drop its last batch. */
export async function flushAnalytics(): Promise<void> {
  if (!client) return;
  try {
    await client.shutdown();
  } catch {
    // As above.
  } finally {
    client = null;
  }
}
