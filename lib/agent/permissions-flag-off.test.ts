import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { denialReason, gateAgentTool } from "./permissions";

/**
 * The flag-off posture of the two spec 33/34 branches of `denialReason`.
 *
 * The verdicts were always right: an external `mcp__*` tool and a `Skill` call
 * are both denied with CONNECTORS_ENABLED and SKILLS_ENABLED off. The REASON
 * was not. `parseExternalMcpTool` and the `Skill` branch ran unconditionally, so
 * a portal with neither feature enabled told the model "connector not enabled
 * for this thread" or "no such skill is installed and available to this user",
 * naming features that do not exist there and dropping the sentence that tells
 * the model what it CAN do. The reason reaches the model as
 * `permissionDecisionReason` and is user-visible, so this is behavior, not text.
 *
 * `denialReason("Edit")` is the canonical generic case: asserting exact equality
 * with it is what proves these two shapes fall through to the same branch they
 * fell through to before either spec landed.
 */

const saved = { ...process.env };

beforeEach(() => {
  delete process.env.CONNECTORS_ENABLED;
  delete process.env.SKILLS_ENABLED;
  delete process.env.KB_WRITE_ENABLED;
});

afterEach(() => {
  process.env = { ...saved };
});

const EXTERNAL_TOOL = "mcp__circleback__SearchMeetings";

describe("denialReason with both feature flags off", () => {
  it("gives an external MCP tool the generic read-only reason, not a connector one", () => {
    const reason = denialReason(EXTERNAL_TOOL);

    expect(reason).toBe(denialReason("Edit").replace("`Edit`", `\`${EXTERNAL_TOOL}\``));
    expect(reason).not.toContain("connector");
    expect(reason).toContain("read-only");
    expect(reason).toContain("WebSearch / WebFetch");
  });

  it("gives a Skill call the generic read-only reason, not a skills one", () => {
    const reason = denialReason("Skill", { skill: "brand-guidelines" });

    expect(reason).toBe(denialReason("Edit").replace("`Edit`", "`Skill`"));
    expect(reason).not.toContain("skill is installed");
    expect(reason).toContain("read-only");
    expect(reason).toContain("WebSearch / WebFetch");
  });

  it("keeps both verdicts at deny, which is what actually enforces the boundary", () => {
    expect(gateAgentTool(EXTERNAL_TOOL, undefined, "t1", undefined, "owner@example.com")).toBe("deny");
    expect(gateAgentTool("Skill", { skill: "brand-guidelines" }, "t1", undefined, "owner@example.com")).toBe("deny");
  });
});

describe("denialReason with each flag on, where the specific sentence belongs", () => {
  it("names the connector once CONNECTORS_ENABLED is on", () => {
    process.env.CONNECTORS_ENABLED = "1";

    expect(denialReason(EXTERNAL_TOOL)).toBe("connector not enabled for this thread");
  });

  it("names the skill once SKILLS_ENABLED is on", () => {
    process.env.SKILLS_ENABLED = "1";

    expect(denialReason("Skill", { skill: "brand-guidelines" })).toContain("brand-guidelines");
  });

  it("leaves the other feature's reason generic when only one flag is on", () => {
    process.env.SKILLS_ENABLED = "1";

    expect(denialReason(EXTERNAL_TOOL)).not.toContain("connector");
  });
});
