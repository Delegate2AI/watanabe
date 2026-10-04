import { describe, expect, it } from "vitest";
import { ERROR_CODES } from "@/lib/errors/codes";
import { err, ok } from "./result";

describe("ok", () => {
  it("carries the value under a discriminant a caller can narrow on", () => {
    const result = ok({ tasks: [] });

    expect(result).toEqual({ ok: true, value: { tasks: [] } });
  });

  it("does not copy the value, so a service can hand back a row it already has", () => {
    const value = { id: "t1" };
    const result = ok(value);

    expect(result.ok && result.value).toBe(value);
  });
});

describe("err", () => {
  // The optional fields are absent, not undefined. `fail()` tests `!== undefined`
  // before adding a key, so a failure carrying an explicit `detail: undefined`
  // would still render `{error:{code}}`, but the two shapes would not be
  // deep-equal and every no-oracle assertion in this codebase is a deep-equal.
  it("omits detail and message entirely when neither is given", () => {
    const failure = err("not_found");

    expect(failure).toEqual({ ok: false, code: "not_found" });
    expect(Object.keys(failure).sort()).toEqual(["code", "ok"]);
  });

  it("carries only the field it was given", () => {
    expect(Object.keys(err("invalid_request", { detail: "body" })).sort()).toEqual([
      "code",
      "detail",
      "ok",
    ]);
    expect(Object.keys(err("internal", { message: "operator note" })).sort()).toEqual([
      "code",
      "message",
      "ok",
    ]);
  });

  it("accepts every code in the closed set, so a service can name any of them", () => {
    for (const code of ERROR_CODES) {
      expect(err(code).code).toBe(code);
    }
  });
});
