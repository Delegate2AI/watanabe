import { beforeEach, describe, expect, it } from "vitest";
import type { Database as DatabaseType } from "better-sqlite3";
import { openDb } from "./client";
import { migrate } from "./migrate";
import {
  upsertCredential,
  getCredential,
  deleteCredential,
  deleteCredentialsForSlug,
  listCredentialSlugs,
  listCredentialOwners,
} from "./connector-credentials";

let db: DatabaseType;

beforeEach(() => {
  db = openDb(":memory:");
  migrate(db);
});

describe("upsertCredential", () => {
  it("inserts a new credential", () => {
    const now = new Date().toISOString();
    upsertCredential(db, {
      callerEmail: "user@example.com",
      slug: "github",
      fingerprint: "fp123",
      ciphertext: "sealed-cred",
      keyId: "v1",
      expiresAt: null,
      createdAt: now,
      updatedAt: now,
    });

    const cred = getCredential(db, "user@example.com", "github");
    expect(cred).toBeDefined();
    expect(cred?.ciphertext).toBe("sealed-cred");
    expect(cred?.keyId).toBe("v1");
  });

  it("replaces an existing credential and updates timestamps", () => {
    const now = new Date().toISOString();
    const later = new Date(Date.parse(now) + 1000).toISOString();

    upsertCredential(db, {
      callerEmail: "user@example.com",
      slug: "github",
      fingerprint: "fp123",
      ciphertext: "sealed-cred-v1",
      keyId: "v1",
      expiresAt: null,
      createdAt: now,
      updatedAt: now,
    });

    upsertCredential(db, {
      callerEmail: "user@example.com",
      slug: "github",
      fingerprint: "fp456",
      ciphertext: "sealed-cred-v2",
      keyId: "v1",
      expiresAt: null,
      createdAt: now,
      updatedAt: later,
    });

    const cred = getCredential(db, "user@example.com", "github");
    expect(cred?.ciphertext).toBe("sealed-cred-v2");
    expect(cred?.fingerprint).toBe("fp456");
    expect(cred?.updatedAt).toBe(later);
  });
});

describe("getCredential", () => {
  it("returns null when credential does not exist", () => {
    const cred = getCredential(db, "nonexistent@example.com", "github");
    expect(cred).toBeNull();
  });

  it("returns the credential when it exists", () => {
    const now = new Date().toISOString();
    upsertCredential(db, {
      callerEmail: "user@example.com",
      slug: "github",
      fingerprint: "fp123",
      ciphertext: "sealed-cred",
      keyId: "v1",
      expiresAt: null,
      createdAt: now,
      updatedAt: now,
    });

    const cred = getCredential(db, "user@example.com", "github");
    expect(cred).toMatchObject({
      callerEmail: "user@example.com",
      slug: "github",
      fingerprint: "fp123",
      ciphertext: "sealed-cred",
      keyId: "v1",
    });
  });
});

describe("deleteCredential", () => {
  it("returns false when credential does not exist", () => {
    const result = deleteCredential(db, "nonexistent@example.com", "github");
    expect(result).toBe(false);
  });

  it("returns true and deletes the credential", () => {
    const now = new Date().toISOString();
    upsertCredential(db, {
      callerEmail: "user@example.com",
      slug: "github",
      fingerprint: "fp123",
      ciphertext: "sealed-cred",
      keyId: "v1",
      expiresAt: null,
      createdAt: now,
      updatedAt: now,
    });

    const result = deleteCredential(db, "user@example.com", "github");
    expect(result).toBe(true);

    const cred = getCredential(db, "user@example.com", "github");
    expect(cred).toBeNull();
  });
});

describe("listCredentialSlugs", () => {
  it("returns empty array when no credentials exist", () => {
    const slugs = listCredentialSlugs(db, "user@example.com");
    expect(slugs).toEqual([]);
  });

  it("returns list of slugs for a user", () => {
    const now = new Date().toISOString();
    upsertCredential(db, {
      callerEmail: "user@example.com",
      slug: "github",
      fingerprint: "fp1",
      ciphertext: "cred1",
      keyId: "v1",
      expiresAt: null,
      createdAt: now,
      updatedAt: now,
    });

    upsertCredential(db, {
      callerEmail: "user@example.com",
      slug: "gitlab",
      fingerprint: "fp2",
      ciphertext: "cred2",
      keyId: "v1",
      expiresAt: null,
      createdAt: now,
      updatedAt: now,
    });

    upsertCredential(db, {
      callerEmail: "other@example.com",
      slug: "github",
      fingerprint: "fp3",
      ciphertext: "cred3",
      keyId: "v1",
      expiresAt: null,
      createdAt: now,
      updatedAt: now,
    });

    const slugs = listCredentialSlugs(db, "user@example.com");
    expect(slugs.sort()).toEqual(["github", "gitlab"]);
  });
});

describe("deleteCredentialsForSlug", () => {
  it("returns 0 when no credentials exist for the slug", () => {
    expect(deleteCredentialsForSlug(db, "github")).toBe(0);
  });

  it("deletes every caller's credential on the slug and leaves other slugs alone", () => {
    const now = new Date().toISOString();
    upsertCredential(db, {
      callerEmail: "alice@example.com",
      slug: "github",
      fingerprint: "fp1",
      ciphertext: "cred1",
      keyId: "v1",
      expiresAt: null,
      createdAt: now,
      updatedAt: now,
    });
    upsertCredential(db, {
      callerEmail: "bob@example.com",
      slug: "github",
      fingerprint: "fp2",
      ciphertext: "cred2",
      keyId: "v1",
      expiresAt: null,
      createdAt: now,
      updatedAt: now,
    });
    upsertCredential(db, {
      callerEmail: "alice@example.com",
      slug: "gitlab",
      fingerprint: "fp3",
      ciphertext: "cred3",
      keyId: "v1",
      expiresAt: null,
      createdAt: now,
      updatedAt: now,
    });

    const deleted = deleteCredentialsForSlug(db, "github");

    expect(deleted).toBe(2);
    expect(getCredential(db, "alice@example.com", "github")).toBeNull();
    expect(getCredential(db, "bob@example.com", "github")).toBeNull();
    expect(getCredential(db, "alice@example.com", "gitlab")).not.toBeNull();
  });
});

describe("listCredentialOwners", () => {
  it("returns empty array when no credentials exist for the slug", () => {
    const owners = listCredentialOwners(db, "github");
    expect(owners).toEqual([]);
  });

  it("returns every distinct caller with a credential on the slug", () => {
    const now = new Date().toISOString();
    upsertCredential(db, {
      callerEmail: "alice@example.com",
      slug: "github",
      fingerprint: "fp1",
      ciphertext: "cred1",
      keyId: "v1",
      expiresAt: null,
      createdAt: now,
      updatedAt: now,
    });
    upsertCredential(db, {
      callerEmail: "bob@example.com",
      slug: "github",
      fingerprint: "fp2",
      ciphertext: "cred2",
      keyId: "v1",
      expiresAt: null,
      createdAt: now,
      updatedAt: now,
    });
    upsertCredential(db, {
      callerEmail: "alice@example.com",
      slug: "gitlab",
      fingerprint: "fp3",
      ciphertext: "cred3",
      keyId: "v1",
      expiresAt: null,
      createdAt: now,
      updatedAt: now,
    });

    const owners = listCredentialOwners(db, "github");
    expect(owners).toEqual(["alice@example.com", "bob@example.com"]);
  });
});
