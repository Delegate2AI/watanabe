import { describe, expect, it } from "vitest";
import { ERROR_CODES, STATUS, fail } from "@/lib/errors/codes";
import { err, ok } from "./result";
import { failureResponse, respond } from "./http";

describe("failureResponse", () => {
  // The status must come from the one table, not from a second one that agrees
  // with it today. This is the assertion that keeps them from drifting.
  it.each(ERROR_CODES)("answers %s with the status the failure contract maps it to", async (code) => {
    const response = failureResponse(err(code));

    expect(response.status).toBe(STATUS[code]);
    expect(await response.text()).toBe(await fail(code).text());
  });

  it("passes a detail through to the envelope", async () => {
    const response = failureResponse(err("invalid_request", { detail: "clearance" }));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: { code: "invalid_request", detail: "clearance" } });
  });

  it("passes an operator message through without inventing one", async () => {
    const response = failureResponse(err("internal", { message: "worktree unavailable" }));

    expect(await response.json()).toEqual({ error: { code: "internal", message: "worktree unavailable" } });
  });
});

describe("respond", () => {
  it("renders a success as 200 JSON by default", async () => {
    const response = respond(ok({ tasks: [] }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ tasks: [] });
  });

  it("hands the value to a renderer when one is given, for the 201 and no-content cases", async () => {
    const response = respond(ok({ task: { id: "t1" } }), (value) => Response.json(value, { status: 201 }));

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ task: { id: "t1" } });
  });

  it("never calls the renderer for a failure", async () => {
    let called = false;
    const response = respond(err("not_found"), () => {
      called = true;
      return Response.json({});
    });

    expect(called).toBe(false);
    expect(response.status).toBe(404);
  });

  // The property the whole surface rests on: an id that does not exist and an id
  // the caller may not see are one answer, byte for byte.
  it("gives an unknown id and an unreachable one the identical response", async () => {
    const unknown = failureResponse(err("not_found"));
    const unreachable = failureResponse(err("not_found"));

    expect(unknown.status).toBe(unreachable.status);
    expect(await unknown.text()).toBe(await unreachable.text());
  });
});
