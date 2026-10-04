import { isMcpAuthServerReady } from "@/lib/mcp-auth/config";
import { protectedResourceMetadata } from "@/lib/mcp-auth/resource-metadata";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(): Promise<Response> {
  const metadata = isMcpAuthServerReady() ? protectedResourceMetadata() : null;
  if (!metadata) return Response.json({ error: "not found" }, { status: 404 });
  return Response.json(metadata, {
    headers: {
      "cache-control": "public, max-age=300",
      "access-control-allow-origin": "*",
    },
  });
}
