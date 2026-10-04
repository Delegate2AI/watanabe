import type { Database as DatabaseType } from "better-sqlite3";
import { createHash, randomUUID } from "crypto";
import { normalizedEmail } from "@/lib/authority/aliases-store";

export interface LlmKey {
  id: string;
  ownerEmail: string;
  routerKeyId: string;
  keyHint: string;
  label: string;
  status: "active" | "revoked";
  createdAt: string;
  revokedAt: string | null;
  lastUsedAt: string | null;
}

interface Row {
  id: string;
  owner_email: string;
  router_key_id: string;
  key_hint: string;
  label: string;
  status: "active" | "revoked";
  created_at: string;
  revoked_at: string | null;
  last_used_at: string | null;
}

const COLUMNS = `id, owner_email, router_key_id, key_hint, label, status, created_at, revoked_at, last_used_at`;

function toKey(r: Row): LlmKey {
  return {
    id: r.id,
    ownerEmail: r.owner_email,
    routerKeyId: r.router_key_id,
    keyHint: r.key_hint,
    label: r.label,
    status: r.status,
    createdAt: r.created_at,
    revokedAt: r.revoked_at,
    lastUsedAt: r.last_used_at,
  };
}

export function hashLlmKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

/** Stores the key's hash and last four characters; the raw key is never written. */
export function insertLlmKey(
  db: DatabaseType,
  input: { ownerEmail: string; routerKeyId: string; key: string; label: string },
  now: string = new Date().toISOString(),
): LlmKey {
  const id = randomUUID();
  db.prepare(
    `INSERT INTO llm_keys (id, owner_email, router_key_id, key_hash, key_hint, label, status, created_at)
     VALUES (@id, @owner, @routerKeyId, @hash, @hint, @label, 'active', @now)`,
  ).run({
    id,
    owner: normalizedEmail(input.ownerEmail),
    routerKeyId: input.routerKeyId,
    hash: hashLlmKey(input.key),
    hint: input.key.slice(-4),
    label: input.label.trim(),
    now,
  });
  return getLlmKey(db, id)!;
}

export function getLlmKey(db: DatabaseType, id: string): LlmKey | null {
  const row = db.prepare(`SELECT ${COLUMNS} FROM llm_keys WHERE id = @id`).get({ id }) as Row | undefined;
  return row ? toKey(row) : null;
}

export function listLlmKeys(db: DatabaseType, ownerEmail: string): LlmKey[] {
  const rows = db
    .prepare(`SELECT ${COLUMNS} FROM llm_keys WHERE owner_email = @owner ORDER BY created_at DESC, rowid DESC`)
    .all({ owner: normalizedEmail(ownerEmail) }) as Row[];
  return rows.map(toKey);
}

export function listAllLlmKeys(db: DatabaseType): LlmKey[] {
  const rows = db.prepare(`SELECT ${COLUMNS} FROM llm_keys ORDER BY owner_email, created_at DESC`).all() as Row[];
  return rows.map(toKey);
}

export function revokeLlmKey(db: DatabaseType, id: string, now: string = new Date().toISOString()): boolean {
  const info = db
    .prepare(`UPDATE llm_keys SET status = 'revoked', revoked_at = @now WHERE id = @id AND status = 'active'`)
    .run({ id, now });
  return info.changes > 0;
}

export function listActiveKeyHashes(db: DatabaseType): Array<{ id: string; hash: string; ownerEmail: string }> {
  return db
    .prepare(`SELECT id, key_hash AS hash, owner_email AS ownerEmail FROM llm_keys WHERE status = 'active'`)
    .all() as Array<{ id: string; hash: string; ownerEmail: string }>;
}

/** Touches can arrive out of order across gate batches, so only a later time wins. */
export function touchLlmKeys(db: DatabaseType, touches: Array<{ id: string; at: string }>): void {
  const stmt = db.prepare(
    `UPDATE llm_keys SET last_used_at = @at WHERE id = @id AND (last_used_at IS NULL OR last_used_at < @at)`,
  );
  db.transaction(() => {
    for (const t of touches) stmt.run(t);
  })();
}
