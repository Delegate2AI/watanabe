import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { denialReason, gateAgentTool } from "./permissions";

/**
 * Spec 34: the `Skill` branch of `gateAgentTool`. Split out of
 * permissions.test.ts (same module under test) to keep that file under the
 * repo's line-count limit, exactly as the connectors branch was.
 *
 * The slug set the gate is handed comes from the session's materialization, but
 * the check here is INDEPENDENT of what is on disk: a name outside the set is
 * refused even though the materialized directory is what actually holds the
 * skill bodies. Two boundaries, either one sufficient.
 */

const saved = { ...process.env };

beforeEach(() => {
  process.env.SKILLS_ENABLED = "1";
});

afterEach(() => {
  process.env = { ...saved };
});

const CLEARED: ReadonlySet<string> = new Set(["brand-guidelines"]);

/** `gateAgentTool` with only the arguments this branch cares about. */
function gate(toolInput?: unknown, skillSlugs?: ReadonlySet<string>): string {
  return gateAgentTool("Skill", toolInput, "thread-1", undefined, "owner@example.com", undefined, skillSlugs);
}

describe("the Skill branch of gateAgentTool (spec 34)", () => {
  it("denies with the flag off, even when a slug set is passed", () => {
    delete process.env.SKILLS_ENABLED;
    expect(gate({ skill: "brand-guidelines" }, CLEARED)).toBe("deny");
  });

  it("denies when no slug set is passed at all (today's behavior for 6-arg callers)", () => {
    expect(gate({ skill: "brand-guidelines" })).toBe("deny");
    expect(gateAgentTool("Skill")).toBe("deny");
  });

  it("denies when the resolved set is empty (no skill is visible to this clearance)", () => {
    expect(gate({ skill: "brand-guidelines" }, new Set())).toBe("deny");
  });

  it("allows a skill in the resolved set", () => {
    expect(gate({ skill: "brand-guidelines" }, CLEARED)).toBe("allow");
  });

  it("denies a skill outside the resolved set", () => {
    expect(gate({ skill: "board-minutes" }, CLEARED)).toBe("deny");
  });

  it("denies an input the gate cannot read a skill name out of (fail closed)", () => {
    expect(gate({}, CLEARED)).toBe("deny");
    expect(gate(undefined, CLEARED)).toBe("deny");
  });

  it("denies a non-member name carried by a field name the SDK does not document", () => {
    expect(gate({ mysteryField: "board-minutes" }, CLEARED)).toBe("deny");
  });

  it("allows the frontmatter-name form the model is actually shown", () => {
    expect(gate({ skill: "Brand Guidelines" }, CLEARED)).toBe("allow");
    expect(gate({ skill: "Board Minutes" }, CLEARED)).toBe("deny");
  });

  it("leaves every other tool's decision untouched", () => {
    expect(gateAgentTool("Read", undefined, "thread-1", undefined, "owner@example.com", undefined, CLEARED)).toBe(
      "allow",
    );
    expect(gateAgentTool("Edit", undefined, "thread-1", undefined, "owner@example.com", undefined, CLEARED)).toBe(
      "deny",
    );
    expect(gateAgentTool("Skills", undefined, "thread-1", undefined, "owner@example.com", undefined, CLEARED)).toBe(
      "deny",
    );
  });

  it("gives a Skill-specific denial reason", () => {
    const reason = denialReason("Skill", { skill: "board-minutes" });
    expect(reason).toContain("board-minutes");
    expect(reason).not.toContain("read-only and scoped");
  });
});
