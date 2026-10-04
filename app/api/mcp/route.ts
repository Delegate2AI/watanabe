import { randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { mcpUnauthorized } from "@/lib/mcp-auth/resource-metadata";
import { log } from "@/lib/log";
import { resolveCaller, sessionOwnerMatches, workspaceThreadId, type McpCaller } from "./auth";
import { buildServer } from "./server";

/**
 * Reusable, HTTP-exposed MCP surface over the SAME read-only vault tools the
 * in-process `kb` server (`lib/kb-mcp/server.ts`) gives the chat agent —
 * `kb_list` / `kb_read` / `kb_search`, sharing their implementation via
 * `lib/kb-mcp/tools.ts`. This lets OTHER MCP clients (not just this portal's
 * chat UI) consume the vault: point an MCP-Streamable-HTTP-capable client at
 * `POST/GET/DELETE /api/mcp` with an identity header set, same as the other
 * `/api/agent/*` routes.
 *
 * Two credential classes, decided in `./auth`: an SSO cookie gets the three
 * read tools, and a portal-issued admin token also gets the staging tools, each
 * session in its own worktree. Which tools exist is decided at registration
 * time in `./server`, so a caller cannot call one it was never shown.
 *
 * Transport: `@modelcontextprotocol/sdk`'s `WebStandardStreamableHTTPServerTransport`
 * (`server/webStandardStreamableHttp.js`) — the Fetch-API (Request/Response)
 * flavor of Streamable HTTP, as opposed to `StreamableHTTPServerTransport`
 * (Node `http.IncomingMessage`/`ServerResponse`). It's the one that actually
 * fits a Next.js Route Handler's `(req: Request) => Response` shape with no
 * adapter layer.
 *
 * Residual tension vs. a fully stateless request/response model: the MCP
 * Streamable HTTP protocol still expects a stateful handshake — a client
 * calls `initialize` once, gets an `Mcp-Session-Id` back, and must send that
 * same header on every later call in the SAME logical session (tool list,
 * tool calls, etc.) for the server to recognize it. A brand-new
 * `McpServer`/`transport` pair per HTTP request (truly stateless) can't
 * satisfy that — the second request would find no memory of the first. This
 * route instead keeps a small in-process map of `Mcp-Session-Id → {server,
 * transport}` (mirroring the pattern `lib/agent/session.ts` already uses for
 * warm chat sessions) so a real multi-request MCP session works across
 * separate HTTP requests, which is only sound because this app runs as a
 * long-lived Node process (see `Dockerfile` / `next start`) rather than a
 * one-shot serverless function — on a platform that recycles the process
 * between requests (Vercel-style edge/lambda), this in-memory map would not
 * survive and every request would need to renegotiate a session (i.e. true
 * stateless mode, `sessionIdGenerator: undefined`, one request = one
 * complete JSON-RPC exchange, no session reuse). If this route ever needs to
 * run on such a platform, switch to stateless mode and require full
 * request/response completion per HTTP call.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const SESSION_HEADER = "mcp-session-id";

interface McpHttpSession {
  server: McpServer;
  transport: WebStandardStreamableHTTPServerTransport;
  /** Who opened it. A session carries that person's vault projection. */
  ownerEmail: string;
  /**
   * Which credential opened it, so another cannot resume it. Null for a cookie
   * caller. This also carries the credential-class distinction the old
   * `privileged` field duplicated: it was true exactly when this was non-null.
   */
  workspaceKey: string | null;
  /** The workspace it stages into, keyed by `workspaceThreadId`. */
  threadId: string;
}

// Pinned to globalThis for the same reason `lib/agent/session.ts` pins its
// warm-session map there: Next.js can bundle each exported handler
// separately, and a plain module-level `const` would give GET/POST/DELETE on
// this same route file potentially-different maps under some bundler
// configurations, and would not survive dev-mode HMR either. One global map
// avoids both.
const g = globalThis as unknown as { __kbMcpHttpSessions?: Map<string, McpHttpSession> };
const httpSessions: Map<string, McpHttpSession> = (g.__kbMcpHttpSessions ??= new Map());

/**
 * Resolve the `McpHttpSession` this request belongs to.
 *
 *  - No `Mcp-Session-Id` header → this must be an `initialize` call (or a
 *    client not doing session reuse at all). Build a fresh server + transport
 *    with a real `sessionIdGenerator`; `onsessioninitialized` records it in
 *    `httpSessions` once the handshake completes, and `onsessionclosed`
 *    (on an explicit `DELETE`) tears it back down.
 *  - Header present and known → reuse that session's transport, so
 *    `Mcp-Session-Id`-carrying follow-up requests (tool list, tool calls) hit
 *    the SAME `McpServer`/transport pair that handled the original
 *    `initialize`.
 *  - Header present but unknown (stale id, restarted process, wrong id) →
 *    hand back a fresh, unconnected transport. Its own session validation
 *    (`this.sessionId` is `undefined` until an `initialize` completes on it)
 *    rejects the mismatched header itself — see
 *    `WebStandardStreamableHTTPServerTransport`'s `validateSession` — so this
 *    route doesn't need to duplicate that logic; it just avoids minting a
 *    NEW session under an id the client already believes is established.
 *
 * IMPORTANT: `McpServer#connect` throws ("Already connected to a transport")
 * if called twice on the same instance (see `Protocol#connect` in the MCP
 * SDK) — so this only connects a BRAND NEW server/transport pair, exactly
 * once, right here. A reused session's pair was already connected the first
 * time it was built and must not be reconnected.
 */
async function getOrCreateSession(
  sessionIdHeader: string | null,
  caller: McpCaller,
): Promise<McpHttpSession | null> {
  const { ownerEmail } = caller;
  if (sessionIdHeader) {
    const existing = httpSessions.get(sessionIdHeader);
    // A known id belonging to someone else is refused rather than served or
    // re-minted: re-minting would let a caller squat on another's id. A session
    // opened without a token cannot be resumed with one, or the tool set a
    // session was built with would no longer match the credential using it.
    // The credential is part of the match, not just the person: two tokens held
    // by the same admin stage into two workspaces, and without this the second
    // could present the first's session id and inherit the first's.
    if (existing) {
      const same = sessionOwnerMatches(existing.ownerEmail, ownerEmail)
        && existing.workspaceKey === caller.workspaceKey;
      return same ? existing : null;
    }
  }

  // Minted here rather than inside the transport because the write tools need
  // the thread id at registration time.
  const sessionId = randomUUID();
  const threadId = workspaceThreadId(caller, sessionId);
  const server = buildServer(ownerEmail, caller.workspaceKey ? { threadId } : undefined);
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: () => sessionId,
    onsessioninitialized: (id) => {
      httpSessions.set(id, { server, transport, ownerEmail, workspaceKey: caller.workspaceKey, threadId });
      log.info("mcp http session initialized", { sessionId: id });
    },
    onsessionclosed: (id) => {
      httpSessions.delete(id);
      log.info("mcp http session closed", { sessionId: id });
      void server.close().catch(() => {});
      // The worktree deliberately outlives the connection: see the thread-id
      // note above. `kb_discard` and a successful `kb_submit` remove it.
    },
  });
  await server.connect(transport);
  return { server, transport, ownerEmail, workspaceKey: caller.workspaceKey, threadId };
}

async function handle(request: Request): Promise<Response> {
  const caller = await resolveCaller(request.headers);
  if (!caller) {
    log.warn("mcp request rejected", { route: request.method + " /api/mcp", status: 401, reason: "unauthorized" });
    return mcpUnauthorized();
  }

  const session = await getOrCreateSession(request.headers.get(SESSION_HEADER), caller);
  if (!session) {
    log.warn("mcp request rejected", { route: request.method + " /api/mcp", status: 401, reason: "session_owner" });
    // The same 401 an unauthenticated request gets, so a caller cannot use the
    // response to learn that the id they guessed belongs to somebody.
    return mcpUnauthorized();
  }
  return session.transport.handleRequest(request);
}

export async function POST(request: Request): Promise<Response> {
  return handle(request);
}

export async function GET(request: Request): Promise<Response> {
  return handle(request);
}

export async function DELETE(request: Request): Promise<Response> {
  return handle(request);
}
