/**
 * Auth resolution for the embedded KB chat agent.
 *
 * Running LOCALLY, the agent can ride the developer's existing Claude Code
 * subscription (the Keychain / `~/.claude` OAuth login). By default we achieve
 * that by NOT setting any auth env var locally, so the Agent SDK subprocess
 * inherits the ambient login. That default is implicit and fragile: a stray
 * `ANTHROPIC_API_KEY` in the developer's shell would be inherited too and
 * silently redirect the agent to metered API billing with no signal.
 *
 * Setting `AGENT_AUTH_MODE=claude-code` makes the intent explicit and robust:
 * the subprocess still inherits the ambient env (so it can reach the Keychain),
 * but the metered/credential vars are scrubbed first, so it can only ever
 * authenticate off the subscription login. See `resolveAgentEnv`.
 *
 * A remote/containerized deploy has no local login, so it must inject its own
 * credential via env. In production this portal runs on `ANTHROPIC_API_KEY`
 * alone (no interactive login inside a container).
 */

/** The resolved credential path, for surfacing (never the credential value). */
export type AgentAuthMode = "claude-code" | "local" | "remote-oauth" | "remote-api-key";

/** True when explicit local-subscription mode is requested. */
function isExplicitLocalMode(): boolean {
  return process.env.AGENT_AUTH_MODE?.trim() === "claude-code";
}

/**
 * Credential env vars that would let a subprocess authenticate off something
 * other than the local Claude Code subscription login. In explicit local mode
 * these are deleted from the inherited env so the subscription is the only
 * credential the subprocess can use. `CLAUDE_CODE_OAUTH_TOKEN` is intentionally
 * NOT here: it is itself a subscription (non-metered) credential, so scrubbing
 * it would not serve the "never silently meter" goal.
 */
const METERED_CREDENTIAL_VARS: readonly string[] = [
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_AUTH_TOKEN",
  "AGENT_CHAT_API_KEY",
  "AGENT_CHAT_OAUTH_TOKEN",
  "AGENT_CHAT_REMOTE",
];

/** True when this instance is a remote deploy that must supply its own credential. */
export function isRemoteDeploy(): boolean {
  return (
    process.env.AGENT_CHAT_REMOTE === "1" ||
    !!process.env.AGENT_CHAT_OAUTH_TOKEN ||
    !!process.env.AGENT_CHAT_API_KEY
  );
}

/**
 * The resolved credential path as a non-secret label. Derived from the same env
 * inputs `resolveAgentEnv()` uses so the two can never disagree. Safe to expose
 * on `/api/ready` and in logs (it is a mode name, never a token/key/path).
 */
export function agentAuthMode(): AgentAuthMode {
  if (isExplicitLocalMode()) return "claude-code";
  if (!isRemoteDeploy()) return "local";
  return process.env.AGENT_CHAT_OAUTH_TOKEN ? "remote-oauth" : "remote-api-key";
}

/**
 * Env vars the CLI subprocess's own runtime needs to function at all — an
 * EXHAUSTIVE allowlist, not a generic "these are probably safe" list.
 * Anything not listed here is simply absent from the subprocess's env, which
 * matters once the subprocess has any shell access (see lib/agent/bash-policy.ts):
 * a scoped `env`/`printenv` call inside it sees only these, never
 * REPO_WRITE_TOKEN, REPO_READ_TOKEN, PORTAL_DB_PATH, or the portal's own
 * AGENT_CHAT_* credential env vars (only their MAPPED CLAUDE_CODE_OAUTH_TOKEN/
 * ANTHROPIC_API_KEY form is layered in below, never the source var itself).
 */
const SUBPROCESS_ENV_ALLOWLIST: readonly string[] = [
  "PATH",
  "HOME",
  "TMPDIR",
  "TZ",
  "LANG",
  "LC_ALL",
  "CLAUDE_CONFIG_DIR",
  "NODE_ENV",
];

function scrubbedEnv(): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const key of SUBPROCESS_ENV_ALLOWLIST) {
    if (process.env[key] !== undefined) out[key] = process.env[key];
  }
  return out;
}

/**
 * The env to hand the Agent SDK subprocess.
 *
 * - Local  → `undefined`: the subprocess inherits `process.env` untouched and
 *   authenticates off the local Claude Code subscription login. NOT scrubbed
 *   — a developer's own shell env isn't the multi-tenant container this
 *   allowlist protects, and scrubbing it would just break local iteration.
 * - Remote → an ALLOWLISTED env only (the SDK REPLACES env entirely when this
 *   option is set — see SUBPROCESS_ENV_ALLOWLIST above), with the mapped
 *   credential (subscription OAuth token preferred over a metered API key)
 *   layered on top.
 */
export function resolveAgentEnv(): Record<string, string | undefined> | undefined {
  // Explicit local mode wins over every remote signal: inherit the full ambient
  // env (so the subprocess can reach the Keychain login) but delete the metered
  // credential vars, so the subscription is the only credential it can use.
  if (isExplicitLocalMode()) {
    const env: Record<string, string | undefined> = { ...process.env };
    for (const key of METERED_CREDENTIAL_VARS) delete env[key];
    return env;
  }

  if (!isRemoteDeploy()) return undefined;

  const base = scrubbedEnv();
  const oauth = process.env.AGENT_CHAT_OAUTH_TOKEN?.trim();
  if (oauth) {
    return { ...base, CLAUDE_CODE_OAUTH_TOKEN: oauth };
  }
  const apiKey = process.env.AGENT_CHAT_API_KEY?.trim();
  if (apiKey) {
    return { ...base, ANTHROPIC_API_KEY: apiKey };
  }
  throw new Error(
    "Remote agent-chat deploy requires AGENT_CHAT_OAUTH_TOKEN (preferred) or AGENT_CHAT_API_KEY.",
  );
}

/** Human-readable description of the active auth mode, for the UI status line. */
export function authModeLabel(): string {
  if (isExplicitLocalMode()) return "local Claude Code subscription (explicit)";
  if (!isRemoteDeploy()) return "local Claude Code subscription";
  return process.env.AGENT_CHAT_OAUTH_TOKEN ? "remote OAuth token" : "remote API key";
}
