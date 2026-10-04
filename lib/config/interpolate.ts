/**
 * `${VAR}` resolution for `portal.yaml` (spec 16).
 *
 * Runs after YAML parsing and before schema validation, so the schema only
 * ever sees resolved values and never has to special-case a placeholder.
 *
 * Secrets are the whole reason this exists: the config file is the kind of
 * thing that gets committed, so a signing key or deploy token is written
 * `${PORTAL_JWT_SECRET}` and supplied by the environment, matching the
 * `secret:NAME` indirection the Helm charts already use.
 */

/** A boot-time configuration failure. Always names the offending config path. */
export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

/**
 * `$${VAR}` escapes to a literal `${VAR}`. Matched first, and its replacement
 * is written straight to the output, so an escaped placeholder can never be
 * re-examined as a real one.
 */
const TOKEN = /\$\$\{([^}]*)\}|\$\{([^}]*)\}/g;

/**
 * The one rule for whether a reference resolves. An empty string is
 * indistinguishable from unset for a secret, and booting with `secret: ""` is
 * worse than refusing to boot at all.
 */
function unset(resolved: string | undefined): boolean {
  return resolved === undefined || resolved === "";
}

/**
 * Every `${VAR}` name a string references, in order, skipping `$${VAR}`
 * escapes (which are rendered literally and never looked up).
 *
 * Exported so a surface that REPORTS on references, rather than resolving
 * them, reads the same token shape this module substitutes on. A second regex
 * elsewhere drifts: `[A-Z0-9_]+` would silently miss `${circleback_token}`,
 * which is interpolated here just fine.
 */
export function envRefNames(value: string): string[] {
  const names: string[] = [];
  for (const [, escaped, name] of value.matchAll(TOKEN)) {
    if (escaped === undefined && name !== undefined) names.push(name);
  }
  return names;
}

/**
 * Whether interpolation would actually substitute `name`, as opposed to
 * throwing. Shares `unset` with the substitution path, so a reporting surface
 * cannot disagree with what a session build will do.
 */
export function resolvesEnvRef(
  name: string,
  env: Record<string, string | undefined> = process.env,
): boolean {
  return !unset(env[name]);
}

/**
 * Substitution is SINGLE-PASS by construction: we build the result from the
 * regex match stream rather than re-scanning it. A variable whose value itself
 * contains `${...}` therefore yields that text literally instead of triggering
 * a second lookup, which would be a config-injection primitive (an attacker who
 * can set one env var could dereference another).
 */
function interpolateString(value: string, env: Record<string, string | undefined>, path: string): string {
  return value.replace(TOKEN, (_match, escaped: string | undefined, name: string | undefined) => {
    if (escaped !== undefined) return `\${${escaped}}`;
    const resolved = env[name as string];
    if (unset(resolved)) {
      throw new ConfigError(
        `portal.yaml: ${path} references \${${name}}, which is not set in the environment`,
      );
    }
    return resolved as string;
  });
}

/** Path segment joiner that renders array indices as `list[1]`, not `list.1`. */
function child(path: string, key: string | number): string {
  if (typeof key === "number") return `${path}[${key}]`;
  return path ? `${path}.${key}` : key;
}

/**
 * Walk any parsed-YAML value, substituting into every string. Non-string
 * scalars (numbers, booleans, null) pass through untouched, since a YAML
 * `true` is already the value the schema wants.
 */
export function interpolate<T>(value: T, env: Record<string, string | undefined> = process.env, path = ""): T {
  if (typeof value === "string") {
    return interpolateString(value, env, path || "<root>") as unknown as T;
  }
  if (Array.isArray(value)) {
    return value.map((item, i) => interpolate(item, env, child(path, i))) as unknown as T;
  }
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      out[key] = interpolate(item, env, child(path, key));
    }
    return out as T;
  }
  return value;
}
