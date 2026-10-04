import { describe, it, expect } from "vitest";
import { ERROR_CODES } from "./codes";
import { GENERIC_MESSAGE, MESSAGES, codeFromBody, messageFor } from "./messages";

describe("MESSAGES", () => {
  it("gives every code non-empty, sentence-shaped copy", () => {
    for (const code of ERROR_CODES) {
      const copy = MESSAGES[code];
      expect(copy, `no copy for ${code}`).toBeTypeOf("string");
      expect(copy.trim().length, `empty copy for ${code}`).toBeGreaterThan(0);
      expect(copy.trim(), `copy for ${code} is not a sentence`).toMatch(/[.!?]$/);
    }
  });

  it("has exactly as many entries as there are codes", () => {
    expect(Object.keys(MESSAGES).sort()).toEqual([...ERROR_CODES].sort());
  });

  it("never names an internal identifier, an env var, or a file path in user copy", () => {
    for (const code of ERROR_CODES) {
      const copy = MESSAGES[code];
      expect(copy, `${code} copy names an env var`).not.toMatch(/[A-Z][A-Z0-9]*_[A-Z0-9_]+/);
      expect(copy, `${code} copy names a path`).not.toMatch(/\.(ts|tsx|yaml|md)\b|\/api\//);
      expect(copy, `${code} copy echoes its own code`).not.toContain(code);
    }
  });

  // "Reload and try again" is only true advice when reloading can change the
  // answer. An alias refused because the address is already spoken for is
  // refused identically every time, so that copy sent an admin round a loop with
  // nothing to change between attempts.
  it("does not tell an alias refusal to reload and retry", () => {
    for (const code of ["alias_taken", "alias_same_address"] as const) {
      expect(MESSAGES[code], `${code} copy promises a reload`).not.toMatch(/reload/i);
      expect(MESSAGES[code], `${code} copy promises a retry`).not.toMatch(/try again/i);
      expect(MESSAGES[code]).not.toBe(MESSAGES.conflict);
    }
  });
});

describe("messageFor", () => {
  it("maps a known code to its copy", () => {
    expect(messageFor("not_cleared")).toBe(MESSAGES.not_cleared);
    expect(messageFor("write_unavailable")).toBe(MESSAGES.write_unavailable);
  });

  it("returns the generic sentence for a code it does not know", () => {
    expect(messageFor("brand_new_backend_code")).toBe(GENERIC_MESSAGE);
  });

  it("never echoes its input, not even a code-shaped string naming an env var", () => {
    const hostile = "REPO_WRITE_TOKEN_is_not_set_cannot_publish";
    const out = messageFor(hostile);
    expect(out).toBe(GENERIC_MESSAGE);
    expect(out).not.toContain("REPO_WRITE_TOKEN");
    expect(out).not.toContain(hostile);
  });

  it("does not echo a raw internal sentence handed to it as a code", () => {
    const leaked = "REPO_WRITE_TOKEN is not set, cannot publish";
    expect(messageFor(leaked)).toBe(GENERIC_MESSAGE);
    expect(messageFor(leaked)).not.toContain("REPO_WRITE_TOKEN");
  });

  it("returns the generic sentence for nothing at all", () => {
    expect(messageFor(undefined)).toBe(GENERIC_MESSAGE);
    expect(messageFor(null)).toBe(GENERIC_MESSAGE);
    expect(messageFor("")).toBe(GENERIC_MESSAGE);
  });

  it("does not resolve inherited object properties as codes", () => {
    // A naive `MESSAGES[code]` lookup would hand back Object.prototype.toString
    // for this input. The generic sentence is the only acceptable answer.
    expect(messageFor("toString")).toBe(GENERIC_MESSAGE);
    expect(messageFor("constructor")).toBe(GENERIC_MESSAGE);
    expect(messageFor("__proto__")).toBe(GENERIC_MESSAGE);
  });

  it("is not fooled by a non-string code smuggled through an untyped body", () => {
    expect(messageFor(42 as unknown as string)).toBe(GENERIC_MESSAGE);
    expect(messageFor({ code: "not_found" } as unknown as string)).toBe(GENERIC_MESSAGE);
  });
});

describe("codeFromBody", () => {
  it("reads the code off the contract shape", () => {
    expect(codeFromBody({ error: { code: "not_cleared" } })).toBe("not_cleared");
  });

  it("returns undefined for a legacy bare-string payload, so its text can never be rendered", () => {
    expect(codeFromBody({ error: "REPO_WRITE_TOKEN is not set, cannot publish" })).toBeUndefined();
    expect(messageFor(codeFromBody({ error: "write path unavailable" }))).toBe(GENERIC_MESSAGE);
  });

  it("returns undefined for anything that is not an error payload", () => {
    expect(codeFromBody(null)).toBeUndefined();
    expect(codeFromBody(undefined)).toBeUndefined();
    expect(codeFromBody("boom")).toBeUndefined();
    expect(codeFromBody({ ok: true })).toBeUndefined();
    expect(codeFromBody({ error: { message: "no code here" } })).toBeUndefined();
  });
});

describe("client importability", () => {
  it("pulls in no node builtin, so a client island can import the table", async () => {
    // Reading the module source is the only way to assert this from inside the
    // bundle. A `node:` import here would break the composer under Turbopack.
    const { readFileSync } = await import("node:fs");
    const source = readFileSync(new URL("./messages.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/from\s+["']node:/);
    expect(source).not.toMatch(/require\(["']node:/);
  });
});
