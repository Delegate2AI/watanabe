import { isMcpAuthServerReady } from "@/lib/mcp-auth/config";
import { authorizationServerMetadata } from "@/lib/mcp-auth/server-config";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * RFC 8414 authorization-server metadata (spec 2026-09-05).
 *
 * Public, cacheable and readable cross-origin, because an MCP client fetches it
 * server-to-server with no cookie. That also means it must be carved out of the
 * SSO gate at the edge: a 302 to a sign-in page reads to a client as "this
 * server needs no authorization", and it never starts the flow.
 *
 * A 404 when the feature is off or the deployment is unconfigured, so a half
 * set-up deployment advertises nothing rather than advertising endpoints that
 * answer nowhere.
 */
export async function GET(): Promise<Response> {
  const metadata = isMcpAuthServerReady() ? authorizationServerMetadata() : null;
  if (!metadata) return Response.json({ error: "not found" }, { status: 404 });
  return Response.json(metadata, {
    headers: {
      "cache-control": "public, max-age=300",
      "access-control-allow-origin": "*",
    },
  });
}
