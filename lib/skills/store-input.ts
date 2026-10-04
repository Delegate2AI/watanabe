/**
 * Input hygiene for one candidate registry entry, run immediately before the
 * schema in `writeSkills`.
 *
 * It does exactly one accepting thing and two refusing things:
 *
 * 1. **Drops keys whose value is `undefined`.** `{ subdir: undefined }` and an
 *    omitted `subdir` are the same value to every caller here, but not to the
 *    round trip: zod keeps the key, `stringify` writes `subdir: null`, the
 *    loader then rejects the entry, and the write fails as "skill configuration
 *    failed validation", naming the wrong cause on a path where an admin has no
 *    other visibility. A route rebuilding a source with a plain object spread
 *    should not have to know the conditional-spread idiom to get a truthful
 *    answer. Dropping cannot widen what the schema accepts, because it runs
 *    BEFORE the schema: an undefined REQUIRED field still fails, as missing.
 * 2. **Refuses an own key named `__proto__`.** Bracket assignment on that name
 *    invokes the prototype setter instead of creating a data property, so
 *    rebuilding an object that carries one would consume the key and hide it
 *    from `Object.keys`. Global `Object.prototype` is never touched, so this is
 *    not prototype pollution; the loss is a VALIDATION one. Before this module
 *    existed, zod's `.strict()` did NOT catch it: verified against the real
 *    `EntrySchema` on zod 4.4.3, a raw own `__proto__` data property (exactly
 *    what `JSON.parse` produces) makes `safeParse` SUCCEED and silently DROP
 *    the key, because `"__proto__" in {}` is always true so the own-vs-
 *    recognized check never flags it. Refusing is the fail-closed answer to a
 *    silent field loss.
 * 3. **Refuses anything nested past MAX_ENTRY_DEPTH.** A cycle or a
 *    pathologically deep object would otherwise recurse until the stack blew,
 *    and `writeSkills` promises refusals are returned, never thrown. One depth
 *    cap covers both, since a cycle exceeds any finite depth.
 *
 * Both refusals map to the caller's existing "invalid skill entry" error, so
 * neither adds a new failure shape for the caller to handle.
 */

/** A real entry is three levels deep (entry, source or compat, leaf). This is slack, not a target. */
export const MAX_ENTRY_DEPTH = 32;

export type EntryInputResult =
  | { ok: true; value: unknown }
  | { ok: false; reason: "proto-key" | "too-deep" };

export function sanitizeEntryInput(value: unknown): EntryInputResult {
  return walk(value, 0);
}

function walk(value: unknown, depth: number): EntryInputResult {
  if (depth > MAX_ENTRY_DEPTH) return { ok: false, reason: "too-deep" };

  if (Array.isArray(value)) {
    // Elements are walked, never dropped: removing an undefined one would
    // silently shorten a list rather than let the schema report it.
    const items: unknown[] = [];
    for (const item of value) {
      const walked = walk(item, depth + 1);
      if (!walked.ok) return walked;
      items.push(walked.value);
    }
    return { ok: true, value: items };
  }

  if (value === null || typeof value !== "object") return { ok: true, value };

  // Plain maps are rebuilt; everything else is returned BY IDENTITY, so a YAML
  // timestamp, a Map, or any class instance inside a preserved raw entry keeps
  // its type. A null-prototype object is rebuilt too, and comes back with the
  // ordinary Object prototype: unreachable today, since every candidate is
  // assembled from object literals, and harmless because the schema reads only
  // own enumerable keys either way.
  const proto = Object.getPrototypeOf(value) as unknown;
  if (proto !== Object.prototype && proto !== null) return { ok: true, value };

  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (key === "__proto__") return { ok: false, reason: "proto-key" };
    if (item === undefined) continue;
    const walked = walk(item, depth + 1);
    if (!walked.ok) return walked;
    out[key] = walked.value;
  }
  return { ok: true, value: out };
}
