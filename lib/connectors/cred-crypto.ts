import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

function getKey(): Buffer | null {
  const keyB64 = process.env.CONNECTOR_CRED_KEY;
  if (!keyB64) {
    return null;
  }
  try {
    return Buffer.from(keyB64, "base64");
  } catch {
    return null;
  }
}

export function canSealCredentials(): boolean {
  const key = getKey();
  return Boolean(key && key.length === 32);
}

function buildAAD(aad: { email: string; slug: string; fingerprint: string }): string {
  return JSON.stringify({ email: aad.email, slug: aad.slug, fingerprint: aad.fingerprint });
}

export function sealCredential(
  plain: object,
  aad: { email: string; slug: string; fingerprint: string },
): { ciphertext: string; keyId: string } | null {
  const key = getKey();
  if (!key || key.length !== 32) {
    return null;
  }

  try {
    const nonce = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, nonce);

    const aadStr = buildAAD(aad);
    cipher.setAAD(Buffer.from(aadStr, "utf-8"));

    const plainText = JSON.stringify(plain);
    const encrypted = Buffer.concat([cipher.update(plainText, "utf-8"), cipher.final()]);
    const tag = cipher.getAuthTag();

    const nonceB64 = nonce.toString("base64");
    const tagB64 = tag.toString("base64");
    const dataB64 = encrypted.toString("base64");

    const ciphertext = `v1:${nonceB64}:${tagB64}:${dataB64}`;

    return { ciphertext, keyId: "v1" };
  } catch {
    return null;
  }
}

export function openCredential(
  ciphertext: string,
  keyId: string,
  aad: { email: string; slug: string; fingerprint: string },
): object | null {
  const key = getKey();
  if (!key || key.length !== 32) {
    return null;
  }

  try {
    const parts = ciphertext.split(":");
    if (parts.length !== 4 || parts[0] !== "v1") {
      return null;
    }

    const nonce = Buffer.from(parts[1], "base64");
    const tag = Buffer.from(parts[2], "base64");
    const encrypted = Buffer.from(parts[3], "base64");
    if (nonce.length !== 12 || tag.length !== 16) {
      return null;
    }

    const decipher = createDecipheriv("aes-256-gcm", key, nonce, { authTagLength: 16 });
    const aadStr = buildAAD(aad);
    decipher.setAAD(Buffer.from(aadStr, "utf-8"));
    decipher.setAuthTag(tag);

    const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
    const plainText = decrypted.toString("utf-8");

    return JSON.parse(plainText);
  } catch {
    return null;
  }
}
