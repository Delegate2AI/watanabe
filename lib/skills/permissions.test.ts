import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { gateSkillTool, parseSkillName, skillDenialReason, SKILL_TOOL } from "./permissions";

/**
 * Spec 34: the `Skill` tool gate, the defense-in-depth layer on top of
 * materialization. Materialization filters by physical absence, so a skill the
 * caller may not use is not in the plugin directory at all. This gate is the
 * SECOND, independent boundary: it is handed the resolved slug set and refuses
 * any other name, so a materialized tree that was ever wrong (a key collision,
 * a tampered cache, a future build bug) still cannot get a skill invoked.
 */

const saved = { ...process.env };

beforeEach(() => {
  process.env.SKILLS_ENABLED = "1";
});

afterEach(() => {
  process.env = { ...saved };
});

const CLEARED: ReadonlySet<string> = new Set(["brand-guidelines", "deal-memo"]);

describe("parseSkillName", () => {
  it("reads the `skill` property", () => {
    expect(parseSkillName({ skill: "brand-guidelines" })).toBe("brand-guidelines");
  });

  it("falls back to `command` when there is no `skill`", () => {
    expect(parseSkillName({ command: "deal-memo" })).toBe("deal-memo");
  });

  it("prefers `skill` over `command`", () => {
    expect(parseSkillName({ skill: "deal-memo", command: "other" })).toBe("deal-memo");
  });

  it("strips a plugin qualifier, keeping the skill half", () => {
    expect(parseSkillName({ skill: "watanabe-skills:brand-guidelines" })).toBe("brand-guidelines");
    expect(parseSkillName({ command: ":brand-guidelines" })).toBe("brand-guidelines");
  });

  it("keeps only the first path segment", () => {
    expect(parseSkillName({ skill: "brand-guidelines/SKILL.md" })).toBe("brand-guidelines");
  });

  it("recovers a name from an unknown field when it is the only name-shaped value", () => {
    // The Skill tool's input schema is not exported by the SDK, so a renamed or
    // added field must not silently disable the gate.
    expect(parseSkillName({ skillId: "brand-guidelines" })).toBe("brand-guidelines");
    expect(parseSkillName({ skill_name: "deal-memo" })).toBe("deal-memo");
    expect(parseSkillName({ name: "deal-memo" })).toBe("deal-memo");
  });

  it("returns undefined when nothing in the input can be read as a name", () => {
    expect(parseSkillName({})).toBeUndefined();
    expect(parseSkillName({ skill: 7 })).toBeUndefined();
    expect(parseSkillName(undefined)).toBeUndefined();
    expect(parseSkillName(null)).toBeUndefined();
    expect(parseSkillName("brand-guidelines")).toBeUndefined();
    // Ambiguous: two name-shaped values and no way to tell which is the skill.
    expect(parseSkillName({ alpha: "one-thing", beta: "other-thing" })).toBeUndefined();
  });

  it("returns a non-matching string (never undefined) for a present but unusable name", () => {
    // Fail closed: a present-but-garbage name must deny, not fall through to
    // the "no name field" allow.
    expect(parseSkillName({ skill: "   " })).toBe("");
    expect(parseSkillName({ skill: "/abs/path" })).toBe("");
    expect(parseSkillName({ skill: "x".repeat(500) })).toBe("");
  });
});

describe("gateSkillTool", () => {
  it("denies when the flag is off, even with a matching slug set", () => {
    delete process.env.SKILLS_ENABLED;
    expect(gateSkillTool({ skill: "brand-guidelines" }, CLEARED)).toBe("deny");
  });

  it("denies when the resolved slug set is empty or absent", () => {
    expect(gateSkillTool({ skill: "brand-guidelines" }, new Set())).toBe("deny");
    expect(gateSkillTool({ skill: "brand-guidelines" })).toBe("deny");
  });

  it("allows a slug in the resolved set", () => {
    expect(gateSkillTool({ skill: "brand-guidelines" }, CLEARED)).toBe("allow");
    expect(gateSkillTool({ command: "watanabe-skills:deal-memo" }, CLEARED)).toBe("allow");
  });

  it("denies a slug outside the resolved set, whatever the materialized tree holds", () => {
    expect(gateSkillTool({ skill: "board-minutes" }, CLEARED)).toBe("deny");
    expect(gateSkillTool({ command: "watanabe-skills:board-minutes" }, CLEARED)).toBe("deny");
  });

  it("denies a garbage name rather than treating it as no name", () => {
    expect(gateSkillTool({ skill: "" }, CLEARED)).toBe("deny");
    expect(gateSkillTool({ skill: "../../etc" }, CLEARED)).toBe("deny");
  });

  it("denies when no name can be read out of the input at all", () => {
    // Fail closed. A gate that allows what it cannot parse is not a gate, and
    // the parse is the part built on an input schema the SDK does not export.
    expect(gateSkillTool({}, CLEARED)).toBe("deny");
    expect(gateSkillTool(undefined, CLEARED)).toBe("deny");
    expect(gateSkillTool({ alpha: "one-thing", beta: "other-thing" }, CLEARED)).toBe("deny");
  });

  it("denies a non-member name carried by a third, unknown field", () => {
    expect(gateSkillTool({ mysteryField: "board-minutes" }, CLEARED)).toBe("deny");
  });

  it("allows the frontmatter-name form of a member slug", () => {
    // The listing the model is shown carries SKILL.md's `name`, which is only
    // slug-shaped by accident: "Brand Guidelines" is what it asks for, and
    // "brand-guidelines" is what the store, the registry, and the plugin
    // directory are keyed by.
    expect(gateSkillTool({ skill: "Brand Guidelines" }, CLEARED)).toBe("allow");
    expect(gateSkillTool({ skill: "Deal Memo" }, CLEARED)).toBe("allow");
    expect(gateSkillTool({ command: "watanabe-skills:Brand Guidelines" }, CLEARED)).toBe("allow");
  });

  it("still denies a frontmatter name whose slug is not in the set", () => {
    expect(gateSkillTool({ skill: "Board Minutes" }, CLEARED)).toBe("deny");
    expect(gateSkillTool({ skill: "Brand Guidelines Extra" }, CLEARED)).toBe("deny");
  });

  it("still allows the exact slug form", () => {
    expect(gateSkillTool({ skill: "brand-guidelines" }, CLEARED)).toBe("allow");
  });

  it("denies an array input rather than reading a name out of it", () => {
    expect(gateSkillTool(["brand-guidelines"], CLEARED)).toBe("deny");
  });

  it("denies rather than throwing when reading the input throws", () => {
    // Not reachable from JSON-parsed SDK input, which cannot carry a getter.
    // A gate that throws on the session path is worse than one that denies.
    const hostile = {
      get skill(): string {
        throw new Error("boom");
      },
    };
    expect(() => gateSkillTool(hostile, CLEARED)).not.toThrow();
    expect(gateSkillTool(hostile, CLEARED)).toBe("deny");
  });

  it("allows a member name carried by a third, unknown field", () => {
    expect(gateSkillTool({ mysteryField: "brand-guidelines" }, CLEARED)).toBe("allow");
  });
});

describe("skillDenialReason", () => {
  it("names the tool and stays generic about why", () => {
    const reason = skillDenialReason({ skill: "board-minutes" });
    expect(reason).toContain("board-minutes");
    expect(reason.length).toBeGreaterThan(0);
  });

  it("works with no parsable name", () => {
    expect(skillDenialReason({})).toContain("skill");
  });

  it("exports the SDK tool name it gates", () => {
    expect(SKILL_TOOL).toBe("Skill");
  });
});
