import path from "node:path";
import { isFlagEnabled } from "@/lib/config/flags";
import { memoryWorktreeDir } from "@/lib/memory/config";

/**
 * Spec 33 external MCP connectors. Off by default; flag-off leaves every
 * existing byte-path identical (no connector server is ever merged into a
 * session's mcpServers, no permission gate branch is reachable).
 */
export function isConnectorsEnabled(): boolean {
  return isFlagEnabled("CONNECTORS_ENABLED");
}

export function isConnectorOauthEnabled(): boolean {
  return isConnectorsEnabled() && isFlagEnabled("CONNECTOR_OAUTH_ENABLED");
}

/** Sibling of flags.yaml / groups.yaml / roles.yaml in the memory worktree's access/ dir. */
export function connectorsFilePath(): string {
  return path.join(memoryWorktreeDir(), "access", "connectors.yaml");
}
