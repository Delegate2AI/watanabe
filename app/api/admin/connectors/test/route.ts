import type { Agent } from "undici";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { z } from "zod";
import { requireIdentity } from "@/lib/auth/identity";
import { can } from "@/lib/authority/roles";
import { interpolate } from "@/lib/config/interpolate";
import { isConnectorsEnabled } from "@/lib/connectors/config";
import { checkEgressUrl } from "@/lib/connectors/egress";
import { createPinnedDispatcher } from "@/lib/connectors/egress-dispatcher";
import { defaultResolve } from "@/lib/connectors/egress-net";
import { loadConnectorRegistry } from "@/lib/connectors/registry";
import type { ConnectorEntry } from "@/lib/connectors/types";
import { fail } from "@/lib/errors/codes";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * One-shot MCP initialize + tools/list handshake against a registered
 * `http`/`sse` connector, so an admin can tell a wrong URL or an unset token
 * from a working entry without opening a chat (spec 33).
 *
 * `stdio` is refused by design: spawning an arbitrary process from an admin
 * click is a worse risk than the missing feature, and stdio entries surface
 * their failures at session start instead.
 */
const bodySchema = z.object({ slug: z.string().min(1) }).strict();

const TIMEOUT_MS = 5_000;

type ProbeResult = { ok: true; toolCount: number } | { ok: false; error: string };

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function probe(entry: ConnectorEntry): Promise<ProbeResult> {
  if (entry.transport === "stdio") {
    return { ok: false, error: "stdio connectors are not testable from the admin UI" };
  }

  let url: URL;
  let headers: Record<string, string> | undefined;
  try {
    // Interpolation resolves `${VAR}` here and nowhere else in this file. An
    // unset variable throws a ConfigError naming the variable, never its value.
    // Both fields come off the SAME interpolated copy: reading the url off the
    // raw entry probed a different string than the one it validated.
    const resolved = interpolate(entry);
    headers = resolved.headers;
    const checked = await checkEgressUrl(resolved.url!);
    if (!checked.ok) return { ok: false, error: checked.reason };
    url = checked.url;
  } catch (error) {
    return { ok: false, error: message(error) };
  }

  const pinnedDispatcher = createPinnedDispatcher(defaultResolve);
  const pinnedFetch = (input: string | URL, init?: RequestInit): Promise<Response> =>
    fetch(input, { ...(init ?? {}), dispatcher: pinnedDispatcher } as RequestInit & { dispatcher: Agent });

  const options = { fetch: pinnedFetch, ...(headers ? { requestInit: { headers } } : {}) };
  const transport = entry.transport === "http"
    ? new StreamableHTTPClientTransport(url, options)
    : new SSEClientTransport(url, options);
  const client = new Client({ name: "watanabe", version: "0.1.0" });

  // One deadline for the whole probe, raced against it rather than only handed
  // to the SDK. `Client.connect(transport, { signal })` applies the signal to
  // the initialize request, which runs AFTER `transport.start()` has resolved,
  // and `SSEClientTransport.start()` resolves only when the server emits its
  // endpoint event, with no timeout of its own. A slow-loris host that returns
  // 200 text/event-stream and then writes nothing would otherwise leave this
  // route pending forever, so the `finally` below never runs and every admin
  // click leaks another open socket.
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error(`connection test timed out after ${TIMEOUT_MS}ms`));
    }, TIMEOUT_MS);
  });

  try {
    const signal = controller.signal;
    await Promise.race([client.connect(transport, { signal }), expired]);
    const { tools } = await Promise.race([client.listTools(undefined, { signal }), expired]);
    return { ok: true, toolCount: tools.length };
  } catch (error) {
    return { ok: false, error: message(error) };
  } finally {
    clearTimeout(timer);
    await transport.close().catch(() => {});
    await pinnedDispatcher.close().catch(() => {});
  }
}

export async function POST(request: Request): Promise<Response> {
  const auth = await requireIdentity(request.headers);
  if ("response" in auth) return auth.response;
  if (!isConnectorsEnabled()) return fail("not_found");
  if (!can(auth.identity.email, "manageAccess")) return fail("needs_role");

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return fail("invalid_request", { detail: "body" });
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) return fail("invalid_request", { detail: "body" });

  // Only a healthy entry is testable: a rejected one has no url to reach.
  const entry = loadConnectorRegistry().entries.find((candidate) => candidate.slug === parsed.data.slug);
  if (!entry) return fail("not_found");

  return Response.json(await probe(entry));
}
