import { describe, it, expect, afterEach } from "vitest";
import { buildSystemPrompt } from "./prompts";

describe("buildSystemPrompt — kbDescription (spec 16)", () => {
  it("defaults to the neutral wording when no description is given", () => {
    expect(buildSystemPrompt(false)).toContain("the team knowledge base");
  });

  it("names the configured knowledge base instead", () => {
    const p = buildSystemPrompt(false, "the Acme engineering handbook");
    expect(p).toContain("You are the assistant for the Acme engineering handbook");
    expect(p).toContain("outside the Acme engineering handbook, decline");
  });

  it("uses the description in the write-enabled boundaries too", () => {
    const p = buildSystemPrompt(true, "the Acme engineering handbook");
    expect(p).toContain("outside the Acme engineering handbook, decline");
    expect(p).toContain("PROPOSING EDITS");
  });

  it("keeps files the user attached in scope in both boundary modes", () => {
    for (const write of [false, true]) {
      const p = buildSystemPrompt(write, "the Acme engineering handbook");
      expect(p).toContain("Files the user attached to this conversation are always in scope");
    }
  });

  it("omits the house rules block and every reference to it when none are configured", () => {
    for (const write of [false, true]) {
      const p = buildSystemPrompt(write, "the Acme engineering handbook");
      expect(p).not.toContain("HOUSE RULES");
      expect(p).not.toContain("house rules above");
    }
  });

  it("renders configured house rules and refers back to them in write mode and web guidance", () => {
    const agent = { houseRules: ["Always say Acme in full.", "Never promise dates."], houseRulesSummary: "Acme, dates", subjectName: "Acme" };
    const p = buildSystemPrompt(true, "the Acme engineering handbook", agent);
    expect(p).toContain("HOUSE RULES");
    expect(p).toContain("- Always say Acme in full.\n- Never promise dates.");
    expect(p).toContain("follow the house rules above (Acme, dates) exactly");
    expect(p).toContain("anything about Acme itself");
  });

  it("still distinguishes read-only from write-enabled boundaries", () => {
    expect(buildSystemPrompt(false)).toContain("You are read-only");
    expect(buildSystemPrompt(true)).not.toContain("You are read-only");
  });
});

describe("buildSystemPrompt canvas-aware posture (spec 29)", () => {
  afterEach(() => {
    delete process.env.CANVAS_ENABLED;
  });

  it("with canvas OFF, states the flat read-only boundary", () => {
    delete process.env.CANVAS_ENABLED;
    const p = buildSystemPrompt(false);
    expect(p).toContain("You are read-only with respect to the knowledge base");
    expect(p).toContain("you cannot edit or\n  write files");
    expect(p).not.toContain("doc_write");
  });

  it("with canvas ON, drops the flat 'cannot write files' claim and tells the agent to create documents", () => {
    process.env.CANVAS_ENABLED = "1";
    const p = buildSystemPrompt(false);
    // No longer claims it cannot write files at all: doc_write creates workspace docs.
    expect(p).not.toContain("you cannot edit or\n  write files");
    expect(p).toContain("You are NOT a read-only Q&A bot");
    expect(p).toContain("create it with the doc_write tool");
    // Read-only is scoped to the KB vault itself, not absolute.
    expect(p).toContain("remain read-only with respect to");
    // The canvas usage section is present too.
    expect(p).toContain("IN-CHAT DOCUMENTS");
  });
});

describe("buildSystemPrompt change request wording", () => {
  it("says merge request by default and the given noun otherwise", () => {
    expect(buildSystemPrompt(true)).toContain("open a merge request for the\n  change they just reviewed");
    const p = buildSystemPrompt(true, "the Acme handbook", undefined, "pull request");
    expect(p).toContain("open a pull request for the");
    expect(p).not.toContain("merge request");
  });
});
