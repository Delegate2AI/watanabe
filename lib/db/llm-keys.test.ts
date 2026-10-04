import { beforeEach, describe, expect, it } from "vitest";
import type { Database as DatabaseType } from "better-sqlite3";
import { openDb } from "./client";
import {
  getLlmKey, hashLlmKey, insertLlmKey, listActiveKeyHashes, listAllLlmKeys, listLlmKeys, revokeLlmKey, touchLlmKeys,
} from "./llm-keys";

let db: DatabaseType;
beforeEach(() => {
  db = openDb(":memory:");
});

describe("llm keys", () => {
  it("stores the hash and last four characters, never the key", () => {
    const rec = insertLlmKey(db, { ownerEmail: " Ana@Corp.io ", routerKeyId: "r1", key: "sk-secret-wxyz", label: "laptop" }, "t1");
    expect(rec).toMatchObject({ ownerEmail: "ana@corp.io", keyHint: "wxyz", status: "active", lastUsedAt: null });
    const raw = db.prepare(`SELECT * FROM llm_keys`).get() as Record<string, unknown>;
    expect(Object.values(raw)).not.toContain("sk-secret-wxyz");
    expect(raw.key_hash).toBe(hashLlmKey("sk-secret-wxyz"));
  });

  it("lists a person's keys newest first, by lowercased email", () => {
    insertLlmKey(db, { ownerEmail: "ana@corp.io", routerKeyId: "r1", key: "k-1111", label: "a" }, "2026-10-01");
    insertLlmKey(db, { ownerEmail: "ana@corp.io", routerKeyId: "r2", key: "k-2222", label: "b" }, "2026-10-02");
    insertLlmKey(db, { ownerEmail: "bo@corp.io", routerKeyId: "r3", key: "k-3333", label: "c" }, "2026-10-03");
    expect(listLlmKeys(db, "ANA@corp.io").map((k) => k.label)).toEqual(["b", "a"]);
    expect(listAllLlmKeys(db)).toHaveLength(3);
  });

  it("revokes once and drops the key from the active hashes", () => {
    const rec = insertLlmKey(db, { ownerEmail: "ana@corp.io", routerKeyId: "r1", key: "k-1111", label: "a" }, "t");
    expect(listActiveKeyHashes(db)).toEqual([{ id: rec.id, hash: hashLlmKey("k-1111"), ownerEmail: "ana@corp.io" }]);
    expect(revokeLlmKey(db, rec.id, "t2")).toBe(true);
    expect(revokeLlmKey(db, rec.id, "t3")).toBe(false);
    expect(getLlmKey(db, rec.id)).toMatchObject({ status: "revoked", revokedAt: "t2" });
    expect(listActiveKeyHashes(db)).toEqual([]);
  });

  it("keeps the latest last-used time when touches arrive out of order", () => {
    const rec = insertLlmKey(db, { ownerEmail: "ana@corp.io", routerKeyId: "r1", key: "k-1111", label: "a" }, "t");
    touchLlmKeys(db, [{ id: rec.id, at: "2026-10-03T10:00:00Z" }]);
    touchLlmKeys(db, [{ id: rec.id, at: "2026-10-03T09:00:00Z" }, { id: "missing", at: "2026-10-03T11:00:00Z" }]);
    expect(getLlmKey(db, rec.id)?.lastUsedAt).toBe("2026-10-03T10:00:00Z");
  });
});
