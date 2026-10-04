import { isFlagEnabled } from "@/lib/config/flags";
import { authorizationServerConfig } from "./server-config";

/**
 * Whether this deployment serves the MCP surface (specs 2026-09-04 and
 * 2026-09-05).
 *
 * One flag for one endpoint. It replaced ADMIN_KB_MCP_ENABLED,
 * MCP_OAUTH_ENABLED and SHARED_DOC_MCP_ENABLED, which described the same
 * endpoint three times and had to be kept in step by hand. What those three
 * really encoded was per-feature dependencies, and those moved to where they
 * belong: each domain's tools now register only when that domain's own flag is
 * on, so turning a feature off turns its tools off.
 */
export function isMcpEnabled(): boolean {
  return isFlagEnabled("MCP_ENABLED");
}

/**
 * Whether the authorization server can answer. The flag is the operator's
 * switch; the configuration check means a deployment that has not set
 * MCP_PUBLIC_ORIGIN advertises nothing rather than advertising endpoints that
 * resolve nowhere. Not a flag, because it never was one: it is configuration,
 * and configuration that does not parse must read as unconfigured.
 */
export function isMcpAuthServerReady(): boolean {
  return isMcpEnabled() && authorizationServerConfig() !== null;
}
