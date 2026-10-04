import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { isRemoteDeploy, resolveAgentEnv, authModeLabel, agentAuthMode } from "./auth";

const ENV_KEYS = [
  "AGENT_AUTH_MODE",
  "AGENT_CHAT_REMOTE",
  "AGENT_CHAT_OAUTH_TOKEN",
  "AGENT_CHAT_API_KEY",
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_AUTH_TOKEN",
  "CLAUDE_CODE_OAUTH_TOKEN",
  "REPO_WRITE_TOKEN",
  "REPO_READ_TOKEN",
  "PORTAL_DB_PATH",
  "KUBERNETES_SERVICE_HOST",
  "PATH",
  "HOME",
  "CLAUDE_CONFIG_DIR",
  "NODE_ENV",
] as const;

let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = {};
  for (const k of ENV_KEYS) saved[k] = process.env[k];
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("isRemoteDeploy", () => {
  it("is false with nothing set", () => {
    delete process.env.AGENT_CHAT_REMOTE;
    delete process.env.AGENT_CHAT_OAUTH_TOKEN;
    delete process.env.AGENT_CHAT_API_KEY;
    expect(isRemoteDeploy()).toBe(false);
  });

  it("is true when AGENT_CHAT_REMOTE=1", () => {
    process.env.AGENT_CHAT_REMOTE = "1";
    expect(isRemoteDeploy()).toBe(true);
  });
});

describe("resolveAgentEnv — local mode", () => {
  it("returns undefined (unscrubbed inherited env) when not a remote deploy", () => {
    delete process.env.AGENT_CHAT_REMOTE;
    delete process.env.AGENT_CHAT_OAUTH_TOKEN;
    delete process.env.AGENT_CHAT_API_KEY;
    expect(resolveAgentEnv()).toBeUndefined();
  });
});

describe("resolveAgentEnv (explicit local Claude Code mode)", () => {
  beforeEach(() => {
    process.env.AGENT_AUTH_MODE = "claude-code";
    process.env.PATH = "/usr/bin";
    process.env.HOME = "/home/dev";
  });

  it("scrubs metered credentials so the subprocess cannot silently bill an API key", () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-stray";
    process.env.ANTHROPIC_AUTH_TOKEN = "stray-auth-token";
    process.env.AGENT_CHAT_API_KEY = "sk-ant-app";
    process.env.AGENT_CHAT_OAUTH_TOKEN = "app-oauth";
    process.env.AGENT_CHAT_REMOTE = "1";
    const env = resolveAgentEnv();
    expect(env).toBeDefined();
    expect(env).not.toHaveProperty("ANTHROPIC_API_KEY");
    expect(env).not.toHaveProperty("ANTHROPIC_AUTH_TOKEN");
    expect(env).not.toHaveProperty("AGENT_CHAT_API_KEY");
    expect(env).not.toHaveProperty("AGENT_CHAT_OAUTH_TOKEN");
    expect(env).not.toHaveProperty("AGENT_CHAT_REMOTE");
  });

  it("keeps the ambient env so the subprocess can reach the Keychain login", () => {
    const env = resolveAgentEnv();
    expect(env?.PATH).toBe("/usr/bin");
    expect(env?.HOME).toBe("/home/dev");
  });

  it("takes precedence over AGENT_CHAT_* remote signals (inherits ambient, does not allowlist-scrub)", () => {
    process.env.AGENT_CHAT_REMOTE = "1";
    process.env.REPO_WRITE_TOKEN = "glpat-super-secret";
    const env = resolveAgentEnv();
    // Local branch inherits the ambient env untouched apart from the metered
    // credential vars, so a non-credential var like REPO_WRITE_TOKEN survives,
    // proof we did NOT take the remote allowlist branch.
    expect(env?.REPO_WRITE_TOKEN).toBe("glpat-super-secret");
    expect(env).not.toHaveProperty("ANTHROPIC_API_KEY");
  });

  it("leaves CLAUDE_CODE_OAUTH_TOKEN in place (subscription, not metered)", () => {
    process.env.CLAUDE_CODE_OAUTH_TOKEN = "sub-oauth-token";
    const env = resolveAgentEnv();
    expect(env?.CLAUDE_CODE_OAUTH_TOKEN).toBe("sub-oauth-token");
  });
});

describe("resolveAgentEnv — remote mode: allowlisting", () => {
  beforeEach(() => {
    process.env.AGENT_CHAT_REMOTE = "1";
    process.env.PATH = "/usr/bin";
    process.env.HOME = "/home/appuser";
    process.env.CLAUDE_CONFIG_DIR = "/data/claude";
    process.env.NODE_ENV = "production";
    // The sensitive vars a scrubbed env must never carry into the subprocess.
    process.env.REPO_WRITE_TOKEN = "glpat-super-secret";
    process.env.REPO_READ_TOKEN = "glpat-also-secret";
    process.env.PORTAL_DB_PATH = "/data/portal.db";
    process.env.KUBERNETES_SERVICE_HOST = "10.0.0.1";
  });

  it("drops REPO_WRITE_TOKEN/REPO_READ_TOKEN/PORTAL_DB_PATH/cluster-topology vars", () => {
    process.env.AGENT_CHAT_API_KEY = "sk-ant-test";
    const env = resolveAgentEnv();
    expect(env).toBeDefined();
    expect(env).not.toHaveProperty("REPO_WRITE_TOKEN");
    expect(env).not.toHaveProperty("REPO_READ_TOKEN");
    expect(env).not.toHaveProperty("PORTAL_DB_PATH");
    expect(env).not.toHaveProperty("KUBERNETES_SERVICE_HOST");
    expect(env).not.toHaveProperty("AGENT_CHAT_API_KEY");
  });

  it("keeps the runtime-plumbing allowlist (PATH/HOME/CLAUDE_CONFIG_DIR)", () => {
    process.env.AGENT_CHAT_API_KEY = "sk-ant-test";
    const env = resolveAgentEnv();
    expect(env?.PATH).toBe("/usr/bin");
    expect(env?.HOME).toBe("/home/appuser");
    expect(env?.CLAUDE_CONFIG_DIR).toBe("/data/claude");
  });

  it("maps AGENT_CHAT_API_KEY to ANTHROPIC_API_KEY, never passing the source var through", () => {
    process.env.AGENT_CHAT_API_KEY = "sk-ant-test";
    const env = resolveAgentEnv();
    expect(env?.ANTHROPIC_API_KEY).toBe("sk-ant-test");
    expect(env).not.toHaveProperty("AGENT_CHAT_API_KEY");
  });

  it("prefers the OAuth token over an API key, mapping it to CLAUDE_CODE_OAUTH_TOKEN", () => {
    process.env.AGENT_CHAT_OAUTH_TOKEN = "oauth-test-token";
    process.env.AGENT_CHAT_API_KEY = "sk-ant-test";
    const env = resolveAgentEnv();
    expect(env?.CLAUDE_CODE_OAUTH_TOKEN).toBe("oauth-test-token");
    expect(env).not.toHaveProperty("ANTHROPIC_API_KEY");
    expect(env).not.toHaveProperty("AGENT_CHAT_OAUTH_TOKEN");
  });

  it("throws when remote with no credential at all", () => {
    delete process.env.AGENT_CHAT_OAUTH_TOKEN;
    delete process.env.AGENT_CHAT_API_KEY;
    expect(() => resolveAgentEnv()).toThrow(/requires AGENT_CHAT_OAUTH_TOKEN/);
  });
});

describe("authModeLabel", () => {
  it("describes local mode", () => {
    delete process.env.AGENT_CHAT_REMOTE;
    delete process.env.AGENT_CHAT_OAUTH_TOKEN;
    delete process.env.AGENT_CHAT_API_KEY;
    expect(authModeLabel()).toBe("local Claude Code subscription");
  });

  it("describes remote OAuth mode", () => {
    process.env.AGENT_CHAT_OAUTH_TOKEN = "oauth-test-token";
    expect(authModeLabel()).toBe("remote OAuth token");
  });

  it("describes remote API-key mode", () => {
    delete process.env.AGENT_CHAT_OAUTH_TOKEN;
    process.env.AGENT_CHAT_API_KEY = "sk-ant-test";
    expect(authModeLabel()).toBe("remote API key");
  });

  it("describes the explicit local Claude Code mode", () => {
    process.env.AGENT_AUTH_MODE = "claude-code";
    expect(authModeLabel()).toBe("local Claude Code subscription (explicit)");
  });
});

describe("agentAuthMode", () => {
  beforeEach(() => {
    delete process.env.AGENT_AUTH_MODE;
    delete process.env.AGENT_CHAT_REMOTE;
    delete process.env.AGENT_CHAT_OAUTH_TOKEN;
    delete process.env.AGENT_CHAT_API_KEY;
  });

  it("is 'claude-code' when explicitly set", () => {
    process.env.AGENT_AUTH_MODE = "claude-code";
    expect(agentAuthMode()).toBe("claude-code");
  });

  it("is 'local' with nothing set", () => {
    expect(agentAuthMode()).toBe("local");
  });

  it("is 'remote-oauth' when a remote OAuth token is present", () => {
    process.env.AGENT_CHAT_OAUTH_TOKEN = "oauth-test-token";
    expect(agentAuthMode()).toBe("remote-oauth");
  });

  it("is 'remote-api-key' when a remote API key is present", () => {
    process.env.AGENT_CHAT_API_KEY = "sk-ant-test";
    expect(agentAuthMode()).toBe("remote-api-key");
  });

  it("prefers the explicit claude-code mode over remote signals", () => {
    process.env.AGENT_AUTH_MODE = "claude-code";
    process.env.AGENT_CHAT_API_KEY = "sk-ant-test";
    expect(agentAuthMode()).toBe("claude-code");
  });
});
