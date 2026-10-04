import { describe, it, expect } from "vitest";
import { gateAgentTool } from "@/lib/agent/permissions";

// `mcp__kb__kb_index` (registered in lib/kb-mcp/server.ts, gated on
// isIndexEnabled()) needs no dedicated branch in the gate: it already falls
// under the `mcp__kb__` prefix that `isAgentToolAllowed` allow-lists, same as
// kb_list/kb_read/kb_search. This is a regression guard for that fact, split
// out into its own file (rather than added to lib/agent/permissions.test.ts,
// which is already at the repo's line-count limit) purely to keep that file
// under the limit, same "@/lib/agent/permissions" module under test.

describe("kb_index in the gate", () => {
  it("allows mcp__kb__kb_index via the mcp__kb__ prefix, no gate change needed", () => {
    expect(gateAgentTool("mcp__kb__kb_index", {})).toBe("allow");
  });
});
