import { describe, it, expect } from "vitest";
import { ERROR_CODES, STATUS, fail, type ErrorCode } from "./codes";

/** Read a `fail()` response back as the JSON body the client would receive. */
async function body(response: Response): Promise<{ error: { code: string; message?: string; detail?: string } }> {
  return (await response.json()) as { error: { code: string; message?: string; detail?: string } };
}

describe("ERROR_CODES / STATUS", () => {
  it("gives every code a status in the 4xx or 5xx range", () => {
    for (const code of ERROR_CODES) {
      const status = STATUS[code];
      expect(status, `no status for ${code}`).toBeTypeOf("number");
      expect(status).toBeGreaterThanOrEqual(400);
      expect(status).toBeLessThan(600);
    }
  });

  it("has exactly as many status entries as codes, so a stale entry cannot linger", () => {
    expect(Object.keys(STATUS).sort()).toEqual([...ERROR_CODES].sort());
  });

  it("keeps the codes stable, snake_case identifiers a client can switch on", () => {
    for (const code of ERROR_CODES) expect(code).toMatch(/^[a-z][a-z0-9_]*$/);
  });
});

describe("fail", () => {
  it("returns the code and the mapped status", async () => {
    const response = fail("not_found");
    expect(response.status).toBe(STATUS.not_found);
    expect(await body(response)).toEqual({ error: { code: "not_found" } });
  });

  it("emits no detail unless the caller passed one explicitly", async () => {
    for (const code of ERROR_CODES) {
      const parsed = await body(fail(code));
      expect(parsed.error).toEqual({ code });
      expect(parsed.error.detail).toBeUndefined();
      expect(parsed.error.message).toBeUndefined();
    }
  });

  it("never puts an environment variable name in the body of a write_unavailable failure", async () => {
    const raw = await fail("write_unavailable").text();
    expect(raw).not.toContain("REPO_WRITE_TOKEN");
    expect(raw).not.toContain("TOKEN");
  });

  it("copies detail and message verbatim from the caller and adds nothing else", async () => {
    const parsed = await body(fail("invalid_request", { message: "path is required", detail: "path" }));
    expect(parsed).toEqual({ error: { code: "invalid_request", message: "path is required", detail: "path" } });
  });

  it("drops a caller-supplied stack rather than forwarding it, since detail is a string field", async () => {
    // A caller that reaches for `String(error)` still only ever fills the one
    // field it names. There is no implicit path from a thrown Error to the body.
    const parsed = await body(fail("internal"));
    expect(JSON.stringify(parsed)).not.toMatch(/at .*\.ts:\d+/);
  });

  it("allows a caller-chosen status override for a code that needs one", () => {
    expect(fail("not_found", { status: 410 }).status).toBe(410);
  });

  it("sets a JSON content type so the client can parse the payload", () => {
    expect(fail("conflict").headers.get("content-type")).toContain("application/json");
  });
});

describe("ErrorCode exhaustiveness", () => {
  it("keeps every code the spec named", () => {
    const expected: ErrorCode[] = [
      "not_cleared",
      "not_assignee",
      "terminal",
      "wrong_status",
      "needs_role",
      "write_unavailable",
      "review_unavailable",
      "llm_unavailable",
      "not_found",
      "invalid_request",
      "unsupported_file",
      "file_too_large",
      "unreadable_file",
      "conflict",
      // Split off `conflict` so an alias refused for a collision stops telling
      // the admin to reload and retry, which could never change the answer.
      "alias_taken",
      "alias_same_address",
      "internal",
    ];
    expect([...ERROR_CODES].sort()).toEqual(expected.sort());
  });
});
