import { z } from "zod";
import { getConfig } from "@/lib/config";
import { installFromGit, type InstallResult } from "./install";
import { checkIndexUrl, fetchIndexText, isHttpUrl } from "./marketplace-http";
import { BUILTIN_MARKETPLACE_ID } from "./marketplace-id";
import { describeZodError } from "./zod-error";

/**
 * Marketplace index support (spec 34): a curated JSON document listing
 * installable skills, hosted at a URL configured in `portal.yaml`
 * (`skills.marketplaces`). No index configured means the admin UI has no
 * marketplace tab to show.
 *
 * The index is remote, untrusted JSON and is treated exactly as hostile as the
 * skill content itself:
 *
 * - **Per-entry validation.** The top-level shape check is deliberately loose
 *   (`skills` must be an array) and each entry is validated on its own, so one
 *   malformed entry lands in `errors` while the healthy ones still parse.
 *   `safeParse` is all-or-nothing for the schema it is called on, so the strict
 *   entry schema must NOT be nested in the collection schema. Same shape as
 *   `./registry.ts`.
 * - **Caps on everything that comes out.** Entry count, and the length of every
 *   string an admin screen will render. These REJECT the entry rather than
 *   truncate it, matching `./validate.ts`: a truncated name or url is a
 *   silently different thing, and the entry it came from is not trustworthy.
 * - **One path into git.** Installing a pick delegates to `installFromGit`, so
 *   the argument-injection, transport-helper, and subdir-containment guards in
 *   `./install-git.ts` apply to marketplace items too. There is no second path.
 *
 * Never throws: a network failure, a non-200, HTML where JSON was promised,
 * JSON of the wrong shape, or a null entry all come back as a result.
 */

/** How many entries one index may surface. A curated index is dozens, not thousands. */
export const MAX_INDEX_ITEMS = 200;

/** Display caps, matching ./validate.ts's caps on the same two fields. */
export const MAX_ITEM_NAME_CHARS = 64;
export const MAX_ITEM_DESCRIPTION_CHARS = 1024;
export const MAX_ITEM_URL_CHARS = 512;
export const MAX_ITEM_REF_CHARS = 200;
export const MAX_ITEM_SUBDIR_CHARS = 200;

/** The ref used when an index entry pins none. The spec's index shape has no ref field. */
export const DEFAULT_MARKETPLACE_REF = "main";

/** Re-exported so callers of this module do not need to know the leaf exists. */
export { BUILTIN_MARKETPLACE_ID };

export type MarketplaceItem = {
  name: string;
  description: string;
  url: string;
  ref?: string;
  subdir?: string;
};

export type MarketplaceIssue = { item: string; reason: string };

export type MarketplaceIndex =
  | { ok: true; items: MarketplaceItem[]; errors: MarketplaceIssue[] }
  | { ok: false; reason: string };

const CONTROL_RE = /[\u0000-\u001f\u007f]/;

/** Strip control characters and collapse whitespace: these strings are rendered. */
function cleanText(value: string): string {
  return value.replace(/[\u0000-\u001f\u007f]+/g, "").replace(/\s+/g, " ").trim();
}

const display = (max: number) => z.string().transform(cleanText).pipe(z.string().max(max));

/** Exact-value fields: trimmed and bounded, never rewritten, since git consumes them. */
const exact = (max: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    .refine((value) => !CONTROL_RE.test(value), { message: "contains control characters" });

/**
 * An index entry's `url` is http(s) only, which is STRICTER than the manual git
 * tab. `checkGitRemote` deliberately accepts `file://`, `ssh://`, scp-like
 * remotes, and absolute local paths, because an admin typing one of those into
 * the git form is making a deliberate choice about a remote they name. A
 * marketplace pick is not: the url comes from a remote JSON document. Without
 * this, a hostile or compromised index could list `file:///srv/git/internal.git`
 * and an admin clicking install would clone the server's own repository into the
 * skill store, where it becomes ambient context for every matching clearance.
 * "Remote JSON chooses which local path the server reads" is a class of bug that
 * should not exist, so it is closed here and only here.
 */
const marketplaceUrl = () =>
  exact(MAX_ITEM_URL_CHARS).refine(isHttpUrl, {
    message: "must be an http(s) URL: a marketplace may not name a local or non-http remote",
  });

const ItemSchema = z.object({
  name: display(MAX_ITEM_NAME_CHARS).pipe(z.string().min(1)),
  description: display(MAX_ITEM_DESCRIPTION_CHARS).default(""),
  url: marketplaceUrl(),
  ref: exact(MAX_ITEM_REF_CHARS).optional(),
  subdir: exact(MAX_ITEM_SUBDIR_CHARS).optional(),
});

/**
 * Loose top-level check only, per the per-entry rule above. Strict, so an index
 * carrying keys we do not understand is refused rather than half-read: unlike a
 * skill entry, the document itself is the contract.
 */
const IndexShapeSchema = z.object({ skills: z.array(z.unknown()) }).strict();

/** The index URLs an operator configured, or none. Never throws. */
export function configuredMarketplaces(): string[] {
  try {
    return getConfig().skills?.marketplaces ?? [];
  } catch {
    // A malformed portal.yaml already fails the boot prime in instrumentation.ts.
    // Here it means "no marketplace", never a thrown error into an admin route.
    return [];
  }
}

export async function fetchMarketplaceIndex(
  indexUrl: string,
  fetchImpl: typeof fetch = fetch,
): Promise<MarketplaceIndex> {
  const fetched = await fetchIndexText(indexUrl, fetchImpl);
  if (!fetched.ok) return fetched;
  return parseMarketplaceIndex(fetched.text);
}

export function parseMarketplaceIndex(text: string): MarketplaceIndex {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    // The parser's own message quotes the offending bytes ("Unexpected token
    // 'a', \"aws-secret\"... is not valid JSON"), and this reason is rendered on
    // an admin screen. The body being quoted is whatever a remote host returned,
    // which after a redirect need not be the index at all, so a slice of it must
    // not travel into a response. The position is dropped with it: it is worth
    // nothing without the text it points into.
    return { ok: false, reason: "marketplace index is not valid JSON" };
  }

  const shape = IndexShapeSchema.safeParse(parsed);
  if (!shape.success) return { ok: false, reason: describeShapeFailure(parsed) };

  const items: MarketplaceItem[] = [];
  const errors: MarketplaceIssue[] = [];
  const considered = shape.data.skills.slice(0, MAX_INDEX_ITEMS);
  const dropped = shape.data.skills.length - considered.length;
  if (dropped > 0) {
    errors.push({
      item: "*",
      reason: `index truncated: ${dropped} entries past the cap of ${MAX_INDEX_ITEMS} were dropped`,
    });
  }

  for (const [position, entry] of considered.entries()) {
    const result = ItemSchema.safeParse(entry);
    if (!result.success) {
      errors.push({ item: label(entry, position), reason: describeZodError(result.error) });
      continue;
    }
    items.push(toItem(result.data));
  }

  return { ok: true, items, errors };
}

/**
 * Why the document is not an index, derived from the document rather than from
 * the zod error.
 *
 * `IndexShapeSchema` is `.strict()`, so its message NAMES every unrecognized
 * top-level key, and those keys are remote-derived: after a redirect the body
 * being described need not be an index at all, and a JSON object's key names
 * are exactly the kind of thing an internal endpoint answers with. Passing that
 * message through put those names into an admin response body.
 *
 * The signal is kept and only the remote strings are dropped. There are three
 * ways this schema can fail, and an admin debugging their own index gets told
 * which one it was, plus how many extra keys there are, which is enough to find
 * the problem in a document they can open. What they do not get is a key name
 * chosen by whoever answered the request.
 */
function describeShapeFailure(parsed: unknown): string {
  const base = "marketplace index is malformed";
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return `${base}: the document must be a JSON object carrying a "skills" array`;
  }
  const record = parsed as Record<string, unknown>;
  if (!Array.isArray(record.skills)) return `${base}: "skills" is missing or is not an array`;
  const extra = Object.keys(record).filter((key) => key !== "skills").length;
  return `${base}: ${extra} unrecognized top-level ${extra === 1 ? "key" : "keys"} beside "skills"`;
}

/** Name the offending entry so an admin can find it, falling back to its position. */
function label(entry: unknown, position: number): string {
  if (entry !== null && typeof entry === "object" && "name" in entry) {
    const name = (entry as { name: unknown }).name;
    if (typeof name === "string" && name.trim() !== "") {
      return cleanText(name).slice(0, MAX_ITEM_NAME_CHARS);
    }
  }
  return `skills[${position}]`;
}

/** Drop the optional keys rather than carrying explicit `undefined` into the registry. */
function toItem(data: z.infer<typeof ItemSchema>): MarketplaceItem {
  return {
    name: data.name,
    description: data.description,
    url: data.url,
    ...(data.ref === undefined ? {} : { ref: data.ref }),
    ...(data.subdir === undefined ? {} : { subdir: data.subdir }),
  };
}

/** The git installer's shape, so tests can substitute the remote (see below). */
export type GitInstaller = (
  opts: { url: string; ref: string; subdir?: string },
  context: { sourceType: "git" | "marketplace" },
) => Promise<InstallResult>;

/**
 * Install a marketplace pick. The item is re-validated here rather than trusted
 * from a caller, then handed to the git installer unchanged, so nothing about a
 * marketplace install reaches git by a different route than a manual git
 * install does. The result is the git installer's, restamped as a marketplace
 * source so the registry records which index the skill came from.
 *
 * `install` is a dependency-injection seam of exactly the same kind as
 * `fetchImpl` above, and defaults to the real git installer. It exists because
 * the item schema (correctly) refuses `file://`, which is the only remote a
 * test can serve without a network: a test substitutes the remote and lets the
 * real pipeline run, so ref, subdir, containment, validation, and landing are
 * all still exercised for real. Production callers pass nothing.
 */
export async function installFromMarketplace(
  item: MarketplaceItem & { index: string },
  install: GitInstaller = installFromGit,
): Promise<InstallResult> {
  // The built-in source is a sentinel, not a URL, so it cannot pass the http(s)
  // check below and does not need to: it names a document that ships with the
  // app and is never fetched. Exact equality against a compile-time constant,
  // so every other value still goes through checkIndexUrl unchanged.
  const index =
    item.index === BUILTIN_MARKETPLACE_ID
      ? ({ ok: true, value: BUILTIN_MARKETPLACE_ID } as const)
      : checkIndexUrl(item.index);
  if (!index.ok) return { ok: false, reason: index.reason };

  const parsed = ItemSchema.safeParse(item);
  if (!parsed.success) {
    return { ok: false, reason: `marketplace item is malformed: ${describeZodError(parsed.error)}` };
  }
  const entry = toItem(parsed.data);

  const result = await install(
    {
      url: entry.url,
      ref: entry.ref ?? DEFAULT_MARKETPLACE_REF,
      ...(entry.subdir === undefined ? {} : { subdir: entry.subdir }),
    },
    { sourceType: "marketplace" },
  );
  if (!result.ok || result.source.type !== "git") return result;

  return {
    ...result,
    source: {
      type: "marketplace",
      index: index.value,
      name: entry.name,
      url: result.source.url,
      ...(result.source.subdir === undefined ? {} : { subdir: result.source.subdir }),
      commit: result.source.commit,
    },
  };
}
