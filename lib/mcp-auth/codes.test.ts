import { createHash, randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDb } from "@/lib/db/client";
import { consumeCode, issueCode } from "./codes";

let db: import("better-sqlite3").Database;

const VERIFIER = randomBytes(32).toString("base64url");
const CHALLENGE = createHash("sha256").update(VERIFIER).digest("base64url");
const GRANT = {
  clientId: "c1",
  ownerEmail: "alice@example.com",
  redirectUri: "https://claude.ai/cb",
  codeChallenge: CHALLENGE,
};

beforeEach(() => {
  db = openDb(":memory:");
});

afterEach(() => {
  db.close();
});

describe("issueCode", () => {
  it("returns a code that is not what gets stored", () => {
    const { code } = issueCode(db, GRANT, "2026-09-05T12:00:00Z");
    const stored = db.prepare(`SELECT code_hash FROM oauth_codes`).get() as { code_hash: string };

    expect(code.length).toBeGreaterThan(20);
    expect(stored.code_hash).not.toBe(code);
    expect(stored.code_hash).toBe(createHash("sha256").update(code).digest("hex"));
  });
});

describe("consumeCode", () => {
  const exchange = { clientId: "c1", redirectUri: "https://claude.ai/cb", codeVerifier: VERIFIER };

  it("returns the owner for a correct verifier, client and redirect", () => {
    const { code } = issueCode(db, GRANT, "2026-09-05T12:00:00Z");

    expect(consumeCode(db, code, exchange, "2026-09-05T12:00:10Z")).toEqual({
      ownerEmail: "alice@example.com",
      clientId: "c1",
    });
  });

  // The point of PKCE: a stolen code is useless without the verifier that only
  // the client that started the flow holds.
  it("refuses a wrong verifier", () => {
    const { code } = issueCode(db, GRANT, "2026-09-05T12:00:00Z");

    expect(consumeCode(db, code, { ...exchange, codeVerifier: "not-it" }, "2026-09-05T12:00:10Z")).toBeNull();
  });

  it("refuses a different client presenting somebody else's code", () => {
    const { code } = issueCode(db, GRANT, "2026-09-05T12:00:00Z");

    expect(consumeCode(db, code, { ...exchange, clientId: "c2" }, "2026-09-05T12:00:10Z")).toBeNull();
  });

  it("refuses a redirect URI that does not match the one the code was issued for", () => {
    const { code } = issueCode(db, GRANT, "2026-09-05T12:00:00Z");

    expect(
      consumeCode(db, code, { ...exchange, redirectUri: "https://claude.ai/other" }, "2026-09-05T12:00:10Z"),
    ).toBeNull();
  });

  it("is single use: the second presentation is refused", () => {
    const { code } = issueCode(db, GRANT, "2026-09-05T12:00:00Z");

    expect(consumeCode(db, code, exchange, "2026-09-05T12:00:10Z")).not.toBeNull();
    expect(consumeCode(db, code, exchange, "2026-09-05T12:00:11Z")).toBeNull();
  });

  it("expires quickly, because a code only has to survive one redirect", () => {
    const { code } = issueCode(db, GRANT, "2026-09-05T12:00:00Z");

    expect(consumeCode(db, code, exchange, "2026-09-05T12:00:59Z")).not.toBeNull();
  });

  it("refuses a code past its moment", () => {
    const { code } = issueCode(db, GRANT, "2026-09-05T12:00:00Z");

    expect(consumeCode(db, code, exchange, "2026-09-05T12:05:00Z")).toBeNull();
  });

  // Every refusal is the same answer, so a caller cannot use the difference to
  // learn whether a code existed, was already spent, or belonged to somebody.
  it("refuses an invented code exactly as it refuses a spent one", () => {
    const { code } = issueCode(db, GRANT, "2026-09-05T12:00:00Z");
    consumeCode(db, code, exchange, "2026-09-05T12:00:10Z");

    expect(consumeCode(db, code, exchange, "2026-09-05T12:00:11Z")).toBeNull();
    expect(consumeCode(db, "never-existed", exchange, "2026-09-05T12:00:11Z")).toBeNull();
  });

  it("refuses a plain verifier equal to the challenge, so plain PKCE cannot sneak in", () => {
    const { code } = issueCode(
      db,
      { ...GRANT, codeChallenge: "plain-value" },
      "2026-09-05T12:00:00Z",
    );

    expect(
      consumeCode(db, code, { ...exchange, codeVerifier: "plain-value" }, "2026-09-05T12:00:10Z"),
    ).toBeNull();
  });
});
