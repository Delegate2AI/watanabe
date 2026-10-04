import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import type { z } from "zod";
import { EmbedSchema, PortalConfigSchema, type PortalConfig } from "./schema";
import { ConfigError, interpolate } from "./interpolate";

/**
 * Load and validate `portal.yaml` (spec 16).
 *
 * Order: discover, parse, interpolate `${VAR}`, validate, apply env overrides,
 * then check the no-auth guard. Interpolation runs before validation so the
 * schema only ever sees resolved values; env overrides run after, so an
 * override never has to satisfy the schema's `${VAR}` shape.
 *
 * `env` and `cwd` are parameters rather than globals so this is testable
 * without mutating `process.env`.
 */

type Env = Record<string, string | undefined>;

/** `PORTAL_CONFIG`, else `./portal.yaml`, else no file (defaults only). */
function discover(env: Env, cwd: string): string | null {
  const override = env.PORTAL_CONFIG?.trim();
  if (override) {
    const resolved = path.resolve(cwd, override);
    // An explicit path that does not exist is a typo, not "use the defaults".
    if (!existsSync(resolved)) {
      throw new ConfigError(`PORTAL_CONFIG points at ${resolved}, which does not exist`);
    }
    return resolved;
  }
  const conventional = path.join(cwd, "portal.yaml");
  return existsSync(conventional) ? conventional : null;
}

function parseDocument(file: string): unknown {
  let raw: string;
  try {
    raw = readFileSync(file, "utf8");
  } catch (err) {
    throw new ConfigError(`${file}: cannot be read (${err instanceof Error ? err.message : String(err)})`);
  }
  try {
    return parseYaml(raw) ?? {};
  } catch (err) {
    // `yaml` puts the line/column in the message; keep it, prepend the path.
    throw new ConfigError(`${file}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * Environment beats YAML beats defaults, so a Helm or `kubectl set env`
 * override still wins over a config file baked into the image.
 *
 * Only the three fields that already have an environment variable are
 * overridable. The rest of `portal.yaml` has no env equivalent by design: it is
 * structured data that never had one.
 *
 * `VAULT_SUBDIR=""` is meaningful (it means "the repo root IS the vault", see
 * lib/repo.ts#resolveVaultRoot), so presence is tested, not truthiness.
 */
function applyEnvOverrides(config: PortalConfig, env: Env): PortalConfig {
  const repoPath = env.LOCAL_REPO_PATH?.trim();
  const vaultSubdir = env.VAULT_SUBDIR;
  const assertSecret = env.PORTAL_PROXY_ASSERT_SECRET?.trim();

  const repo = {
    ...config.repo,
    ...(repoPath ? { path: repoPath } : {}),
    ...(vaultSubdir !== undefined ? { vaultSubdir } : {}),
  };

  const auth =
    config.auth.mode === "proxy-header" && assertSecret
      ? { ...config.auth, proxyHeader: { ...config.auth.proxyHeader, assertSecret } }
      : config.auth;

  return { ...config, repo, auth };
}

/**
 * `auth.mode: none` disables authentication for every request, and with
 * `KB_WRITE_ENABLED=1` makes the knowledge base writable by anyone who can
 * reach the pod.
 *
 * Config alone must not be able to disarm auth: a `portal.yaml` that leaks into
 * a production image is inert without this environment variable. Exact-match on
 * `"1"`, mirroring `PORTAL_ALLOW_DEV_IDENTITY_HEADER`, which is opt-in and
 * deliberately not keyed off `NODE_ENV` so that an unset or misspelled
 * `NODE_ENV` can never silently open a bypass.
 */
function assertNoAuthAllowed(config: PortalConfig, env: Env): void {
  if (config.auth.mode !== "none") return;
  if (env.PORTAL_ALLOW_NO_AUTH === "1") return;
  throw new ConfigError(
    'auth.mode is "none", which disables authentication entirely. ' +
      "Refusing to start without PORTAL_ALLOW_NO_AUTH=1.",
  );
}

/**
 * `auth.mode: oidc` performs the login itself, so it needs two secrets that
 * cannot live in a git-committed `portal.yaml`, and an admission list.
 *
 * All three are checked at boot, together, so an operator sees every missing
 * piece at once instead of discovering them one failed sign-in at a time. An
 * empty admission list is refused outright: a portal that admits every Google
 * account on the internet is never what someone meant to configure.
 */
function assertOidcConfigured(config: PortalConfig, env: Env): void {
  if (config.auth.mode !== "oidc") return;
  const oidc = config.auth.oidc;
  const problems: string[] = [];

  if (!env.PORTAL_OIDC_CLIENT_SECRET?.trim()) {
    problems.push("PORTAL_OIDC_CLIENT_SECRET is unset");
  }
  const sessionSecret = env.PORTAL_SESSION_SECRET?.trim() ?? "";
  if (sessionSecret.length < 32) {
    problems.push("PORTAL_SESSION_SECRET must be set and at least 32 characters");
  }
  if (oidc.provider !== "google" && !oidc.issuer) {
    problems.push(`auth.oidc.issuer is required for provider "${oidc.provider}"`);
  }
  if (oidc.allowedDomains.length === 0 && oidc.allowedEmails.length === 0) {
    problems.push(
      "auth.oidc needs allowedDomains or allowedEmails; refusing to run a portal anyone can sign in to",
    );
  }

  if (problems.length > 0) {
    throw new ConfigError(
      `auth.mode is "oidc" but the deployment is incomplete:\n  ${problems.join("\n  ")}`,
    );
  }
}

/** Render a zod failure as `path: message` lines, so the operator sees WHICH field. */
function describeSchemaError(file: string | null, error: unknown): string {
  const where = file ?? "<defaults>";
  if (error && typeof error === "object" && "issues" in error) {
    const issues = (error as { issues: { path: PropertyKey[]; message: string }[] }).issues;
    const lines = issues.map((i) => `  ${i.path.join(".") || "<root>"}: ${i.message}`).join("\n");
    return `${where}: invalid configuration\n${lines}`;
  }
  return `${where}: invalid configuration`;
}

export function loadConfig(env: Env = process.env, cwd: string = process.cwd()): PortalConfig {
  const file = discover(env, cwd);
  const document = file ? parseDocument(file) : {};

  // Interpolate before validating: the schema should never see a `${VAR}`.
  const resolved = interpolate(document, env);

  const parsed = PortalConfigSchema.safeParse(resolved);
  if (!parsed.success) {
    throw new ConfigError(describeSchemaError(file, parsed.error));
  }

  const config = applyEnvOverrides(parsed.data, env);
  assertNoAuthAllowed(config, env);
  assertOidcConfigured(config, env);
  return config;
}

export function loadEmbedConfig(env: Env = process.env, cwd: string = process.cwd()): z.infer<typeof EmbedSchema> {
  const file = discover(env, cwd);
  const document = file ? parseDocument(file) : {};
  const embed = (document as { embed?: unknown } | null)?.embed;
  const parsed = EmbedSchema.safeParse(interpolate(embed ?? {}, env));
  if (!parsed.success) {
    throw new ConfigError(describeSchemaError(file, parsed.error));
  }
  return parsed.data;
}
