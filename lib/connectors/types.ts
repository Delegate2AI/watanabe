import { z } from "zod";

export const CONNECTOR_ICONS = [
  "plug",
  "chart",
  "chat",
  "calendar",
  "doc",
  "code",
  "cloud",
  "search",
] as const;

export type ConnectorIcon = (typeof CONNECTOR_ICONS)[number];

/** Reserved internal MCP server prefixes: an external connector can never shadow one. */
export const RESERVED_CONNECTOR_SLUGS: ReadonlySet<string> = new Set([
  "kb",
  "mem",
  "doc",
  "tasks",
  "copilot",
  "content",
]);

export const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,31}$/;

/**
 * Fields a `${VAR}` reference is REFUSED in, and the one rule that decides it.
 *
 * Spec 33 documents `${VAR}` for secrets, and a secret belongs in a header or an
 * environment variable, not in a URL or a process argument list (both of which
 * are visible in logs and in `ps` output). So rather than interpolating url,
 * command, and args, this refuses them outright at parse and write time, which
 * is also what makes `connectorEnvVars`'s headers-and-env-only scan honest: a
 * variable it cannot see is a variable that cannot be written.
 *
 * `$${VAR}` is the documented escape for a literal, and it contains `${` too, so
 * it is refused here as well. A URL that genuinely needs those two characters is
 * a case nobody has, and refusing it is recoverable where a silently literal
 * placeholder is not.
 */
const ENV_REF_MARKER = "${";

function hasEnvRef(value: string | undefined): boolean {
  return value !== undefined && value.includes(ENV_REF_MARKER);
}

const EXACT_ENV_REF_RE = /^\$\{[^}]+\}$/;

function isExactEnvRef(value: string): boolean {
  return EXACT_ENV_REF_RE.test(value);
}

function isExactHttpsOrigin(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.origin === value;
  } catch {
    return false;
  }
}

function hasAuthorizationHeader(headers: Record<string, string> | undefined): boolean {
  return Object.keys(headers ?? {}).some((key) => key.toLowerCase() === "authorization");
}

/**
 * Per-connector schema. Secrets stay as literal `${VAR}` references here:
 * interpolation happens at session-build time (lib/config/interpolate.ts),
 * never at parse time, so the parsed registry held in memory never contains a
 * secret value.
 */
export const EntrySchema = z
  .object({
    title: z.string().min(1),
    transport: z.enum(["http", "sse", "stdio"]),
    url: z.string().url().optional(),
    headers: z.record(z.string(), z.string()).optional(),
    command: z.string().min(1).optional(),
    args: z.array(z.string()).optional(),
    env: z.record(z.string(), z.string()).optional(),
    groups: z.array(z.string().min(1)),
    tools: z.array(z.string().min(1)).optional(),
    description: z.string().min(1).max(280).optional(),
    icon: z.enum(CONNECTOR_ICONS).optional(),
    auth: z.literal("oauth").optional(),
    oauthClientId: z.string().min(1).optional(),
    oauthClientSecret: z
      .string()
      .refine(isExactEnvRef, { message: "oauthClientSecret must be exactly one ${VAR} reference" })
      .optional(),
    authOrigins: z
      .array(z.string().refine(isExactHttpsOrigin, { message: "authOrigins entries must be exact https origins" }))
      .optional(),
  })
  .strict()
  .refine(
    (e) => (e.transport === "stdio" ? !!e.command && !e.url : !!e.url && !e.command),
    { message: "http/sse need url; stdio needs command" },
  )
  .refine(
    (e) => !hasEnvRef(e.url) && !hasEnvRef(e.command) && !(e.args ?? []).some(hasEnvRef),
    { message: "${VAR} references are allowed in headers and env only, not in url, command, or args" },
  )
  .refine((e) => e.auth !== "oauth" || e.transport !== "stdio", {
    message: "auth: oauth requires transport to be http or sse",
  })
  .refine((e) => e.auth !== "oauth" || !hasAuthorizationHeader(e.headers), {
    message: "oauth entries may not set an Authorization header",
  })
  .refine((e) => !e.authOrigins || e.auth === "oauth", {
    message: "authOrigins is only valid when auth is oauth",
  });

/** Full `access/connectors.yaml` shape, once every entry validates. */
export const FileSchema = z.object({ connectors: z.record(z.string(), EntrySchema) }).strict();

export type ConnectorEntry = {
  slug: string;
  title: string;
  transport: "http" | "sse" | "stdio";
  url?: string;
  headers?: Record<string, string>;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  groups: string[];
  tools?: string[];
  description?: string;
  icon?: ConnectorIcon;
  auth?: "oauth";
  oauthClientId?: string;
  oauthClientSecret?: string;
  authOrigins?: string[];
};

export type ConnectorRegistry = {
  entries: ConnectorEntry[];
  errors: Array<{ slug: string; reason: string }>;
};

export type OauthBearer = { token: string; url: string };
