import { isConnectorsEnabled } from "./config";
import { RESERVED_CONNECTOR_SLUGS } from "./types";

/**
 * Spec 33: the permission-gate side of external MCP connectors. Lives here
 * (not inline in `lib/agent/permissions.ts`) because that file is at the
 * repo's 300-line split threshold; the gate itself still calls these from
 * its decision flow, so the security boundary is unchanged.
 */

/** `mcp__<slug>__<tool>` where slug matches the connector slug charset. */
const EXTERNAL_MCP_TOOL_RE = /^mcp__([a-z0-9-]+)__(.+)$/;

/**
 * Split an SDK MCP tool name into its connector slug and tool name. Returns
 * `undefined` for non-MCP names AND for this portal's own internal servers
 * (`kb`/`mem`/`doc`/`tasks`, via `RESERVED_CONNECTOR_SLUGS`), so the gate's
 * dedicated internal branches keep handling those exactly as before.
 */
export function parseExternalMcpTool(
  toolName: string,
): { slug: string; tool: string } | undefined {
  const match = EXTERNAL_MCP_TOOL_RE.exec(toolName);
  if (!match) return undefined;
  const [, slug, tool] = match;
  if (RESERVED_CONNECTOR_SLUGS.has(slug)) return undefined;
  return { slug, tool };
}

/**
 * Deny-by-default decision for an external connector tool. Allowed only when
 * the flag is on (backstop, mirroring the doc/canvas pattern: grants are the
 * primary control, this re-check catches drift), a per-thread allow-map was
 * resolved, and that map grants the slug either `"all"` tools or this one.
 */
export function gateExternalMcpTool(
  external: { slug: string; tool: string },
  connectorAllow?: ReadonlyMap<string, ReadonlySet<string> | "all">,
): "allow" | "deny" {
  if (!isConnectorsEnabled() || !connectorAllow) return "deny";
  const grant = connectorAllow.get(external.slug);
  if (grant === undefined) return "deny";
  return grant === "all" || grant.has(external.tool) ? "allow" : "deny";
}
