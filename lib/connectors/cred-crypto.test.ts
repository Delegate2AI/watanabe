import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomBytes } from "crypto";
import { sealCredential, openCredential } from "./cred-crypto";

let savedKey: string | undefined;

beforeAll(() => {
  savedKey = process.env.CONNECTOR_CRED_KEY;
  process.env.CONNECTOR_CRED_KEY = randomBytes(32).toString("base64");
});

afterAll(() => {
  if (savedKey === undefined) {
    delete process.env.CONNECTOR_CRED_KEY;
  } else {
    process.env.CONNECTOR_CRED_KEY = savedKey;
  }
});

describe("cred-crypto", () => {
  const plaintext = { token: "test-token", refreshToken: "refresh-123" };
  const aad = { email: "user@example.com", slug: "github", fingerprint: "fp123" };

  describe("sealCredential", () => {
    it("seals a credential and returns ciphertext with keyId", () => {
      const result = sealCredential(plaintext, aad);
      expect(result).toBeDefined();
      expect(result?.ciphertext).toBeDefined();
      expect(result?.keyId).toBe("v1");
    });

    it("returns null if key is missing or invalid", () => {
      const originalKey = process.env.CONNECTOR_CRED_KEY;
      try {
        delete process.env.CONNECTOR_CRED_KEY;
        const result = sealCredential(plaintext, aad);
        expect(result).toBeNull();
      } finally {
        if (originalKey) process.env.CONNECTOR_CRED_KEY = originalKey;
      }
    });
  });

  describe("openCredential", () => {
    it("opens a sealed credential and returns the plaintext", () => {
      const sealed = sealCredential(plaintext, aad);
      expect(sealed).toBeDefined();

      const opened = openCredential(sealed!.ciphertext, sealed!.keyId, aad);
      expect(opened).toEqual(plaintext);
    });

    it("returns null if AAD email is tampered", () => {
      const sealed = sealCredential(plaintext, aad);
      expect(sealed).toBeDefined();

      const tamperedAad = { ...aad, email: "attacker@example.com" };
      const opened = openCredential(sealed!.ciphertext, sealed!.keyId, tamperedAad);
      expect(opened).toBeNull();
    });

    it("returns null if AAD slug is tampered", () => {
      const sealed = sealCredential(plaintext, aad);
      expect(sealed).toBeDefined();

      const tamperedAad = { ...aad, slug: "gitlab" };
      const opened = openCredential(sealed!.ciphertext, sealed!.keyId, tamperedAad);
      expect(opened).toBeNull();
    });

    it("returns null if AAD fingerprint is tampered", () => {
      const sealed = sealCredential(plaintext, aad);
      expect(sealed).toBeDefined();

      const tamperedAad = { ...aad, fingerprint: "fp999" };
      const opened = openCredential(sealed!.ciphertext, sealed!.keyId, tamperedAad);
      expect(opened).toBeNull();
    });

    it("returns null if ciphertext format is invalid", () => {
      const result = openCredential("invalid-format", "v1", aad);
      expect(result).toBeNull();
    });

    it("returns null if tag is tampered", () => {
      const sealed = sealCredential(plaintext, aad);
      expect(sealed).toBeDefined();

      const parts = sealed!.ciphertext.split(":");
      if (parts.length === 4) {
        const tampered = `${parts[0]}:${parts[1]}:tamperedtag:${parts[3]}`;
        const opened = openCredential(tampered, sealed!.keyId, aad);
        expect(opened).toBeNull();
      }
    });

    it("returns null when the auth tag has been truncated to 4 bytes", () => {
      const sealed = sealCredential(plaintext, aad);
      expect(sealed).toBeDefined();

      const parts = sealed!.ciphertext.split(":");
      expect(parts).toHaveLength(4);
      const fullTag = Buffer.from(parts[2], "base64");
      const truncatedTag = fullTag.subarray(0, 4).toString("base64");
      const tampered = `${parts[0]}:${parts[1]}:${truncatedTag}:${parts[3]}`;

      const opened = openCredential(tampered, sealed!.keyId, aad);
      expect(opened).toBeNull();
    });

    it("returns null when the nonce is not exactly 12 bytes", () => {
      const sealed = sealCredential(plaintext, aad);
      expect(sealed).toBeDefined();

      const parts = sealed!.ciphertext.split(":");
      const shortNonce = Buffer.from(parts[1], "base64").subarray(0, 8).toString("base64");
      const tampered = `${parts[0]}:${shortNonce}:${parts[2]}:${parts[3]}`;

      const opened = openCredential(tampered, sealed!.keyId, aad);
      expect(opened).toBeNull();
    });
  });

  describe("round-trip", () => {
    it("successfully seals and opens multiple different credentials", () => {
      const testCases = [
        { plain: { token: "abc" }, aad: { email: "u1@test.com", slug: "s1", fingerprint: "f1" } },
        { plain: { token: "def", extra: "data" }, aad: { email: "u2@test.com", slug: "s2", fingerprint: "f2" } },
        { plain: { a: 1, b: { c: true } }, aad: { email: "u3@test.com", slug: "s3", fingerprint: "f3" } },
      ];

      for (const { plain, aad: testAad } of testCases) {
        const sealed = sealCredential(plain, testAad);
        expect(sealed).toBeDefined();

        const opened = openCredential(sealed!.ciphertext, sealed!.keyId, testAad);
        expect(opened).toEqual(plain);
      }
    });

    it("each seal produces different ciphertexts due to random nonce", () => {
      const sealed1 = sealCredential(plaintext, aad);
      const sealed2 = sealCredential(plaintext, aad);

      expect(sealed1).toBeDefined();
      expect(sealed2).toBeDefined();
      expect(sealed1?.ciphertext).not.toBe(sealed2?.ciphertext);
    });
  });
});
