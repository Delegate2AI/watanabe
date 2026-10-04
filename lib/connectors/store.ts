import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { parse as parseYaml, stringify } from "yaml";
import { checkGroups } from "@/lib/authority/group-keys";
import { can } from "@/lib/authority/roles";
import { envRefNames, resolvesEnvRef } from "@/lib/config/interpolate";
import { commitPrivateAccess } from "@/lib/repo-write-private-access";
import { sanitizeEntryInput } from "@/lib/skills/store-input";
import { connectorsFilePath } from "./config";
import { invalidateConnectorRegistryCache, loadConnectorRegistry } from "./registry";
import { EntrySchema, RESERVED_CONNECTOR_SLUGS, SLUG_RE, type ConnectorEntry } from "./types";

/**
 * The admin write path for `access/connectors.yaml` (spec 33), the same
 * git-audited private-access ref that `groups.yaml` / `roles.yaml` /
 * `flags.yaml` live on. Mirrors `lib/authority/access.ts`'s `writeAccess`:
 * capability check, apply, serialize, reparse through the real loader in a
 * temp dir, then one commit through `commitPrivateAccess`.
 */
export const CONNECTORS_ACCESS_PATH = "access/connectors.yaml";

/** An entry as an admin submits it: everything but the slug, which is the map key. */
export type ConnectorEntryInput = Omit<ConnectorEntry, "slug">;

export type ConnectorChange =
  | { verb: "upsert"; slug: string; entry: ConnectorEntryInput }
  | { verb: "remove"; slug: string };

export type ConnectorWriteResult = { ok: true } | { ok: false; error: string };

export interface WriteConnectorsOptions {
  /** Registry file to read the current state from. Test-only; production uses the real one. */
  filePath?: string;
}

/**
 * The environment variables an entry references, and whether each one is set.
 *
 * Both halves come from `lib/config/interpolate.ts` rather than a local regex,
 * so the badge tells the truth about what session build will actually do. A
 * private copy drifted twice: it missed lowercase names like
 * `${circleback_token}`, which interpolation resolves fine, and it called
 * `VAR=""` configured, which interpolation treats as unset and throws on.
 *
 * Presence only: the value is never read into the result, so the admin list can
 * say "configured" without the secret ever leaving the process.
 */
export function connectorEnvVars(
  entry: { headers?: Record<string, string>; env?: Record<string, string>; oauthClientSecret?: string },
): Array<{ name: string; present: boolean }> {
  const names = new Set<string>();
  for (const source of [entry.headers, entry.env]) {
    for (const value of Object.values(source ?? {})) {
      for (const name of envRefNames(value)) names.add(name);
    }
  }
  for (const name of envRefNames(entry.oauthClientSecret ?? "")) names.add(name);
  return [...names]
    .sort((a, b) => a.localeCompare(b))
    .map((name) => ({ name, present: resolvesEnvRef(name) }));
}

export function withoutOauthClientSecret(entry: ConnectorEntry): Omit<ConnectorEntry, "oauthClientSecret"> {
  const copy: Record<string, unknown> = { ...entry };
  delete copy.oauthClientSecret;
  return copy as Omit<ConnectorEntry, "oauthClientSecret">;
}

/**
 * Slugs that pass SLUG_RE but resolve on `Object.prototype`, so assigning them
 * as a map key would not behave like an ordinary entry. Same guard the access
 * route applies to group names. `__proto__` and `prototype` are already out:
 * SLUG_RE admits no underscore, and `prototype` is listed for symmetry.
 */
const UNSAFE_SLUGS = new Set(["constructor", "prototype"]);

type RawConnectors = Record<string, unknown>;

function carryForwardOauthClientSecret(
  incoming: Record<string, unknown>,
  existing: ConnectorEntry | undefined,
): Record<string, unknown> {
  if (incoming.auth !== "oauth") return incoming;
  if ("oauthClientSecret" in incoming) {
    if (incoming.oauthClientSecret !== "") return incoming;
    const cleared: Record<string, unknown> = { ...incoming };
    delete cleared.oauthClientSecret;
    return cleared;
  }
  if (existing?.auth === "oauth" && existing.oauthClientSecret !== undefined) {
    return { ...incoming, oauthClientSecret: existing.oauthClientSecret };
  }
  return incoming;
}

/**
 * The current file as its raw slug map, entries untouched.
 *
 * Deliberately NOT rebuilt from `loadConnectorRegistry().entries`: the loader
 * drops entries it cannot validate, so rebuilding from it would delete a
 * colleague's typo'd connector the moment any admin edited an unrelated one.
 * Broken entries ride through verbatim and keep showing up as disabled.
 *
 * Returns null when the file exists but is not the shape the loader accepts.
 * The caller refuses the write in that case rather than clobbering it.
 */
function readRawConnectors(filePath: string): RawConnectors | null {
  let raw: string;
  try {
    raw = readFileSync(filePath, "utf8");
  } catch {
    // No file yet is the normal state before the first connector is registered.
    return {};
  }
  let parsed: unknown;
  try {
    parsed = parseYaml(raw);
  } catch {
    return null;
  }
  if (parsed === null || parsed === undefined) return {};
  if (typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const keys = Object.keys(parsed);
  // The loader's top-level schema is strict, so a stray sibling key would make
  // it report a file-level error. Refuse rather than silently dropping the key.
  if (keys.some((key) => key !== "connectors")) return null;
  const connectors = (parsed as { connectors?: unknown }).connectors;
  if (connectors === null || connectors === undefined) return {};
  if (typeof connectors !== "object" || Array.isArray(connectors)) return null;
  return { ...(connectors as RawConnectors) };
}

function serialize(connectors: RawConnectors): string {
  const sorted = Object.fromEntries(
    Object.entries(connectors).sort(([a], [b]) => a.localeCompare(b)),
  );
  return stringify({ connectors: sorted });
}

/**
 * The `writeAccess` reparse pattern: write the candidate to a temp dir, read it
 * back through the real loader, and refuse unless it yields exactly what this
 * change intended. Checking the error slugs too is what proves a preserved
 * broken entry actually survived serialization instead of vanishing.
 *
 * This leaves the loader's single cache slot pointing at the temp file, which
 * needs no explicit invalidation: the slot is keyed by path as well as mtime,
 * so any real read simply misses it and goes back to disk.
 */
function reparses(yamlText: string, entries: ConnectorEntry[], errorSlugs: string[]): boolean {
  const root = mkdtempSync(path.join(os.tmpdir(), "connectors-validate-"));
  try {
    const file = path.join(root, "connectors.yaml");
    writeFileSync(file, yamlText);
    const loaded = loadConnectorRegistry(file);
    const loadedErrorSlugs = loaded.errors.map((error) => error.slug).sort((a, b) => a.localeCompare(b));
    return isDeepStrictEqual(loaded.entries, entries) && isDeepStrictEqual(loadedErrorSlugs, errorSlugs);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

/**
 * Records one connector change on the private access ref.
 *
 * Refusals are returned, never thrown, so the route can translate them to a
 * reason code. The registry cache is invalidated only after the commit lands,
 * so a refused write never makes a session re-read the file for nothing.
 */
export async function writeConnectors(
  change: ConnectorChange,
  actorEmail: string,
  options: WriteConnectorsOptions = {},
): Promise<ConnectorWriteResult> {
  if (!can(actorEmail, "manageAccess")) return { ok: false, error: "forbidden" };

  const slug = change.slug.trim();
  // Upsert only. A remove is gated by `Object.hasOwn` below instead, because
  // these guards constrain what an admin may ADD, and applying them to a
  // removal makes the very entries this surface exists to fix (a hand-seeded
  // `kb:`, a `Legacy-Thing:`, an over-long slug) permanently undeletable: the
  // loader reports them as disabled rows, and nothing but a direct git commit
  // could clear them.
  if (change.verb === "upsert") {
    if (!SLUG_RE.test(slug) || UNSAFE_SLUGS.has(slug)) return { ok: false, error: "invalid slug" };
    if (RESERVED_CONNECTOR_SLUGS.has(slug)) return { ok: false, error: "reserved slug" };
  }

  const filePath = options.filePath ?? connectorsFilePath();
  const current = readRawConnectors(filePath);
  if (current === null) return { ok: false, error: "connectors file is unreadable" };

  const next: RawConnectors = { ...current };
  const loaded = loadConnectorRegistry(filePath).entries;
  const existingEntry = loaded.find((entry) => entry.slug === slug);
  const entries = loaded.filter((entry) => entry.slug !== slug);
  if (change.verb === "remove") {
    if (!Object.hasOwn(current, slug)) return { ok: false, error: "unknown connector" };
    delete next[slug];
  } else {
    // Input hygiene before the schema, reusing the skills-side helper rather
    // than growing a second copy: zod's `.strict()` does NOT catch a raw own
    // `__proto__` data property, it silently DROPS the key, so refusing is the
    // fail-closed answer to a silent field loss. See lib/skills/store-input.ts.
    const hygienic = sanitizeEntryInput(change.entry);
    if (!hygienic.ok) return { ok: false, error: "invalid connector entry" };
    const candidate = carryForwardOauthClientSecret(hygienic.value as Record<string, unknown>, existingEntry);
    const parsed = EntrySchema.safeParse(candidate);
    if (!parsed.success) return { ok: false, error: "invalid connector entry" };
    // Clearance keys go through the same check skills apply: bounded,
    // de-duplicated, sorted, and refused unless access/groups.yaml declares
    // every one of them. A typo'd key would otherwise write a healthy-looking
    // row nothing ever matches, and would start granting for real the day
    // somebody created a group with that name.
    const groups = checkGroups(parsed.data.groups);
    if (!groups.ok) return { ok: false, error: "invalid connector groups" };
    const entry = { ...parsed.data, groups: groups.groups };
    next[slug] = entry;
    entries.push({ slug, ...entry });
  }
  entries.sort((a, b) => a.slug.localeCompare(b.slug));
  const healthy = new Set(entries.map((entry) => entry.slug));
  const errorSlugs = Object.keys(next)
    .filter((key) => !healthy.has(key))
    .sort((a, b) => a.localeCompare(b));

  const yamlText = serialize(next);
  if (!reparses(yamlText, entries, errorSlugs)) {
    return { ok: false, error: "connector configuration failed validation" };
  }

  const author = actorEmail.trim().toLowerCase();
  const committed = await commitPrivateAccess(
    { [CONNECTORS_ACCESS_PATH]: yamlText },
    { authorName: author, authorEmail: author, message: `chore(access): ${change.verb} connector ${slug}` },
  );
  if (!committed.ok) return { ok: false, error: committed.error };
  invalidateConnectorRegistryCache();
  return { ok: true };
}
