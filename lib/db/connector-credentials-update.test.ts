import { beforeEach, describe, expect, it } from "vitest";
import type { Database as DatabaseType } from "better-sqlite3";
import { openDb } from "./client";
import { migrate } from "./migrate";
import { upsertCredential, updateCredentialIfUnchanged, getCredential, deleteCredential } from "./connector-credentials";

let db: DatabaseType;

beforeEach(() => {
  db = openDb(":memory:");
  migrate(db);
});

describe("updateCredentialIfUnchanged", () => {
  it("updates the row when the ciphertext still matches what was read", () => {
    const now = new Date().toISOString();
    upsertCredential(db, {
      callerEmail: "user@example.com",
      slug: "github",
      fingerprint: "fp1",
      ciphertext: "cred-v1",
      keyId: "v1",
      expiresAt: null,
      createdAt: now,
      updatedAt: now,
    });

    const later = new Date(Date.parse(now) + 1000).toISOString();
    const ok = updateCredentialIfUnchanged(db, {
      callerEmail: "user@example.com",
      slug: "github",
      expectedCiphertext: "cred-v1",
      fingerprint: "fp1",
      ciphertext: "cred-v2",
      keyId: "v1",
      expiresAt: later,
      updatedAt: later,
    });

    expect(ok).toBe(true);
    const cred = getCredential(db, "user@example.com", "github");
    expect(cred?.ciphertext).toBe("cred-v2");
    expect(cred?.expiresAt).toBe(later);
  });

  it("skips the write and returns false when the row was deleted since it was read", () => {
    const now = new Date().toISOString();
    upsertCredential(db, {
      callerEmail: "user@example.com",
      slug: "github",
      fingerprint: "fp1",
      ciphertext: "cred-v1",
      keyId: "v1",
      expiresAt: null,
      createdAt: now,
      updatedAt: now,
    });
    deleteCredential(db, "user@example.com", "github");

    const ok = updateCredentialIfUnchanged(db, {
      callerEmail: "user@example.com",
      slug: "github",
      expectedCiphertext: "cred-v1",
      fingerprint: "fp1",
      ciphertext: "cred-v2",
      keyId: "v1",
      expiresAt: null,
      updatedAt: now,
    });

    expect(ok).toBe(false);
    expect(getCredential(db, "user@example.com", "github")).toBeNull();
  });

  it("skips the write and returns false when the ciphertext changed since it was read", () => {
    const now = new Date().toISOString();
    upsertCredential(db, {
      callerEmail: "user@example.com",
      slug: "github",
      fingerprint: "fp1",
      ciphertext: "cred-original",
      keyId: "v1",
      expiresAt: null,
      createdAt: now,
      updatedAt: now,
    });
    upsertCredential(db, {
      callerEmail: "user@example.com",
      slug: "github",
      fingerprint: "fp2",
      ciphertext: "cred-interleaved",
      keyId: "v1",
      expiresAt: null,
      createdAt: now,
      updatedAt: now,
    });

    const ok = updateCredentialIfUnchanged(db, {
      callerEmail: "user@example.com",
      slug: "github",
      expectedCiphertext: "cred-original",
      fingerprint: "fp-stale",
      ciphertext: "cred-stale",
      keyId: "v1",
      expiresAt: null,
      updatedAt: now,
    });

    expect(ok).toBe(false);
    expect(getCredential(db, "user@example.com", "github")?.ciphertext).toBe("cred-interleaved");
  });
});
