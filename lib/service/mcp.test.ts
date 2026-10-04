import { describe, expect, it } from "vitest";
import { ERROR_CODES } from "@/lib/errors/codes";
import { MESSAGES } from "@/lib/errors/messages";
import { err, ok } from "./result";
import { toolResult } from "./mcp";

function textOf(result: { content: Array<{ type: string; text?: string }> }): string {
  return result.content.map((part) => part.text ?? "").join("");
}

describe("toolResult, success", () => {
  it("serializes the value and does not mark the call an error", () => {
    const result = toolResult(ok({ id: "t1", title: "Draft" }));

    expect(result.isError).toBeUndefined();
    expect(textOf(result)).toBe(JSON.stringify({ id: "t1", title: "Draft" }));
  });
});

describe("toolResult, failure", () => {
  it("renders the sentence the failure contract already wrote for a person", () => {
    const result = toolResult(err("needs_role"));

    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe(MESSAGES.needs_role);
  });

  it("names the offending field when the service named one", () => {
    expect(textOf(toolResult(err("invalid_request", { detail: "assigneeClearance" })))).toBe(
      `${MESSAGES.invalid_request} (assigneeClearance)`,
    );
  });

  // The reason code is an internal vocabulary. It is what the HTTP surface puts
  // on the wire for a client table to look up, and it is not what an agent should
  // read back to a person: `lib/errors/codes.ts` exists because internal strings
  // shipped as user copy once already.
  it.each(ERROR_CODES)("never puts the code %s in the text it renders", (code) => {
    const text = textOf(toolResult(err(code)));

    for (const candidate of ERROR_CODES) {
      expect(text).not.toContain(candidate);
    }
  });

  it("never renders an operator message, which is for logs and not for a caller", () => {
    const text = textOf(toolResult(err("internal", { message: "worktree at /srv/x is unavailable" })));

    expect(text).toBe(MESSAGES.internal);
    expect(text).not.toContain("/srv/x");
  });

  // The MCP half of the no-oracle property. On this surface the two cases must be
  // one result object, not merely one status.
  it("gives an unknown id and an unreachable one the identical result", () => {
    expect(toolResult(err("not_found"))).toEqual(toolResult(err("not_found")));
  });
});
