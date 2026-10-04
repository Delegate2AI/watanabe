import { readFileSync, statSync } from "node:fs";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import { connectorsFilePath } from "./config";
import {
  EntrySchema,
  RESERVED_CONNECTOR_SLUGS,
  SLUG_RE,
  type ConnectorEntry,
  type ConnectorRegistry,
} from "./types";

/**
 * Loose top-level shape check only: `connectors` must be a plain map. Each
 * value is validated individually against EntrySchema below, so one malformed
 * entry never dooms the whole file, per spec 33's per-entry error contract.
 */
const FileShapeSchema = z.object({ connectors: z.record(z.string(), z.unknown()) }).strict();

const EMPTY_REGISTRY: ConnectorRegistry = { entries: [], errors: [] };

type CacheEntry = { path: string; mtimeMs: number; value: ConnectorRegistry };

/**
 * Single-slot cache, keyed by both the resolved path and mtime. Production
 * only ever calls this with connectorsFilePath(), but the signature accepts
 * an arbitrary path (tests pass explicit temp-dir paths), so the slot must
 * record which file it holds: keying on mtimeMs alone would let two
 * different paths that happen to share an mtime silently return each
 * other's parsed registry.
 */
let cache: CacheEntry | null = null;

/** Called after a committed access/connectors.yaml change so the next read picks it up. */
export function invalidateConnectorRegistryCache(): void {
  cache = null;
}

/**
 * Never-throws contract, like lib/memory/mem-tools.ts: a missing file, a
 * malformed file, or a malformed entry all degrade into a readable result
 * rather than throwing into a session. Cached by mtime; a hot admin edit is
 * picked up on the next load once invalidateConnectorRegistryCache() runs.
 */
export function loadConnectorRegistry(
  filePath: string = connectorsFilePath(),
): ConnectorRegistry {
  let mtimeMs: number;
  let raw: string;
  try {
    mtimeMs = statSync(filePath).mtimeMs;
    raw = readFileSync(filePath, "utf8");
  } catch {
    // No connectors.yaml yet is the common case (no admin has registered
    // anything): nothing is wrong, there are simply zero connectors.
    return EMPTY_REGISTRY;
  }

  if (cache && cache.path === filePath && cache.mtimeMs === mtimeMs) return cache.value;

  const value = parseRegistry(raw);
  cache = { path: filePath, mtimeMs, value };
  return value;
}

function parseRegistry(raw: string): ConnectorRegistry {
  let parsed: unknown;
  try {
    parsed = parseYaml(raw);
  } catch (error) {
    return fileLevelError(error);
  }

  const shape = FileShapeSchema.safeParse(parsed);
  if (!shape.success) return fileLevelError(shape.error);

  const entries: ConnectorEntry[] = [];
  const errors: Array<{ slug: string; reason: string }> = [];

  for (const [slug, entryRaw] of Object.entries(shape.data.connectors)) {
    if (!SLUG_RE.test(slug)) {
      errors.push({ slug, reason: "invalid slug: must match [a-z0-9][a-z0-9-]{0,31}" });
      continue;
    }
    if (RESERVED_CONNECTOR_SLUGS.has(slug)) {
      errors.push({ slug, reason: `reserved slug: "${slug}" is an internal server name` });
      continue;
    }
    const result = EntrySchema.safeParse(entryRaw);
    if (!result.success) {
      errors.push({ slug, reason: result.error.issues.map((issue) => issue.message).join("; ") });
      continue;
    }
    entries.push({ slug, ...result.data });
  }

  return { entries, errors };
}

function fileLevelError(error: unknown): ConnectorRegistry {
  const message = error instanceof Error ? error.message : String(error);
  return { entries: [], errors: [{ slug: "*", reason: message }] };
}
