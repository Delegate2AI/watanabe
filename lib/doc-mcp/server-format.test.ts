import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { z } from "zod";
import { createDocMcpServer } from "./server";

/**
 * The MCP boundary, not the tool behind it.
 *
 * A first cut left `format` out of the zod schema when the flag was off, so the
 * model could not be told about a format the deployment would refuse. Zod strips
 * an unknown key rather than rejecting it, so `{ body: "<h1>..", format: "html" }`
 * arrived at the tool as a bare body, took the markdown default, and stored the
 * HTML anyway. Flag-off has to REFUSE the field, never silently drop it: dropping
 * it is how a kill switch turns into a mislabelled row.
 */

interface RegisteredTool {
  inputSchema: z.ZodType<Record<string, unknown>>;
}

/** The `doc_write` tool as the SDK registered it, so the real schema is exercised. */
function docWriteSchema(): z.ZodType<Record<string, unknown>> {
  const server = createDocMcpServer({
    getThreadId: () => "t1",
    ownerEmail: "alice@example.com",
  } as Parameters<typeof createDocMcpServer>[0]);
  const registered = (server.instance as unknown as {
    _registeredTools: Record<string, RegisteredTool>;
  })._registeredTools.doc_write;
  return registered.inputSchema;
}

beforeEach(() => {
  delete process.env.HTML_DOCUMENTS_ENABLED;
});

afterEach(() => {
  delete process.env.HTML_DOCUMENTS_ENABLED;
});

describe("doc_write MCP schema", () => {
  it("carries format through to the tool when the flag is on", () => {
    process.env.HTML_DOCUMENTS_ENABLED = "1";
    const parsed = docWriteSchema().parse({ body: "<h1>x</h1>", format: "html" });
    expect(parsed).toMatchObject({ format: "html" });
  });

  it("does not strip format when the flag is off, which would store html as markdown", () => {
    process.env.HTML_DOCUMENTS_ENABLED = "0";
    const parsed = docWriteSchema().safeParse({ body: "<h1>x</h1>", format: "html" });

    // Either the schema refuses it outright, or it survives parsing so the tool
    // can refuse it. What must NOT happen is arriving with no format at all.
    if (parsed.success) {
      expect(parsed.data).toMatchObject({ format: "html" });
    } else {
      expect(parsed.success).toBe(false);
    }
  });

  it("still accepts a plain markdown call with the flag off", () => {
    process.env.HTML_DOCUMENTS_ENABLED = "0";
    expect(docWriteSchema().parse({ body: "# heading" })).toMatchObject({ body: "# heading" });
  });
});
